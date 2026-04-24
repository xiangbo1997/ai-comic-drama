/**
 * 火山引擎 TTS Provider
 */

import type { TTSProvider } from "../../types";

export const volcengineTTS: TTSProvider = {
  async synthesizeSpeech(options, config) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = 1.0,
    } = options;
    const token = config.apiKey || process.env.VOLC_ACCESS_TOKEN;

    if (!token) {
      throw new Error("未配置 TTS 服务，请在 AI 模型配置页面添加配置");
    }

    const response = await fetch(
      "https://openspeech.bytedance.com/api/v1/tts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer; ${token}`,
        },
        body: JSON.stringify({
          app: {
            appid: process.env.VOLC_APP_ID,
            token,
            cluster: "volcano_tts",
          },
          user: { uid: "user" },
          audio: {
            voice_type: voiceId,
            encoding: "mp3",
            speed_ratio: speed,
          },
          request: {
            reqid: `req_${Date.now()}`,
            text,
            operation: "query",
          },
        }),
      }
    );

    const result = await response.json();

    if (result.code !== 3000) {
      throw new Error(`TTS error: ${result.message}`);
    }

    return Buffer.from(result.data, "base64");
  },
};
