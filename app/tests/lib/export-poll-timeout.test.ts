import { describe, expect, it } from "vitest";
import {
  EXPORT_POLL_TIMEOUT_MS,
  hasExportPollTimedOut,
} from "@/lib/export-progress";

describe("导出轮询等待窗口", () => {
  it("允许超过旧的五分钟，覆盖实际约十三分钟的导出", () => {
    expect(hasExportPollTimedOut(0, 5 * 60_000)).toBe(false);
    expect(hasExportPollTimedOut(0, 13 * 60_000)).toBe(false);
  });

  it("三十分钟仍未完成才停止等待，使用实际时间而非轮询次数", () => {
    expect(EXPORT_POLL_TIMEOUT_MS).toBe(30 * 60_000);
    expect(hasExportPollTimedOut(1000, 1000 + EXPORT_POLL_TIMEOUT_MS - 1)).toBe(
      false
    );
    expect(hasExportPollTimedOut(1000, 1000 + EXPORT_POLL_TIMEOUT_MS)).toBe(
      true
    );
  });
});
