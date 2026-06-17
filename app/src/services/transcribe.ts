/**
 * 智能字幕识别服务
 *
 * 复用用户的 OpenAI 兼容 AI 配置（baseUrl + apiKey），调用 /audio/transcriptions
 * （Whisper 接口）从分镜配音音频中识别语音，生成带时间轴的字幕。
 *
 * 设计要点（移植自 MagicalCanvas 并适配本项目）：
 * - 我们的配音已是独立的 scene.audioUrl（R2），无需本地 ffmpeg 抽取音频，
 *   直接把每个分镜的配音整段送识别。
 * - 时间轴映射：成片时间 = 片段在成片上的起点 + 识别相对时间 / 变速倍率。
 * - 变速对齐：复用导出侧的「有效时长」语义（duration / speed）。
 */

import type { AIServiceConfig } from "@/types/ai";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:transcribe");

/** 识别用的分镜音频片段（按成片时间轴排布） */
export interface TranscribeScene {
  /** 分镜 id */
  id: string;
  /** 配音音频 URL（R2 公开/签名 URL）；无配音的分镜可省略 */
  audioUrl?: string | null;
  /** 该分镜在成片时间轴上的起点（秒） */
  start: number;
  /** 变速倍率（默认 1）；识别相对时间需除以它映射回成片时间轴 */
  speed?: number;
}

/** 识别产出的单条字幕（成片时间轴） */
export interface TranscribedSubtitle {
  /** 起始秒（成片时间轴） */
  start: number;
  /** 结束秒（成片时间轴） */
  end: number;
  /** 字幕文本 */
  text: string;
}

/** Whisper verbose_json 的分段结构（仅取用到的字段） */
interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperResponse {
  text?: string;
  segments?: WhisperSegment[];
}

/**
 * 把 path-only / 相对 URL 补成绝对 URL（与 video-synthesis 一致逻辑）。
 */
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

/**
 * 调用单段音频的语音识别（OpenAI 兼容 /audio/transcriptions）。
 * @returns verbose_json 解析结果
 */
async function transcribeOne(
  audioUrl: string,
  config: AIServiceConfig,
  model: string,
  language?: string
): Promise<WhisperResponse> {
  // 下载音频到内存（配音通常很短，不落盘）
  const resp = await fetch(absolutizeUrl(audioUrl));
  if (!resp.ok) {
    throw new Error(`配音音频下载失败 (HTTP ${resp.status})`);
  }
  const audioBuffer = await resp.arrayBuffer();

  // 从 URL 推断文件名/类型，缺省按 mp3
  const ext = (audioUrl.split(".").pop() || "mp3").split("?")[0].toLowerCase();
  const mime =
    ext === "wav"
      ? "audio/wav"
      : ext === "m4a"
        ? "audio/mp4"
        : ext === "ogg"
          ? "audio/ogg"
          : "audio/mpeg";

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mime }), `audio.${ext}`);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (language) form.append("language", language);

  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const apiResp = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  const bodyText = await apiResp.text();
  if (!apiResp.ok) {
    if (apiResp.status === 404 || apiResp.status === 405) {
      throw new Error(
        "当前 AI 接口不支持语音识别（/audio/transcriptions）。请在「设置」中配置支持 Whisper 的服务地址与 Key。"
      );
    }
    throw new Error(
      `语音识别失败 (${apiResp.status}): ${bodyText.slice(0, 200)}`
    );
  }

  try {
    return JSON.parse(bodyText) as WhisperResponse;
  } catch {
    // 某些站点 verbose_json 未生效，退化为纯文本
    return { text: bodyText };
  }
}

/**
 * 从多个分镜的配音识别生成字幕（全片时间轴）。
 *
 * @param scenes 带配音 URL 与成片起点的分镜列表
 * @param config 用户 AI 配置（复用 LLM 的 baseUrl/apiKey）
 * @param options 模型与语言；model 缺省 whisper-1
 * @returns 按时间排序的字幕列表；无任何可识别音频时返回空数组
 */
export async function transcribeScenes(
  scenes: TranscribeScene[],
  config: AIServiceConfig,
  options?: { model?: string; language?: string }
): Promise<TranscribedSubtitle[]> {
  const model = options?.model || "whisper-1";
  const language = options?.language;

  const out: TranscribedSubtitle[] = [];
  for (const scene of scenes) {
    if (!scene.audioUrl) continue;
    const speed =
      scene.speed != null && !isNaN(Number(scene.speed))
        ? Math.max(0.25, Number(scene.speed))
        : 1;
    // 识别相对时间 → 成片时间轴：t = 片段起点 + 相对时间 / 倍速
    const toTimeline = (srcT: number) =>
      scene.start + Math.max(0, srcT) / speed;

    let data: WhisperResponse;
    try {
      data = await transcribeOne(scene.audioUrl, config, model, language);
    } catch (err) {
      // 单个分镜识别失败不阻塞其余分镜；接口级错误（404/405）则直接抛出
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("/audio/transcriptions")) throw err;
      log.warn(`分镜 ${scene.id} 语音识别失败，跳过: ${msg}`);
      continue;
    }

    if (Array.isArray(data.segments) && data.segments.length > 0) {
      for (const s of data.segments) {
        const text = String(s.text || "").trim();
        if (!text) continue;
        out.push({
          start: +toTimeline(s.start).toFixed(2),
          end: +toTimeline(s.end).toFixed(2),
          text,
        });
      }
    } else if (data.text && String(data.text).trim()) {
      // 无分段信息：整段配音作为一条字幕（结束时间用配音相对时长无法得知，
      // 退化为从起点起一个合理时长，由前端可再编辑）
      out.push({
        start: +scene.start.toFixed(2),
        end: +(scene.start + 3).toFixed(2),
        text: String(data.text).trim(),
      });
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}
