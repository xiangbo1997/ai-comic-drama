/**
 * 支付回调时间戳新鲜度校验 —— 纯函数单测
 *
 * 只测 isWebhookTimestampFresh 的窗口判定；签名验签本身依赖真实密钥/证书，
 * 不在此覆盖（由 verifyCallback / verifyWebhook 的集成路径承担）。
 */

import { describe, it, expect } from "vitest";
import {
  isWebhookTimestampFresh,
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
} from "@/services/payment";

/** 固定"当前时间"，避免用例受真实时钟影响 */
const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

describe("isWebhookTimestampFresh", () => {
  it("当前时间戳判定为新鲜", () => {
    expect(isWebhookTimestampFresh(NOW_SEC, NOW_MS)).toBe(true);
  });

  it("窗口内的过去时间戳放行", () => {
    const ts = NOW_SEC - (WEBHOOK_TIMESTAMP_TOLERANCE_SEC - 1);
    expect(isWebhookTimestampFresh(ts, NOW_MS)).toBe(true);
  });

  it("窗口内的未来时间戳放行（容忍本机时钟慢于对端）", () => {
    const ts = NOW_SEC + (WEBHOOK_TIMESTAMP_TOLERANCE_SEC - 1);
    expect(isWebhookTimestampFresh(ts, NOW_MS)).toBe(true);
  });

  it("恰好落在边界上放行", () => {
    const past = NOW_SEC - WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
    const future = NOW_SEC + WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
    expect(isWebhookTimestampFresh(past, NOW_MS)).toBe(true);
    expect(isWebhookTimestampFresh(future, NOW_MS)).toBe(true);
  });

  it("超出窗口的旧时间戳拒绝（重放攻击）", () => {
    const ts = NOW_SEC - (WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 1);
    expect(isWebhookTimestampFresh(ts, NOW_MS)).toBe(false);
  });

  it("超出窗口的未来时间戳拒绝", () => {
    const ts = NOW_SEC + (WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 1);
    expect(isWebhookTimestampFresh(ts, NOW_MS)).toBe(false);
  });

  it("接受字符串形态的时间戳（HTTP 头原样传入）", () => {
    expect(isWebhookTimestampFresh(String(NOW_SEC), NOW_MS)).toBe(true);
  });

  it("非法/缺失时间戳一律拒绝", () => {
    expect(isWebhookTimestampFresh("", NOW_MS)).toBe(false);
    expect(isWebhookTimestampFresh("abc", NOW_MS)).toBe(false);
    expect(isWebhookTimestampFresh(0, NOW_MS)).toBe(false);
    expect(isWebhookTimestampFresh(-1, NOW_MS)).toBe(false);
    expect(isWebhookTimestampFresh(NaN, NOW_MS)).toBe(false);
  });

  it("支持自定义容差", () => {
    const ts = NOW_SEC - 30;
    expect(isWebhookTimestampFresh(ts, NOW_MS, 10)).toBe(false);
    expect(isWebhookTimestampFresh(ts, NOW_MS, 60)).toBe(true);
  });
});
