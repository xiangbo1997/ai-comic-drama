/**
 * 分段视频生成编排器
 *
 * 把一个「时长超过模型单段能力」的分镜拆成 N 段依次生成，链式衔接（第 k 段末帧
 * = 第 k+1 段首帧图），最后 ffmpeg 拼接成单条视频。时长 ≤ 单段能力时严格退化为
 * 「一次生成、原样返回」——零回归。
 *
 * 衔接链：
 *   段1：imageUrl = 分镜图（若仅 1 段且传了尾帧 → FL 首尾帧，同现有行为）
 *   段k>1：imageUrl = 段k-1 末帧（下载视频 → extractLastFrame → 上传得 URL）
 *   末段：若开了 videoLinkNext 尾帧 且 模型支持 FL → 传 lastFrameImage，
 *         让整条链最终落在下一分镜的开场图上（跨镜无缝）。
 *
 * 存储/SSRF 合规：段视频与末帧一律走 storage 门面（uploadFile/uploadFileFromUrl）；
 * 下载 provider 返回的临时视频 URL 用 SSRF-safe 的 safeDownload（钉 IP）。
 */

import { generateVideo } from "@/services/ai";
import { uploadFile } from "@/services/storage";
import { safeDownload } from "@/lib/url-guard";
import {
  extractLastFrame,
  concatVideos,
  getMediaDuration,
} from "@/services/video-synthesis";
import type { VideoModelCapability } from "@/services/ai/video-capabilities";
import { planVideoSegments } from "./video-segmenter";
import type { VideoSegmentPlanItem } from "./video-segmenter";
import type { AIServiceConfig } from "@/types";
import { createLogger } from "@/lib/logger";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

const log = createLogger("services:generation:segmented-video");

/** 分段生成入参 */
export interface SegmentedVideoArgs {
  /** 分镜首帧图 URL（第 1 段的 image_url） */
  imageUrl: string;
  /** 用户设定的分镜时长（秒，1–60），据此规划分段 */
  requestedSeconds: number;
  /** 模型能力（决定分段策略） */
  capability: VideoModelCapability;
  /**
   * 每段 prompt：若只给 1 个，则所有段复用之，且第 k>1 段自动追加连贯性子句。
   * 逐段导演节拍留给后续 workstream，签名先设计为 string[]。
   */
  prompts: string[];
  /** 画幅（透传 provider 路由横/竖屏） */
  aspectRatio?: "1:1" | "9:16" | "16:9";
  /** 角色参考图（R2V 路由；仅第 1 段用） */
  referenceImages?: string[];
  /** 身份前缀（视频人物一致性锚，逐段透传） */
  identityPrompt?: string;
  /** identity seed（逐段透传，保持人物一致） */
  seed?: number;
  /**
   * 尾帧图（videoLinkNext 命中下一分镜开场图）：仅在「末段」且模型支持 FL 时下发，
   * 让整条链最终落在下一分镜开场图上。
   */
  lastFrameImage?: string;
  /** 视频生成配置 */
  config?: AIServiceConfig;
  /** 上传归属（storage 路径与审计用） */
  userId: string;
  projectId?: string;
  sceneId?: string;
}

/** 分段生成结果 */
export interface SegmentedVideoResult {
  /** 最终（拼接后）视频的自有存储 URL */
  videoUrl: string;
  /** ffprobe 实测总时长（秒）；探测失败为 undefined */
  measuredDurationSeconds?: number;
  /** 各段元数据（排障 / GenerationTask.output 留痕） */
  segments: Array<{ url: string; seconds: number }>;
}

/** 连贯性子句（k>1 段复用同一 prompt 时追加，提示模型从当前帧顺滑续接） */
const CONTINUATION_CLAUSE =
  "Continue the motion seamlessly from the current frame.";

/**
 * 取第 index 段的 prompt：优先取对应下标；只有 1 个 prompt 时复用并对 k>1 追加连贯性子句。
 */
function resolveSegmentPrompt(prompts: string[], index: number): string {
  if (prompts.length === 0) return "";
  if (index < prompts.length) return prompts[index];
  // 复用第一个 prompt，k>1 段追加连贯性子句
  const base = prompts[0];
  return index === 0 ? base : `${base}. ${CONTINUATION_CLAUSE}`;
}

/**
 * 下载一段视频到本地临时文件并 ffprobe 时长（供总时长兜底与末帧提取共用 buffer）。
 * 返回 buffer 与实测秒数（探测失败为 0）。
 */
async function downloadSegment(
  url: string
): Promise<{ buffer: Buffer; seconds: number }> {
  const { buffer } = await safeDownload(url);
  // 落临时文件 ffprobe（getMediaDuration 接受本地路径）
  const tmpDir = path.join(os.tmpdir(), "ai-comic-seg-probe");
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }
  const tmpFile = path.join(
    tmpDir,
    `seg_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  );
  await writeFile(tmpFile, buffer);
  let seconds = 0;
  try {
    seconds = await getMediaDuration(tmpFile);
  } catch {
    seconds = 0;
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // 忽略清理错误
    }
  }
  return { buffer, seconds };
}

/**
 * 生成分镜视频（自动分段 + 链式衔接 + 拼接）。
 *
 * 单段路径（plan.segments.length===1）零改动透传：直接 generateVideo 返回其 URL，
 * 不做任何下载/拼接（与现有单段行为完全一致）。
 */
export async function generateSceneVideoSegmented(
  args: SegmentedVideoArgs
): Promise<SegmentedVideoResult> {
  const plan = planVideoSegments(args.requestedSeconds, args.capability);
  const total = plan.segments.length;

  // 生成单段（内部辅助）：按段序决定首帧图、是否下发 duration / 尾帧。
  const generateOneSegment = async (
    seg: VideoSegmentPlanItem,
    firstFrameUrl: string,
    isLast: boolean
  ): Promise<string> => {
    // 尾帧：仅「末段 + 模型支持 FL + 传了尾帧」时下发，让链末落在下一分镜开场图
    const lastFrameForSeg =
      isLast && args.capability.supportsFirstLastFrame
        ? args.lastFrameImage
        : undefined;
    return generateVideo({
      imageUrl: firstFrameUrl,
      prompt: resolveSegmentPrompt(args.prompts, seg.index),
      // 接受 duration 的模型下发档位；Veo 类为 undefined（不传，由 provider 忽略）
      duration: seg.requestDuration,
      aspectRatio: args.aspectRatio,
      // 参考图仅第 1 段注入（R2V 路由）；后续段首帧已是上一段末帧，不再混入参考图
      referenceImages: seg.index === 0 ? args.referenceImages : undefined,
      identityPrompt: args.identityPrompt,
      seed: args.seed,
      lastFrameImage: lastFrameForSeg,
      config: args.config,
    });
  };

  // ── 单段：零回归透传（不下载、不拼接） ──
  if (total === 1) {
    const seg = plan.segments[0];
    // 单段仍可能命中 FL（传了尾帧且模型支持）——沿用现有单段+尾帧行为
    const url = await generateOneSegment(seg, args.imageUrl, true);
    return {
      videoUrl: url,
      segments: [{ url, seconds: seg.targetSeconds }],
    };
  }

  // ── 多段：链式生成 + 拼接 ──
  log.info("视频分段生成", {
    sceneId: args.sceneId,
    total,
    requested: args.requestedSeconds,
  });

  const buffers: Buffer[] = [];
  const segmentMeta: Array<{ url: string; seconds: number }> = [];
  let nextFirstFrame = args.imageUrl;

  for (let i = 0; i < total; i += 1) {
    const seg = plan.segments[i];
    const isLast = i === total - 1;

    // 生成该段 → 得到 provider 的（临时）视频 URL
    const rawUrl = await generateOneSegment(seg, nextFirstFrame, isLast);

    // 下载该段字节 + 实测时长（供拼接与总时长）
    const { buffer, seconds } = await downloadSegment(rawUrl);
    buffers.push(buffer);
    segmentMeta.push({
      url: rawUrl,
      seconds: seconds > 0 ? seconds : seg.targetSeconds,
    });

    // 为下一段准备首帧：提取本段末帧 → 上传得自有 URL（storage 门面）
    if (!isLast) {
      const frameBuffer = await extractLastFrame(buffer);
      nextFirstFrame = await uploadFile(frameBuffer, {
        fileName: `scene_${args.sceneId ?? "unknown"}_seg${i}_lastframe_${Date.now()}.jpg`,
        contentType: "image/jpeg",
        fileType: "image",
        userId: args.userId,
        projectId: args.projectId,
      });
    }
  }

  // 拼接所有段 → 单条 MP4 → 上传自有存储
  const merged = await concatVideos(buffers);
  const videoUrl = await uploadFile(merged, {
    fileName: `scene_${args.sceneId ?? "unknown"}_merged_${Date.now()}.mp4`,
    contentType: "video/mp4",
    fileType: "video",
    userId: args.userId,
    projectId: args.projectId,
  });

  // 实测拼接后总时长（真实值优先于估算）：直接用手头的 merged buffer 落临时
  // 文件 ffprobe——不走 URL 下载（本地盘降级时 videoUrl 是相对路径，safeDownload
  // 必然失败；且刚上传完再下载纯属浪费）。
  let measuredDurationSeconds: number | undefined;
  const probeTmp = path.join(
    os.tmpdir(),
    "ai-comic-seg-probe",
    `merged_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  );
  try {
    await mkdir(path.dirname(probeTmp), { recursive: true });
    await writeFile(probeTmp, merged);
    const seconds = await getMediaDuration(probeTmp);
    if (seconds > 0) measuredDurationSeconds = seconds;
  } catch (err) {
    log.warn("拼接视频总时长探测失败", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    try {
      await unlink(probeTmp);
    } catch {
      // 忽略清理错误
    }
  }

  return { videoUrl, measuredDurationSeconds, segments: segmentMeta };
}
