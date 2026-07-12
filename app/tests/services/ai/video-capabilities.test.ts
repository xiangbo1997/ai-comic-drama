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
