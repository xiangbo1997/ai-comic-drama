/**
 * OpenAI 兼容 TTS Provider
 */

import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";
import { safeFetch } from "@/lib/url-guard";

export const openaiCompatibleTTS: TTSProvider = {
  async synthesizeSpeech(options, config) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = 1.0,
    } = options;
    const baseUrl = trimUrl(config.baseUrl);
    const voice =
      voiceId !== "zh_female_shuangkuaisisi_moon_bigtts" ? voiceId : "alloy";
    const model = config.model || "tts-1";

    // SSRF：baseUrl 用户可控，走 safeFetch（钉 IP + 禁跟随重定向）
    const response = await safeFetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        speed,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS 错误: ${response.status} ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  },
};
