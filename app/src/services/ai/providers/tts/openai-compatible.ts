/**
 * OpenAI 兼容 TTS Provider
 */

import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";
import { safeFetch } from "@/lib/url-guard";
import { readMP3AudioResponse } from "./audio-response";

export const openaiCompatibleTTS: TTSProvider = {
  async synthesizeSpeech(options, config, requestOptions) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = 1.0,
    } = options;
    const baseUrl = trimUrl(config.baseUrl);
    const voice =
      voiceId && voiceId !== "default" && !voiceId.startsWith("zh_")
        ? voiceId
        : "alloy";
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
        response_format: "mp3",
        speed,
      }),
      signal: requestOptions?.signal,
    });

    return readMP3AudioResponse(response, "OpenAI 兼容服务");
  },
};
