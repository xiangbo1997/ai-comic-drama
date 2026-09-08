import { describe, it, expect } from "vitest";
import {
  classifyPollFailure,
  MAX_POLL_FAILURES,
} from "@/lib/generation-task-client";

/**
 * 轮询失败容忍策略：生成任务轮询与导出进度轮询共用的单一真源。
 * 核心契约——瞬时故障（网络异常 / 5xx）要容忍，4xx 立即放弃。
 */
describe("classifyPollFailure", () => {
  it("网络异常（无状态码）在容忍次数内继续轮询", () => {
    for (let n = 1; n < MAX_POLL_FAILURES; n++) {
      expect(classifyPollFailure(n)).toEqual({ action: "continue" });
    }
  });

  it("网络异常达到容忍上限后放弃并给出网络文案", () => {
    const verdict = classifyPollFailure(MAX_POLL_FAILURES);
    expect(verdict.action).toBe("abort");
    expect(verdict.action === "abort" && verdict.message).toContain("网络异常");
  });

  it("5xx 在容忍次数内继续轮询", () => {
    expect(classifyPollFailure(1, 500)).toEqual({ action: "continue" });
    expect(classifyPollFailure(MAX_POLL_FAILURES - 1, 503)).toEqual({
      action: "continue",
    });
  });

  it("5xx 达到容忍上限后放弃并给出服务端文案", () => {
    const verdict = classifyPollFailure(MAX_POLL_FAILURES, 502);
    expect(verdict.action).toBe("abort");
    expect(verdict.action === "abort" && verdict.message).toContain("服务异常");
  });

  it("4xx 首次即放弃，且不自带文案（交由调用方取服务端 error）", () => {
    for (const status of [400, 401, 403, 404]) {
      const verdict = classifyPollFailure(1, status);
      expect(verdict.action).toBe("abort");
      expect(verdict.action === "abort" && verdict.message).toBe("");
    }
  });

  it("2xx/3xx 不属于瞬时故障，同样立即放弃（防误用于成功响应）", () => {
    expect(classifyPollFailure(1, 302).action).toBe("abort");
  });
});
