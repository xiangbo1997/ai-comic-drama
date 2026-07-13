import { describe, it, expect } from "vitest";
import { shouldGenerateTailFrame } from "@/services/generation/tail-frame";

/**
 * shouldGenerateTailFrame 真值表：v1 只在四个条件同时满足时生成镜内尾帧——
 * variationType==="large" && !hasClientLastFrame && supportsLastFrame && hasSceneImage。
 */
describe("shouldGenerateTailFrame — 镜内尾帧裁决真值表（包 B）", () => {
  /** 四条件全满足（唯一 true 组合） */
  const allTrue = {
    variationType: "large",
    hasClientLastFrame: false,
    supportsLastFrame: true,
    hasSceneImage: true,
  } as const;

  it("四条件全满足 → true", () => {
    expect(shouldGenerateTailFrame({ ...allTrue })).toBe(true);
  });

  it("variationType=medium → false（v1 只放行 large，medium 观望）", () => {
    expect(
      shouldGenerateTailFrame({ ...allTrue, variationType: "medium" })
    ).toBe(false);
  });

  it("variationType=small → false", () => {
    expect(
      shouldGenerateTailFrame({ ...allTrue, variationType: "small" })
    ).toBe(false);
  });

  it("variationType 缺失 → false", () => {
    expect(
      shouldGenerateTailFrame({ ...allTrue, variationType: undefined })
    ).toBe(false);
  });

  it("有客户端跨镜尾帧 → false（videoLinkNext 优先，不争抢 FL 槽位）", () => {
    expect(
      shouldGenerateTailFrame({ ...allTrue, hasClientLastFrame: true })
    ).toBe(false);
  });

  it("模型不支持 FL → false（尾帧图无处可用）", () => {
    expect(
      shouldGenerateTailFrame({ ...allTrue, supportsLastFrame: false })
    ).toBe(false);
  });

  it("无首帧图 → false（编辑式生成缺基底）", () => {
    expect(shouldGenerateTailFrame({ ...allTrue, hasSceneImage: false })).toBe(
      false
    );
  });

  it("多条件同时不满足 → false", () => {
    expect(
      shouldGenerateTailFrame({
        variationType: "small",
        hasClientLastFrame: true,
        supportsLastFrame: false,
        hasSceneImage: false,
      })
    ).toBe(false);
  });
});
