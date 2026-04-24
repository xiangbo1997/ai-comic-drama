/**
 * ElevenLabs TTS Provider
 */

import type { TTSProvider } from "../../types";
import { trimUrl } from "../base";

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

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed,
        },
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
