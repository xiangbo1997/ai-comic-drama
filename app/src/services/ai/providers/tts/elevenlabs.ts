/**
 * ElevenLabs TTS Provider
 */

import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";
import { mapEmotionToElevenLabs } from "@/lib/tts-emotion";

export const elevenlabsTTS: TTSProvider = {
  async synthesizeSpeech(options, config) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = 1.0,
    } = options;
    const effectiveVoiceId =
      voiceId !== "zh_female_shuangkuaisisi_moon_bigtts"
        ? voiceId
        : config.model || "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs 默认 Rachel

    const baseUrl = trimUrl(config.baseUrl) || "https://api.elevenlabs.io/v1";
    const url = `${baseUrl}/text-to-speech/${effectiveVoiceId}`;

    // 情绪化 voice_settings（批3）：有情绪时按情绪覆盖 stability/style，让配音有张力；
    // neutral/未知/缺省时 emotionSettings 为 undefined，保持 provider 默认设置。
    const emotionSettings = mapEmotionToElevenLabs(options.emotion);
    const voiceSettings = {
      stability: emotionSettings?.stability ?? 0.5,
      similarity_boost: 0.75,
      // style 仅在情绪化时下发（默认不带此键，保持向后兼容的原始行为）
      ...(emotionSettings ? { style: emotionSettings.style } : {}),
      speed,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: voiceSettings,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS 错误: ${response.status} ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  },
};
