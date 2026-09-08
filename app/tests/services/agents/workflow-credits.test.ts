/**
 * Workflow 扣费幂等键特征测试
 *
 * `wf:{runId}:{sceneId}:{kind}` 是 workflow 重跑不重复扣费的唯一依据：
 * chargeWorkflowItem 事务内按该 sourceId 查历史流水，命中即跳过。格式一旦漂移，
 * 旧流水查不到 → 同一场景被二次扣费（真金白银）。故此处逐字锁定。
 */

import { describe, it, expect } from "vitest";

// credits.ts 透过 lib/prisma 建 pg Pool（仅构造对象，不发起连接），无 DATABASE_URL
// 时 import 阶段即抛错。给一个占位串让模块能载入；本测试只跑纯函数，不碰数据库。
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

const { buildWorkflowChargeSourceId } =
  await import("@/services/agents/workflow/credits");
type WorkflowChargeKind = "image" | "video" | "tts";

describe("buildWorkflowChargeSourceId()", () => {
  it("格式为 wf:{runId}:{sceneId}:{kind}", () => {
    expect(buildWorkflowChargeSourceId("run1", "scene1", "image")).toBe(
      "wf:run1:scene1:image"
    );
  });

  it("三种扣费种类各自独立成键（同场景可分别扣图/视频/配音）", () => {
    const kinds: WorkflowChargeKind[] = ["image", "video", "tts"];
    const ids = kinds.map((k) => buildWorkflowChargeSourceId("r", "s", k));
    expect(ids).toEqual(["wf:r:s:image", "wf:r:s:video", "wf:r:s:tts"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("同 run 不同场景、同场景不同 run 均不共键", () => {
    const a = buildWorkflowChargeSourceId("run1", "sceneA", "video");
    const b = buildWorkflowChargeSourceId("run1", "sceneB", "video");
    const c = buildWorkflowChargeSourceId("run2", "sceneA", "video");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("同一组入参恒等（幂等判定的前提）", () => {
    expect(buildWorkflowChargeSourceId("r", "s", "tts")).toBe(
      buildWorkflowChargeSourceId("r", "s", "tts")
    );
  });
});
