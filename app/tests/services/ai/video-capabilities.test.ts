import { describe, it, expect } from "vitest";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";

describe("getVideoModelCapability — 已知协议", () => {
  it("flow2api（Veo）：8s 原生、忽略 duration、支持 FL", () => {
    const cap = getVideoModelCapability("flow2api");
    expect(cap.nativeClipSeconds).toBe(8);
    expect(cap.acceptsDurationParam).toBe(false);
    expect(cap.requestableDurations).toEqual([]);
    expect(cap.supportsFirstLastFrame).toBe(true);
    expect(cap.maxChainSegments).toBe(6);
  });

  it("runway：仅接受 5/10 档（与 provider 吸附档位一致）、无 FL", () => {
    const cap = getVideoModelCapability("runway");
    expect(cap.acceptsDurationParam).toBe(true);
    expect(cap.requestableDurations).toEqual([5, 10]);
    expect(cap.supportsFirstLastFrame).toBe(false);
  });

  it("fal：接受档位、无 FL", () => {
    const cap = getVideoModelCapability("fal");
    expect(cap.acceptsDurationParam).toBe(true);
    expect(cap.supportsFirstLastFrame).toBe(false);
  });

  it("proxy-unified / openai：接受档位", () => {
    expect(getVideoModelCapability("proxy-unified").acceptsDurationParam).toBe(
      true
    );
    expect(getVideoModelCapability("openai").acceptsDurationParam).toBe(true);
  });
});

describe("getVideoModelCapability — 按模型 ID 细分（优先于 protocol）", () => {
  it("Veo FL 模型 → 8s 固定、忽略 duration、支持首尾帧", () => {
    const cap = getVideoModelCapability("flow2api", "veo_3_1_i2v_s_fast_fl");
    expect(cap.nativeClipSeconds).toBe(8);
    expect(cap.acceptsDurationParam).toBe(false);
    expect(cap.requestableDurations).toEqual([]);
    expect(cap.supportsFirstLastFrame).toBe(true);
  });

  it("非 FL 的 Veo（i2v/t2v/r2v）→ 8s 固定但不支持首尾帧", () => {
    for (const model of [
      "veo_3_1_i2v_s_landscape",
      "veo_3_1_t2v_fast_portrait",
      "veo_3_1_r2v_fast",
    ]) {
      const cap = getVideoModelCapability("flow2api", model);
      expect(cap.nativeClipSeconds).toBe(8);
      expect(cap.acceptsDurationParam).toBe(false);
      expect(cap.supportsFirstLastFrame).toBe(false);
    }
  });

  it("大小写不敏感：模型 ID 大写同样命中", () => {
    const cap = getVideoModelCapability("flow2api", "VEO_3_1_I2V_S_FAST_FL");
    expect(cap.supportsFirstLastFrame).toBe(true);
    expect(cap.acceptsDurationParam).toBe(false);
  });

  it("Runway gen3a_turbo → 5/10 档", () => {
    const cap = getVideoModelCapability("runway", "gen3a_turbo");
    expect(cap.acceptsDurationParam).toBe(true);
    expect(cap.requestableDurations).toEqual([5, 10]);
    expect(cap.supportsFirstLastFrame).toBe(false);
  });

  it("MiniMax 系列 → 5/10 档", () => {
    const cap = getVideoModelCapability(
      "fal",
      "fal-ai/minimax/video-01-live/image-to-video"
    );
    expect(cap.requestableDurations).toEqual([5, 10]);
    expect(cap.nativeClipSeconds).toBe(10);
  });

  it("关键场景：proxy-unified + Veo 模型 → 命中 Veo 条目而非中转协议的 5/10/15", () => {
    const cap = getVideoModelCapability(
      "proxy-unified",
      "veo_3_1_i2v_s_fast_fl"
    );
    // 若只按 protocol 判断会得到 acceptsDurationParam=true / 15s，
    // 从而按 15s 计费却实出 8s —— 模型表优先正是为了堵住这个失配
    expect(cap.acceptsDurationParam).toBe(false);
    expect(cap.nativeClipSeconds).toBe(8);
    expect(cap.supportsFirstLastFrame).toBe(true);
  });

  it("未收录的模型 → 回落 protocol 表（不臆造时长）", () => {
    // kling / sora / luma 等本仓库无能力证据，必须回落而非编造
    const cap = getVideoModelCapability("runway", "kling-v1.5");
    expect(cap.requestableDurations).toEqual([5, 10]);

    const proxied = getVideoModelCapability("proxy-unified", "sora-2");
    expect(proxied.requestableDurations).toEqual([5, 10, 15]);
    expect(proxied.acceptsDurationParam).toBe(true);
  });

  it("空模型 ID → 回落 protocol 表", () => {
    const cap = getVideoModelCapability("flow2api", "");
    expect(cap.nativeClipSeconds).toBe(8);
    expect(cap.supportsFirstLastFrame).toBe(true);
  });

  it("未知 protocol + 未收录模型 → 默认能力", () => {
    const cap = getVideoModelCapability("mystery", "mystery-model-v9");
    expect(cap.requestableDurations).toEqual([5, 10, 15]);
    expect(cap.nativeClipSeconds).toBe(15);
  });
});

describe("getVideoModelCapability — 未知协议回落默认能力（当前单段行为）", () => {
  it("未知协议 → 5/10/15 档、单段、无 FL", () => {
    const cap = getVideoModelCapability("some-unknown-protocol");
    expect(cap.acceptsDurationParam).toBe(true);
    expect(cap.requestableDurations).toEqual([5, 10, 15]);
    expect(cap.supportsFirstLastFrame).toBe(false);
    expect(cap.maxChainSegments).toBe(6);
  });

  it("空协议 → 默认能力", () => {
    const cap = getVideoModelCapability("");
    expect(cap.nativeClipSeconds).toBe(15);
  });
});
