import { describe, expect, it } from "vitest";
import {
  AssistantExecutionOptionsZ,
  CreateAssistantExecutionZ,
  AssistantExecutionActionZ,
} from "@/lib/assistant-execution";

describe("助手执行授权参数", () => {
  it("预算和修复次数都有硬边界", () => {
    for (const maxCredits of [0, 10001, 0.1, Infinity])
      expect(AssistantExecutionOptionsZ.safeParse({ maxCredits }).success).toBe(
        false
      );
    for (const maxRepairRounds of [-1, 3, 0.1])
      expect(
        AssistantExecutionOptionsZ.safeParse({
          maxCredits: 10,
          maxRepairRounds,
        }).success
      ).toBe(false);
    expect(AssistantExecutionOptionsZ.parse({ maxCredits: 10 })).toEqual({
      maxCredits: 10,
      maxRepairRounds: 1,
      generateVideos: true,
    });
  });
  it("必须先选择当前集且操作都有UUID", () => {
    expect(
      CreateAssistantExecutionZ.safeParse({
        seriesId: "s1",
        requestId: "x",
        options: { maxCredits: 10 },
      }).success
    ).toBe(false);
    expect(
      AssistantExecutionActionZ.safeParse({
        action: "run_arbitrary_tool",
        requestId: "cd6e6199-37f8-48a9-90e8-68c680d50e56",
      }).success
    ).toBe(false);
    expect(
      AssistantExecutionActionZ.safeParse({
        action: "confirm",
        requestId: "cd6e6199-37f8-48a9-90e8-68c680d50e56",
      }).success
    ).toBe(true);
  });
});
