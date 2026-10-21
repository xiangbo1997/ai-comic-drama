import { describe, expect, it, vi } from "vitest";
import { TimeoutAbortError } from "@/services/ai/abort";
import type { WorkflowContext } from "@/services/agents/types";

vi.mock("@/services/ai", async () => {
  const { isTimeoutAbortError } = await import("@/services/ai/abort");
  return {
    chatCompletion: vi.fn(),
    LONG_FORM_LLM_TIMEOUT_MS: 300_000,
    isTimeoutAbortError,
  };
});

import { chatCompletion } from "@/services/ai";
import { DramaScriptAgent } from "@/services/agents/drama-script-agent";

describe("DramaScriptAgent timeout", () => {
  it("模型调用超时后直接失败，不重复提交相同长请求", async () => {
    const mockedChat = vi.mocked(chatCompletion);
    mockedChat.mockRejectedValueOnce(
      new TimeoutAbortError("LLM chatCompletion timeout (300000ms)")
    );

    const ctx = {
      config: { mode: "auto", maxImageReflectionRounds: 0, style: "anime" },
    } as WorkflowContext;
    const result = await new DramaScriptAgent().run(
      { worldview: "一个悬疑故事的世界观。" },
      ctx
    );

    expect(result).toMatchObject({
      success: false,
      attempts: 1,
      error: "LLM chatCompletion timeout (300000ms)",
    });
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });
});
