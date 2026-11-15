/** Grok /tts 使用text/voice_id，与OpenAI的/audio/speech分别适配。 */
import type { TTSProvider } from "../../types";
import { safeFetch } from "@/lib/url-guard";
import { trimUrl } from "../base";
import { readMP3AudioResponse } from "./audio-response";

export const grokTTS: TTSProvider = {
  async synthesizeSpeech(options, config, requestOptions) {
    const requestedVoice = options.voiceId?.trim();
    const voice =
      !requestedVoice ||
      requestedVoice === "default" ||
      requestedVoice.startsWith("zh_")
        ? config.extraConfig?.voiceId?.trim() || "eve"
        : requestedVoice;
    const response = await safeFetch(`${trimUrl(config.baseUrl)}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "grok-voice-latest",
        text: options.text,
        voice_id: voice,
        language: config.extraConfig?.language?.trim() || "zh",
        output_format: { codec: "mp3" },
      }),
      signal: requestOptions?.signal,
    });
    return readMP3AudioResponse(response, "Grok ");
  },
};
