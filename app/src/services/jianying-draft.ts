/**
 * 剪映草稿导出组装服务。
 *
 * 把一个项目组装成剪映（JianYing）/ CapCut 草稿文件夹并打成 zip：
 *   <草稿文件夹>/
 *     ├── draft_content.json     核心时间轴（由 lib/jianying-draft 纯函数产出）
 *     ├── draft_meta_info.json   草稿元信息（自包含最小文件集之一）
 *     ├── 使用说明.txt           解压/兼容/边界说明
 *     └── material/              全部素材（视频/图片/配音/BGM）
 *
 * 用户把 zip 解压到剪映草稿目录即可打开继续精修。素材路径用剪映占位符 token 实现
 * 「自包含」（见 lib/jianying-draft 文件头 + buildDraftMaterialPath），故解压到任意机器
 * 都能定位素材，不弹「媒体丢失」。
 *
 * 时间轴映射（主会话定案）：逐镜视频/图片 + 逐镜配音 + 全片 BGM + 逐句字幕。
 * 字幕切分/时间窗复用 lib/subtitle-segments（与预览/导出同一真源）。
 * 明确不含：转场/滤镜/LUT/片头尾卡/Ken Burns/SFX/水印（留给用户在剪映里加，或走成片导出）。
 *
 * 素材下载走 lib/url-guard 的 safeDownload（钉 IP 防 SSRF），产物走 storage.uploadFile()
 * 门面（R2/本地盘自动降级）。临时目录用后即清。
 */

import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import os from "os";
import * as archiver from "archiver";
import { createWriteStream } from "fs";
import sharp from "sharp";

import { safeDownload } from "@/lib/url-guard";
import { uploadFile } from "@/services/storage";
import { getMediaDuration } from "@/services/video-synthesis";
import {
  splitSubtitleSegments,
  allocateSubtitleWindows,
} from "@/lib/subtitle-segments";
import {
  buildJianyingDraft,
  buildDraftMetaInfo,
  secondsToMicros,
  PHOTO_MATERIAL_DURATION_US,
  type DraftVideoShot,
  type DraftVoiceClip,
  type DraftBgm,
  type DraftSubtitle,
} from "@/lib/jianying-draft";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:jianying-draft");

/** 画幅 → 画布像素（与 video-synthesis 的 ASPECT_DIMENSIONS 一致，1080 基准竖屏） */
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

/** 组装服务入参 */
export interface AssembleJianyingDraftInput {
  /** 项目 id（临时目录 + 日志 + 存储路径） */
  projectId: string;
  /** 用户 id（存储路径归属） */
  userId: string;
  /** 项目标题（草稿文件夹名 + zip 文件名） */
  projectTitle: string;
  /** 画幅（决定画布尺寸），缺省按 9:16 */
  aspectRatio: string;
  /** 逐镜数据（按 order 升序） */
  scenes: Array<{
    id: string;
    order: number;
    duration: number;
    imageUrl: string | null;
    videoUrl: string | null;
    audioUrl: string | null;
    dialogue: string | null;
    narration: string | null;
  }>;
  /** 背景音乐配置（generationParams.backgroundMusic），缺省/未启用则不混入 */
  bgm?: {
    enabled?: boolean;
    url?: string;
    volume?: number;
  };
}

/** 组装服务返回 */
export interface AssembleJianyingDraftResult {
  /** 打包好的 zip 可访问 URL */
  zipUrl: string;
  /** zip 字节数 */
  sizeBytes: number;
}

/** 把 path-only URL（/uploads/...）补成绝对 URL（与 cover / video-synthesis 一致） */
function absolutizeUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://comic.cloudsentryai.com";
  const trimmedBase = base.replace(/\/+$/, "");
  const p = url.startsWith("/") ? url : `/${url}`;
  return `${trimmedBase}${p}`;
}

/** 从 URL 取扩展名（无扩展名时按类别给缺省） */
function extFromUrl(url: string, fallback: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const ext = clean.split(".").pop() ?? "";
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : fallback;
}

/** ffprobe 视频宽高（失败返回 null，由调用方回退画布尺寸） */
function probeVideoDimensions(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      filePath,
    ]);
    let stdout = "";
    ffprobe.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    ffprobe.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const m = stdout.trim().match(/^(\d+)x(\d+)$/);
      if (!m) return resolve(null);
      resolve({ width: Number(m[1]), height: Number(m[2]) });
    });
    ffprobe.on("error", () => resolve(null));
  });
}

/**
 * 下载素材到 material/ 目录并按 URL 去重。返回该素材在 material/ 下的文件名。
 *
 * 同一 URL 多次请求只下载一次（多镜复用同素材共享一份文件 + 一条 draft 素材）。
 * 文件名 = 类别前缀 + 序号 + 扩展名（安全、可移植、无中文/特殊字符）。
 */
class MaterialDownloader {
  private readonly cache = new Map<string, string>();
  private counter = 0;

  constructor(private readonly materialDir: string) {}

  /** 下载并返回 material/ 下文件名；已下过的 URL 直接复用 */
  async fetch(url: string, kind: "video" | "image" | "audio"): Promise<string> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    const ext = extFromUrl(
      url,
      kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "mp4"
    );
    const fileName = `${kind}_${this.counter++}.${ext}`;
    const dest = path.join(this.materialDir, fileName);

    // SSRF 防护：钉 IP 下载（URL 均为本项目已落库产物，absolutize 后校验）
    const { buffer } = await safeDownload(absolutizeUrl(url));
    await writeFile(dest, buffer);

    this.cache.set(url, fileName);
    return fileName;
  }

  /** 已下素材的绝对路径（用于 ffprobe / sharp 探测） */
  pathOf(fileName: string): string {
    return path.join(this.materialDir, fileName);
  }
}

/** 把文件名安全化为草稿文件夹名（去路径分隔符与非法字符，限长） */
function safeFolderName(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "剪映草稿").slice(0, 60);
}

/** 使用说明.txt 内容（解压/兼容/边界说明） */
function buildReadme(): string {
  return [
    "剪映草稿使用说明",
    "================",
    "",
    "【如何使用】",
    "1. 解压本压缩包，得到一个与项目同名的草稿文件夹（内含 draft_content.json、",
    "   draft_meta_info.json、material/ 素材目录等）。",
    "2. 把整个草稿文件夹复制到剪映的草稿目录：",
    "   - Windows: %LOCALAPPDATA%\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
    "   - macOS:   ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
    "   （CapCut 国际版路径把 JianyingPro 换成 CapCut。）",
    "3. 重启剪映/CapCut，在草稿列表即可看到本草稿，打开继续精修。",
    "",
    "【兼容性】",
    "- 兼容剪映专业版 5.9+ 与 CapCut。",
    "- 新版剪映可直接打开本草稿；保存后草稿会被剪映加密，属正常现象。",
    "- 素材已内置在 material/ 目录并用剪映占位符路径引用，跨机器解压也不会丢素材。",
    "",
    "【本草稿包含】",
    "- 逐镜视频/图片（视频轨）",
    "- 逐镜配音（配音音轨）",
    "- 全片背景音乐（背景音乐音轨，若项目已配置）",
    "- 逐句字幕（文本轨，白字居中，可在剪映里自由重排样式/位置）",
    "",
    "【本草稿不包含】（留给你在剪映里自由添加，或使用本平台的成片导出）",
    "- 转场 / 滤镜 / 调色 LUT / 片头尾卡 / 图片运镜(Ken Burns) / 音效(SFX) / 水印",
    "",
    "背景音乐若比全片短，剪映内不会自动循环铺满，可在剪映里手动延长或替换。",
  ].join("\n");
}

/**
 * 把项目组装成剪映草稿 zip 并上传，返回 { zipUrl, sizeBytes }。
 *
 * @throws 无可用素材 / 下载失败 / 打包失败时抛可读错误（调用方转 HTTP 响应）
 */
export async function assembleJianyingDraft(
  input: AssembleJianyingDraftInput
): Promise<AssembleJianyingDraftResult> {
  const canvas =
    ASPECT_DIMENSIONS[input.aspectRatio] ?? ASPECT_DIMENSIONS["9:16"];

  // 有视频或图片的镜才计入（无画面的镜跳过）；按 order 升序
  const usableScenes = [...input.scenes]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.videoUrl || s.imageUrl);

  if (usableScenes.length === 0) {
    throw new Error("没有可导出的素材，请先生成分镜图或视频");
  }

  const folderName = safeFolderName(input.projectTitle);
  const tmpRoot = path.join(
    os.tmpdir(),
    "ai-comic-jianying",
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  const draftDir = path.join(tmpRoot, folderName);
  const materialDir = path.join(draftDir, "material");

  try {
    await mkdir(materialDir, { recursive: true });
    const downloader = new MaterialDownloader(materialDir);

    // 全草稿共用的大写 UUID（素材路径占位符，见 lib/jianying-draft）
    const placeholderUuid = crypto.randomUUID().toUpperCase();

    // ── 逐镜：视频/图片 + 配音 + 累计字幕 ──
    const videoShots: DraftVideoShot[] = [];
    const voiceClips: DraftVoiceClip[] = [];
    const subtitles: DraftSubtitle[] = [];

    let cursorUs = 0; // 视频轨累计起点（μs），逐镜闭合无缝

    for (const scene of usableScenes) {
      const shotDurationUs = secondsToMicros(scene.duration);

      // 视频优先，否则图片
      if (scene.videoUrl) {
        const fileName = await downloader.fetch(scene.videoUrl, "video");
        const filePath = downloader.pathOf(fileName);
        // 视频实测时长（秒→μs）；失败回退声明时长
        let realDurationUs = shotDurationUs;
        try {
          const durSec = await getMediaDuration(filePath);
          if (durSec > 0) realDurationUs = secondsToMicros(durSec);
        } catch {
          log.warn(`视频时长探测失败，回退声明值: ${fileName}`);
        }
        const dims = await probeVideoDimensions(filePath);
        videoShots.push({
          kind: "video",
          materialFileName: fileName,
          materialWidth: dims?.width ?? canvas.width,
          materialHeight: dims?.height ?? canvas.height,
          materialDurationUs: realDurationUs,
          startUs: cursorUs,
          durationUs: shotDurationUs,
        });
      } else if (scene.imageUrl) {
        const fileName = await downloader.fetch(scene.imageUrl, "image");
        const filePath = downloader.pathOf(fileName);
        // 图片宽高用 sharp 读，失败回退画布尺寸
        let imgWidth = canvas.width;
        let imgHeight = canvas.height;
        try {
          const meta = await sharp(filePath).metadata();
          if (meta.width && meta.height) {
            imgWidth = meta.width;
            imgHeight = meta.height;
          }
        } catch {
          log.warn(`图片尺寸读取失败，回退画布尺寸: ${fileName}`);
        }
        videoShots.push({
          kind: "photo",
          materialFileName: fileName,
          materialWidth: imgWidth,
          materialHeight: imgHeight,
          materialDurationUs: PHOTO_MATERIAL_DURATION_US,
          startUs: cursorUs,
          durationUs: shotDurationUs,
        });
      }

      // 配音（该镜起点对齐；实测配音长供字幕节奏）
      let voiceDurationSec: number | undefined;
      if (scene.audioUrl) {
        const fileName = await downloader.fetch(scene.audioUrl, "audio");
        const filePath = downloader.pathOf(fileName);
        let voiceUs = shotDurationUs;
        try {
          const durSec = await getMediaDuration(filePath);
          if (durSec > 0) {
            voiceUs = secondsToMicros(durSec);
            voiceDurationSec = durSec;
          }
        } catch {
          log.warn(`配音时长探测失败，回退声明值: ${fileName}`);
        }
        voiceClips.push({
          materialFileName: fileName,
          materialDurationUs: voiceUs,
          startUs: cursorUs,
          durationUs: shotDurationUs,
        });
      }

      // 字幕：dialogue 优先，无则 narration；复用同一真源切句 + 分配窗
      const subtitleText = scene.dialogue?.trim() || scene.narration?.trim();
      if (subtitleText) {
        const pieces = splitSubtitleSegments(subtitleText);
        const windows = allocateSubtitleWindows(
          pieces,
          scene.duration,
          voiceDurationSec
        );
        for (const w of windows) {
          if (!w.text.trim()) continue;
          subtitles.push({
            text: w.text,
            startUs: cursorUs + secondsToMicros(w.start),
            durationUs: secondsToMicros(w.end - w.start),
          });
        }
      }

      cursorUs += shotDurationUs;
    }

    // ── BGM（全片单条，enabled 且 url 非空才加） ──
    let bgm: DraftBgm | undefined;
    if (input.bgm?.enabled && input.bgm.url) {
      const fileName = await downloader.fetch(input.bgm.url, "audio");
      const filePath = downloader.pathOf(fileName);
      let bgmUs = cursorUs; // 探测失败时按全片长（会被 lib 内 min 截断）
      try {
        const durSec = await getMediaDuration(filePath);
        if (durSec > 0) bgmUs = secondsToMicros(durSec);
      } catch {
        log.warn(`BGM 时长探测失败，回退全片长: ${fileName}`);
      }
      bgm = {
        materialFileName: fileName,
        materialDurationUs: bgmUs,
        totalDurationUs: cursorUs,
        volume: typeof input.bgm.volume === "number" ? input.bgm.volume : 0.25,
      };
    }

    // ── 纯函数出草稿 JSON ──
    const draftContent = buildJianyingDraft({
      width: canvas.width,
      height: canvas.height,
      fps: 30,
      pathPlaceholderUuid: placeholderUuid,
      videoShots,
      voiceClips,
      bgm,
      subtitles,
    });
    const metaInfo = buildDraftMetaInfo(folderName);

    // ── 落盘草稿文件（素材已在 material/） ──
    await writeFile(
      path.join(draftDir, "draft_content.json"),
      JSON.stringify(draftContent, null, 4),
      "utf-8"
    );
    await writeFile(
      path.join(draftDir, "draft_meta_info.json"),
      JSON.stringify(metaInfo, null, 4),
      "utf-8"
    );
    await writeFile(
      path.join(draftDir, "使用说明.txt"),
      buildReadme(),
      "utf-8"
    );

    // ── 打 zip（根 = 草稿文件夹，解压出「项目名」文件夹） ──
    const zipPath = path.join(tmpRoot, `${folderName}.zip`);
    await zipDirectory(draftDir, folderName, zipPath);

    // ── 上传（zip 借用 video 分类；contentType=application/zip） ──
    const { readFile } = await import("fs/promises");
    const zipBuffer = await readFile(zipPath);
    const zipUrl = await uploadFile(zipBuffer, {
      fileName: `${folderName}_剪映草稿_${Date.now()}.zip`,
      contentType: "application/zip",
      fileType: "video",
      userId: input.userId,
      projectId: input.projectId,
    });

    return { zipUrl, sizeBytes: zipBuffer.length };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 用 archiver 把 sourceDir 打成 zip，zip 内根目录为 rootName（即解压出一个 rootName 文件夹）。
 *
 * @param sourceDir 待打包目录（草稿文件夹）
 * @param rootName  zip 内根目录名（草稿文件夹名）
 * @param outPath   输出 zip 路径
 */
function zipDirectory(
  sourceDir: string,
  rootName: string,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    // 用 ZipArchive 类而非工厂函数：@types/archiver@8 的类型只暴露类，不含可调用工厂。
    const archive = new archiver.ZipArchive({ zlib: { level: 6 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    // archiver 的 warning（如文件消失）也当错误处理，避免产出残缺 zip
    archive.on("warning", reject);

    archive.pipe(output);
    // 把整个目录放到 zip 内的 rootName/ 下
    archive.directory(sourceDir, rootName);
    archive.finalize().catch(reject);
  });
}
