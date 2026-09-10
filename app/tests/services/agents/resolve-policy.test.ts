import { describe, it, expect, vi } from "vitest";

// closed-loop 经 lib/system-config 间接 import lib/prisma（模块加载即要求
// DATABASE_URL）。本文件只测策略解析纯逻辑，故把系统配置读取整体桩掉。
vi.mock("@/lib/system-config", () => ({
  getSystemConfig: vi.fn().mockResolvedValue(false),
}));

import {
  resolvePolicy,
  resolvePolicyAsync,
  DEFAULT_CLOSED_LOOP_POLICIES,
} from "@/services/agents/closed-loop";
import { getSystemConfig } from "@/lib/system-config";
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

  // 默认值按「这一轮 LLM 调用能否改变产物」定：
  // - imageConsistency / characterBible：真闭环（后者评分还是纯函数），默认开；
  // - storyboard：已补上重生成（评审不达标即带六维评语回注 prompt 重出分镜），
  //   1 次纯文本调用相对后续几十张图 + 几十段视频可忽略，故默认开、maxRounds=1；
  // - videoCoherence：仍只评分不重生成，且评审是多模态调用，故默认关。
  it("默认策略：能改变产物的闭环开启，只评分不重生成的默认关闭", () => {
    expect(DEFAULT_CLOSED_LOOP_POLICIES.imageConsistency.enabled).toBe(true);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.characterBible.enabled).toBe(true);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.storyboard.enabled).toBe(true);
    // 一次修订足够：控制成本与用户感知时延
    expect(DEFAULT_CLOSED_LOOP_POLICIES.storyboard.maxRounds).toBe(1);
    expect(DEFAULT_CLOSED_LOOP_POLICIES.videoCoherence.enabled).toBe(false);
  });
});

describe("resolvePolicyAsync() — 系统配置开关", () => {
  it("无项目级策略时，enabled 跟随系统配置", async () => {
    vi.mocked(getSystemConfig).mockResolvedValue(true);
    const p = await resolvePolicyAsync(ctxWith({}), "storyboard");
    expect(p.enabled).toBe(true);
    // 其余字段仍来自默认策略
    expect(p.maxRounds).toBe(DEFAULT_CLOSED_LOOP_POLICIES.storyboard.maxRounds);
  });

  it("系统配置关闭时 enabled=false", async () => {
    vi.mocked(getSystemConfig).mockResolvedValue(false);
    const p = await resolvePolicyAsync(ctxWith({}), "characterBible");
    expect(p.enabled).toBe(false);
  });

  // 项目级显式策略是调用方的明确意图，不该被全局开关反悔
  it("项目级 closedLoops 优先于系统配置，且不查配置", async () => {
    vi.mocked(getSystemConfig).mockClear();
    vi.mocked(getSystemConfig).mockResolvedValue(false);
    const p = await resolvePolicyAsync(
      ctxWith({
        closedLoops: {
          storyboard: { enabled: true, maxRounds: 4, passThreshold: 85 },
        },
      }),
      "storyboard"
    );
    expect(p).toEqual({ enabled: true, maxRounds: 4, passThreshold: 85 });
    expect(getSystemConfig).not.toHaveBeenCalled();
  });

  // imageConsistency 无开关：一直开，行为不变
  it("imageConsistency 不读系统配置", async () => {
    vi.mocked(getSystemConfig).mockClear();
    const p = await resolvePolicyAsync(ctxWith({}), "imageConsistency");
    expect(p.enabled).toBe(true);
    expect(getSystemConfig).not.toHaveBeenCalled();
  });
});
