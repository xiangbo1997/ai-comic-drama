import { describe, it, expect } from "vitest";
import { formatApiError, toFriendlyError } from "@/lib/error-copy";

describe("formatApiError", () => {
  it("积分不足：保留结构化差额信息", () => {
    expect(
      formatApiError(
        { error: "Insufficient credits", required: 5, current: 2 },
        "生成失败"
      )
    ).toBe("积分不足：本次需 5 积分，当前剩余 2 积分");
  });

  it("积分不足但无差额字段：收敛为通用中文提示", () => {
    expect(formatApiError({ error: "Insufficient credits" }, "生成失败")).toBe(
      "积分不足，请充值后重试"
    );
    expect(
      formatApiError({ error: "积分不足", required: 10 }, "生成失败")
    ).toBe("积分不足，请充值后重试");
  });

  it("普通错误：透传服务端 error 字段", () => {
    expect(formatApiError({ error: "文本过长" }, "解析失败")).toBe("文本过长");
  });

  it("非法 payload：回落到 fallback", () => {
    expect(formatApiError(null, "生成失败")).toBe("生成失败");
    expect(formatApiError("oops", "生成失败")).toBe("生成失败");
    expect(formatApiError({ message: "x" }, "生成失败")).toBe("生成失败");
    expect(formatApiError({ error: 42 }, "生成失败")).toBe("生成失败");
  });
});

describe("toFriendlyError", () => {
  it("积分不足：附「去充值」出口，中文原文保留", () => {
    const fe = toFriendlyError(
      new Error("积分不足：本次需 5 积分，当前剩余 2 积分"),
      "生成失败"
    );
    expect(fe.message).toBe("积分不足：本次需 5 积分，当前剩余 2 积分");
    expect(fe.cta).toEqual({ label: "去充值", href: "/credits" });
  });

  it("积分不足英文原文：转通用中文 + 去充值", () => {
    const fe = toFriendlyError(new Error("Insufficient credits"), "生成失败");
    expect(fe.message).toBe("积分不足，请充值后重试");
    expect(fe.cta?.href).toBe("/credits");
  });

  it("未配置模型：附「去配置模型」出口，保留服务端中文指引", () => {
    const raw = "请先在「设置 > AI 模型配置」中配置大语言模型";
    const fe = toFriendlyError(new Error(raw), "解析失败");
    expect(fe.message).toBe(raw);
    expect(fe.cta).toEqual({
      label: "去配置模型",
      href: "/settings/ai-models",
    });
  });

  it("API Key 无效：指向模型配置", () => {
    const fe = toFriendlyError(new Error("Invalid API key provided"), "失败");
    expect(fe.message).toBe("API Key 无效或已失效，请检查模型配置");
    expect(fe.cta?.href).toBe("/settings/ai-models");
  });

  it("限流/额度：收敛为稍后重试文案，无 CTA", () => {
    expect(toFriendlyError(new Error("rate limit exceeded"), "失败")).toEqual({
      message: "请求过于频繁或服务额度受限，请稍后重试",
      cta: undefined,
    });
    expect(
      toFriendlyError(new Error("insufficient_quota"), "失败").message
    ).toBe("请求过于频繁或服务额度受限，请稍后重试");
  });

  it("会话过期：单独文案，不误报为 API Key 问题", () => {
    expect(toFriendlyError(new Error("Unauthorized"), "失败").message).toBe(
      "登录已过期，请刷新页面重新登录"
    );
  });

  it("签到重复：映射为中文", () => {
    expect(
      toFriendlyError(new Error("Already checked in today"), "签到失败").message
    ).toBe("今天已经签到过了");
  });

  it("未命中模式：中文原文直出，英文技术串收敛为 fallback", () => {
    expect(toFriendlyError(new Error("文本包含违禁词"), "失败").message).toBe(
      "文本包含违禁词"
    );
    expect(
      toFriendlyError(new Error("ECONNREFUSED 10.0.0.1:443"), "视频生成失败")
        .message
    ).toBe("视频生成失败");
    expect(toFriendlyError(undefined, "操作失败").message).toBe("操作失败");
  });
});
