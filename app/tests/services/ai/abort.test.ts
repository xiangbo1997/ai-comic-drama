import { describe, it, expect } from "vitest";
import {
  TimeoutAbortError,
  isTimeoutAbortError,
  isAbortError,
  mergeSignals,
  throwIfAborted,
} from "@/services/ai/abort";

describe("isTimeoutAbortError", () => {
  it("识别 TimeoutAbortError", () => {
    expect(isTimeoutAbortError(new TimeoutAbortError("超时 (1000ms)"))).toBe(
      true
    );
  });

  it("普通错误 / AbortError 都不算超时中止", () => {
    expect(isTimeoutAbortError(new Error("boom"))).toBe(false);
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    expect(isTimeoutAbortError(aborted)).toBe(false);
    expect(isTimeoutAbortError("not an error")).toBe(false);
  });

  it("保留超时文案，供上层与用户看到明确原因", () => {
    const err = new TimeoutAbortError("LLM chatCompletion timeout (120000ms)");
    expect(err.message).toBe("LLM chatCompletion timeout (120000ms)");
    expect(err.name).toBe("TimeoutAbortError");
  });
});

describe("isAbortError", () => {
  it("按 name 识别 AbortError", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("真实 AbortController 中止 fetch 风格错误可被识别", () => {
    const controller = new AbortController();
    controller.abort();
    // DOMException 形态同样带 name === "AbortError"
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });

  it("普通错误不误判", () => {
    expect(isAbortError(new Error("network down"))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe("mergeSignals", () => {
  it("全部为空 → undefined（调用方不下发 signal）", () => {
    expect(mergeSignals(undefined, undefined)).toBeUndefined();
  });

  it("只有一个 → 原样返回，不额外包一层", () => {
    const controller = new AbortController();
    expect(mergeSignals(controller.signal, undefined)).toBe(controller.signal);
  });

  it("任一触发即中止（第一个）", () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = mergeSignals(a.signal, b.signal);
    expect(merged?.aborted).toBe(false);
    a.abort();
    expect(merged?.aborted).toBe(true);
  });

  it("任一触发即中止（第二个）", () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = mergeSignals(a.signal, b.signal);
    b.abort();
    expect(merged?.aborted).toBe(true);
  });
});

describe("throwIfAborted", () => {
  it("未中止时什么都不做", () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it("已中止时抛 AbortError（供轮询循环退出）", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(/已被中止/);
    try {
      throwIfAborted(controller.signal);
    } catch (err) {
      expect(isAbortError(err)).toBe(true);
    }
  });
});
