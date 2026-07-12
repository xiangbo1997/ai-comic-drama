/**
 * GPT-SoVITS TTS Provider（自建双卡网关，v2ProPlus）
 *
 * 参考音频克隆式中文 TTS：网关直接透传官方 GPT-SoVITS api_v2.py 的 /tts 接口，
 * 请求体 { text, text_lang, ref_audio_path, prompt_text?, prompt_lang, speed_factor?,
 * media_type, streaming_mode }，200 返回原始音频字节。
 *
 * 「音色」= AI 模型配置里通过 extraConfig 配置的参考音频（refAudioPath 必填，
 * promptText 提升相似度）。参考音频需先在网关 /docs 页用 /upload_ref 上传拿到服务端路径。
 *
 * voiceId 语义：以 "sovits:" 开头时，其余部分覆盖 ref_audio_path（为后续「按角色克隆
 * 音色」预留）；其他 voiceId（火山预设 ID / "default" / 空）一律忽略，回落到 extraConfig。
 */

import { spawn } from "node:child_process";
import { createLogger } from "@/lib/logger";
import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";

const log = createLogger("services:ai:tts:gpt-sovits");

/** 网关请求超时（毫秒）：克隆式合成偏慢，给足 5 分钟兜底 */
const REQUEST_TIMEOUT_MS = 300_000;

/** speed_factor 允许区间；scene.ttsSpeed 超界时收敛到端点 */
const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;

/** voiceId 覆盖 ref_audio_path 的前缀约定 */
const VOICE_OVERRIDE_PREFIX = "sovits:";

/** 解析后的音色参数 */
export interface SovitsVoice {
  refAudioPath?: string;
  promptText?: string;
  textLang: string;
  promptLang: string;
}

/**
 * 解析音色：voiceId 以 "sovits:" 开头则覆盖 ref_audio_path，否则回落 extraConfig。
 * textLang/promptLang 默认 "zh"。
 */
export function resolveSovitsVoice(
  voiceId: string | undefined,
  extraConfig?: Record<string, string>
): SovitsVoice {
  const overrideRef =
    voiceId && voiceId.startsWith(VOICE_OVERRIDE_PREFIX)
      ? voiceId.slice(VOICE_OVERRIDE_PREFIX.length).trim() || undefined
      : undefined;

  const refAudioPath =
    overrideRef || extraConfig?.refAudioPath?.trim() || undefined;
  const promptText = extraConfig?.promptText?.trim() || undefined;
  const textLang = extraConfig?.textLang?.trim() || "zh";
  const promptLang = extraConfig?.promptLang?.trim() || "zh";

  return { refAudioPath, promptText, textLang, promptLang };
}

/** /tts 请求体（官方 api_v2.py 兼容子集） */
export interface SovitsRequestBody {
  text: string;
  text_lang: string;
  ref_audio_path: string;
  prompt_lang: string;
  prompt_text?: string;
  speed_factor: number;
  media_type: "wav";
  streaming_mode: false;
}

/**
 * 组装 /tts 请求体。speed 收敛到 [0.5, 2.0]，缺省 1.0；prompt_text 为空则不带。
 * media_type 固定 wav（网关不支持 mp3），streaming_mode false 便于一次性取回整段。
 */
export function buildSovitsRequestBody(
  text: string,
  voice: SovitsVoice,
  speed?: number
): SovitsRequestBody {
  const speedFactor = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed ?? 1.0));

  const body: SovitsRequestBody = {
    text,
    text_lang: voice.textLang,
    ref_audio_path: voice.refAudioPath ?? "",
    prompt_lang: voice.promptLang,
    speed_factor: speedFactor,
    media_type: "wav",
    streaming_mode: false,
  };

  if (voice.promptText) {
    body.prompt_text = voice.promptText;
  }

  return body;
}

/**
 * wav → mp3 in-process 转码。
 *
 * 存在原因：网关无 mp3 输出（media_type: mp3 不受支持），而下游全链路统一按 mp3
 * 契约走（TTS 路由落 tts_*.mp3 + audio/mpeg，预览/导出均假定 mp3）。这里用 ffmpeg
 * 管道把 wav 转成 mp3 Buffer，让下游零改动。生产服务器已装 ffmpeg（视频导出依赖）。
 */
function transcodeWavToMp3(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "ffmpeg 未安装：无法把网关 wav 转码为 mp3，请在服务器安装 ffmpeg"
          )
        );
        return;
      }
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg 转码失败 (exit ${code}): ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.on("error", () => {
      // stdin 提前关闭（如 ffmpeg 因参数错误退出）会触发 EPIPE，
      // 真正的错误由 close/error 回调统一处理，这里吞掉避免未捕获异常。
    });
    ffmpeg.stdin.write(wav);
    ffmpeg.stdin.end();
  });
}

/** 网关错误响应形状：{ message, Exception? } */
interface SovitsErrorBody {
  message?: string;
  Exception?: string;
}

export const gptSovitsTTS: TTSProvider = {
  async synthesizeSpeech(options, config) {
    const { text, voiceId, speed } = options;

    const voice = resolveSovitsVoice(voiceId, config.extraConfig);
    if (!voice.refAudioPath) {
      throw new Error(
        "GPT-SoVITS 未配置参考音频：请在 AI 模型配置里填写「参考音频路径」" +
          "（先在网关 /docs 页用 /upload_ref 上传参考音频，拿到服务端路径后填入）"
      );
    }

    const baseUrl = trimUrl(config.baseUrl);
    if (!baseUrl) {
      throw new Error("GPT-SoVITS 未配置网关地址（Base URL）");
    }

    const body = buildSovitsRequestBody(text, voice, speed);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // 网关当前无鉴权；apiKey 非空时仍带上 Bearer，未来加鉴权可无缝启用。
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/tts`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `GPT-SoVITS 合成超时（${REQUEST_TIMEOUT_MS / 1000} 秒未返回）`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let detail = "";
      const raw = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(raw) as SovitsErrorBody;
        detail = [parsed.message, parsed.Exception]
          .filter((part): part is string => Boolean(part))
          .join(" | ");
      } catch {
        detail = raw.slice(0, 300);
      }
      throw new Error(
        `GPT-SoVITS 合成失败 (HTTP ${response.status}): ${detail || "未知错误"}`
      );
    }

    const wav = Buffer.from(await response.arrayBuffer());
    log.debug("GPT-SoVITS wav received, transcoding to mp3", {
      wavBytes: wav.length,
    });
    return transcodeWavToMp3(wav);
  },
};
