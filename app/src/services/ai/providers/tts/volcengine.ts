/**
 * 火山引擎 TTS Provider
 */

import type { TTSProvider } from "../../types";
import type { AIServiceConfig, TTSOptions } from "@/types";
import { resolveVolcengineCredentials } from "./volcengine-config";
import { mapEmotionToVolcengine } from "@/lib/tts-emotion";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai:tts:volcengine");

/**
 * 火山家族默认语速：1.1（漫剧快节奏惯例）。
 *
 * 漫剧配音普遍以 ~1.1–1.2x 语速推进，1.0 的「照本宣科」是听感 AI 破绽之一。仅在
 * 调用方未显式传 speed 时套用；用户在编辑器调过的 ttsSpeed 会经 options.speed
 * 透传，优先级更高（不被本默认覆盖）。
 */
const DEFAULT_SPEED_RATIO = 1.1;

/**
 * 调一次火山 TTS。抽出以支持「带情绪失败后不带情绪重试」——某些声线不支持
 * emotion 参数时 API 会报错，情绪属增强项，绝不能因此阻断配音。
 */
async function callVolcengineTTS(params: {
  text: string;
  voiceId: string;
  speed: number;
  token: string;
  appId?: string;
  emotion?: string;
}): Promise<Buffer> {
  const { text, voiceId, speed, token, appId, emotion } = params;

  const response = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer; ${token}`,
    },
    body: JSON.stringify({
      app: {
        appid: appId,
        token,
        cluster: "volcano_tts",
      },
      user: { uid: "user" },
      audio: {
        voice_type: voiceId,
        encoding: "mp3",
        speed_ratio: speed,
        // 情绪（批3）：有值时下发 emotion + 开启情绪合成；neutral/未知不进此分支。
        ...(emotion ? { emotion, enable_emotion: true } : {}),
      },
      request: {
        reqid: `req_${Date.now()}`,
        text,
        operation: "query",
      },
    }),
  });

  const result = await response.json();

  if (result.code !== 3000) {
    throw new Error(`TTS error: ${result.message}`);
  }

  // 防呆：非标准中转可能返回 code:3000 却缺 data 字段，Buffer.from(undefined) 会崩
  if (typeof result.data !== "string" || !result.data) {
    throw new Error("火山引擎 TTS 返回成功码但缺少音频数据（data 字段为空）");
  }

  return Buffer.from(result.data, "base64");
}

export const volcengineTTS: TTSProvider = {
  async synthesizeSpeech(options: TTSOptions, config: AIServiceConfig) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = DEFAULT_SPEED_RATIO,
    } = options;
    // 凭证解析与连通性测试共用同一函数（volcengine-config），根治「测试过生成挂」：
    // 用户在 extraConfig 填的 appId/accessToken 此前被生成路径忽略。
    const { accessToken: token, appId } = resolveVolcengineCredentials(config);

    if (!token) {
      throw new Error("未配置 TTS 服务，请在 AI 模型配置页面添加配置");
    }

    const emotion = mapEmotionToVolcengine(options.emotion);

    try {
      return await callVolcengineTTS({
        text,
        voiceId,
        speed,
        token,
        appId,
        emotion,
      });
    } catch (err) {
      // 情绪属增强项：带情绪失败（部分声线不支持 emotion）时不带情绪重试一次，
      // 绝不因情绪合成失败阻断配音。无情绪时直接抛出原错误。
      if (emotion) {
        log.warn("火山 TTS 带情绪合成失败，回退无情绪重试", {
          emotion,
          error: err instanceof Error ? err.message : String(err),
        });
        return await callVolcengineTTS({ text, voiceId, speed, token, appId });
      }
      throw err;
    }
  },
};
