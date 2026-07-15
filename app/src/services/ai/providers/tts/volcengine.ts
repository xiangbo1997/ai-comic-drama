/**
 * 火山引擎 TTS Provider
 */

import type { TTSProvider } from "../../types";
import { resolveVolcengineCredentials } from "./volcengine-config";

export const volcengineTTS: TTSProvider = {
  async synthesizeSpeech(options, config) {
    const {
      text,
      voiceId = "zh_female_shuangkuaisisi_moon_bigtts",
      speed = 1.0,
    } = options;
    // 凭证解析与连通性测试共用同一函数（volcengine-config），根治「测试过生成挂」：
    // 用户在 extraConfig 填的 appId/accessToken 此前被生成路径忽略。
    const { accessToken: token, appId } = resolveVolcengineCredentials(config);

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
            appid: appId,
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

    // 防呆：非标准中转可能返回 code:3000 却缺 data 字段，Buffer.from(undefined) 会崩
    if (typeof result.data !== "string" || !result.data) {
      throw new Error("火山引擎 TTS 返回成功码但缺少音频数据（data 字段为空）");
    }

    return Buffer.from(result.data, "base64");
  },
};
