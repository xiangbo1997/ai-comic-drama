import { describe, it, expect } from "vitest";
import {
  resolvePolicy,
  DEFAULT_CLOSED_LOOP_POLICIES,
} from "@/services/agents/closed-loop";
import type { WorkflowContext } from "@/services/agents/types";

function ctxWith(config: Partial<WorkflowContext["config"]>): WorkflowContext {
  return {
    config: {
      mode: "auto",
      maxImageReflectionRounds: 3,
      style: "anime",
      ...config,
    },
  } as unknown as WorkflowContext;
}

describe("resolvePolicy()", () => {
  it("缺省时用默认策略", () => {
    const p = resolvePolicy(ctxWith({}), "characterBible");
    expect(p).toEqual(DEFAULT_CLOSED_LOOP_POLICIES.characterBible);
  });

  it("imageConsistency 向后兼容 maxImageReflectionRounds", () => {
    const p = resolvePolicy(
      ctxWith({ maxImageReflectionRounds: 5 }),
      "imageConsistency"
    );
    expect(p.enabled).toBe(true);
    expect(p.maxRounds).toBe(5); // 来自旧字段，非默认的 3
  });

  it("config.closedLoops 显式配置优先于默认", () => {
    const p = resolvePolicy(
      ctxWith({
        closedLoops: {
          storyboard: { enabled: true, maxRounds: 4, passThreshold: 85 },
        },
      }),
      "storyboard"
    );
    expect(p).toEqual({ enabled: true, maxRounds: 4, passThreshold: 85 });
  });

  it("默认策略：仅 imageConsistency 开启", () => {
    expect(DEFAULT_CLOSED_LOOP_POLICIES.imageConsistency.enabled).toBe(true);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.characterBible.enabled).toBe(false);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.storyboard.enabled).toBe(false);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.videoCoherence.enabled).toBe(false);
  });
});
