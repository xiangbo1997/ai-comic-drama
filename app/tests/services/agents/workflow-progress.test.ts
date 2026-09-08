/**
 * Workflow 进度计算特征测试
 *
 * 锁定 `getWorkflowStatus` 拆分出的进度算法：前端进度条只吃这个数，
 * 分母（固定 7 步）或计入口径（只算 completed）漂移会让进度条静默说谎。
 */

import { describe, it, expect } from "vitest";
import {
  computeWorkflowProgress,
  TOTAL_WORKFLOW_STEPS,
} from "@/services/agents/workflow/progress";
import type { WorkflowStepInfo } from "@/services/agents/types";

function step(status: WorkflowStepInfo["status"]): WorkflowStepInfo {
  return {
    step: "parse_script",
    status,
    agentName: "script_parser",
    attempts: 1,
    tokensUsed: 0,
  };
}

describe("computeWorkflowProgress()", () => {
  it("固定分母为 7 步", () => {
    expect(TOTAL_WORKFLOW_STEPS).toBe(7);
  });

  it("无步骤时为 0", () => {
    expect(computeWorkflowProgress([])).toBe(0);
  });

  it("只统计 completed，running/failed/pending 均不计入", () => {
    const steps = [
      step("completed"),
      step("running"),
      step("failed"),
      step("pending"),
    ];
    // 4 个步骤里仅 1 个 completed → 1/7
    expect(computeWorkflowProgress(steps)).toBe(Math.round((1 / 7) * 100));
  });

  it("按 completed 步数线性递增并四舍五入取整", () => {
    const cases: Array<[number, number]> = [
      [1, 14],
      [2, 29],
      [3, 43],
      [4, 57],
      [5, 71],
      [6, 86],
      [7, 100],
    ];
    for (const [completed, expected] of cases) {
      const steps = Array.from({ length: completed }, () => step("completed"));
      expect(computeWorkflowProgress(steps)).toBe(expected);
    }
  });

  it("completed 超过 7 步时不封顶（超额步骤真实反映）", () => {
    const steps = Array.from({ length: 8 }, () => step("completed"));
    expect(computeWorkflowProgress(steps)).toBe(114);
  });
});
