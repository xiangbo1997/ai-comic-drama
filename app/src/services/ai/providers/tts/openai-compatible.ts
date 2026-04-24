/**
 * OpenAI 兼容 TTS Provider
 */

import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";

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

    const response = await fetch(`${baseUrl}/audio/speech`, {
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
