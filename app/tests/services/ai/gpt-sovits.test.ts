import { describe, it, expect } from "vitest";
import {
  resolveSovitsVoice,
  buildSovitsRequestBody,
} from "@/services/ai/providers/tts/gpt-sovits";

describe("resolveSovitsVoice（音色解析）", () => {
  const extra = {
    refAudioPath: "/tmp/ref.wav",
    promptText: "参考文本",
    textLang: "en",
    promptLang: "ja",
  };

  it("voiceId 以 sovits: 开头时覆盖 ref_audio_path", () => {
    const voice = resolveSovitsVoice("sovits:/tmp/cloned.wav", extra);
    expect(voice.refAudioPath).toBe("/tmp/cloned.wav");
  });

  it("非 sovits: 前缀的 voiceId（火山预设 ID）被忽略，回落 extraConfig", () => {
    const voice = resolveSovitsVoice(
      "zh_female_shuangkuaisisi_moon_bigtts",
      extra
    );
    expect(voice.refAudioPath).toBe("/tmp/ref.wav");
  });

  it("voiceId 为 default / 空时同样回落 extraConfig", () => {
    expect(resolveSovitsVoice("default", extra).refAudioPath).toBe(
      "/tmp/ref.wav"
    );
    expect(resolveSovitsVoice("", extra).refAudioPath).toBe("/tmp/ref.wav");
    expect(resolveSovitsVoice(undefined, extra).refAudioPath).toBe(
      "/tmp/ref.wav"
    );
  });

  it("透传 extraConfig 的 promptText / textLang / promptLang", () => {
    const voice = resolveSovitsVoice(undefined, extra);
    expect(voice.promptText).toBe("参考文本");
    expect(voice.textLang).toBe("en");
    expect(voice.promptLang).toBe("ja");
  });

  it("缺省 textLang / promptLang 均为 zh", () => {
    const voice = resolveSovitsVoice(undefined, {
      refAudioPath: "/tmp/ref.wav",
    });
    expect(voice.textLang).toBe("zh");
    expect(voice.promptLang).toBe("zh");
    expect(voice.promptText).toBeUndefined();
  });

  it("无 refAudioPath 且无 sovits: 覆盖时 refAudioPath 为 undefined", () => {
    const voice = resolveSovitsVoice(undefined, {});
    expect(voice.refAudioPath).toBeUndefined();
    expect(
      resolveSovitsVoice(undefined, undefined).refAudioPath
    ).toBeUndefined();
  });

  it("sovits: 前缀但内容为空时不覆盖，回落 extraConfig", () => {
    expect(resolveSovitsVoice("sovits:", extra).refAudioPath).toBe(
      "/tmp/ref.wav"
    );
  });
});

describe("buildSovitsRequestBody（请求体组装）", () => {
  const voice = {
    refAudioPath: "/tmp/ref.wav",
    promptText: "参考文本",
    textLang: "zh",
    promptLang: "zh",
  };

  it("媒体类型固定 wav，非流式", () => {
    const body = buildSovitsRequestBody("你好", voice);
    expect(body.media_type).toBe("wav");
    expect(body.streaming_mode).toBe(false);
  });

  it("speed 缺省时 speed_factor 为 1.0", () => {
    expect(buildSovitsRequestBody("你好", voice).speed_factor).toBe(1.0);
  });

  it("speed 超过上限收敛到 2.0", () => {
    expect(buildSovitsRequestBody("你好", voice, 5).speed_factor).toBe(2.0);
  });

  it("speed 低于下限收敛到 0.5", () => {
    expect(buildSovitsRequestBody("你好", voice, 0.1).speed_factor).toBe(0.5);
  });

  it("区间内 speed 原样透传", () => {
    expect(buildSovitsRequestBody("你好", voice, 1.3).speed_factor).toBe(1.3);
  });

  it("prompt_text 非空时带上", () => {
    expect(buildSovitsRequestBody("你好", voice).prompt_text).toBe("参考文本");
  });

  it("prompt_text 为空时不带该字段", () => {
    const body = buildSovitsRequestBody("你好", {
      ...voice,
      promptText: undefined,
    });
    expect("prompt_text" in body).toBe(false);
  });

  it("透传文本与语言字段", () => {
    const body = buildSovitsRequestBody("你好", voice);
    expect(body.text).toBe("你好");
    expect(body.text_lang).toBe("zh");
    expect(body.prompt_lang).toBe("zh");
    expect(body.ref_audio_path).toBe("/tmp/ref.wav");
  });
});
