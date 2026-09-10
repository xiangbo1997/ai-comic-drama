import { describe, it, expect, afterEach } from "vitest";
import {
  assertSafeUrl,
  assertSafeUrlLiteral,
  isAllowlistedInternalUrl,
  safeFetch,
} from "@/lib/url-guard";

const ORIGINAL = process.env.INTERNAL_API_ALLOWLIST;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.INTERNAL_API_ALLOWLIST;
  } else {
    process.env.INTERNAL_API_ALLOWLIST = ORIGINAL;
  }
});

describe("内网直连白名单（INTERNAL_API_ALLOWLIST）", () => {
  it("未配置时不放行任何内网地址（默认安全）", async () => {
    delete process.env.INTERNAL_API_ALLOWLIST;
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38003")).toBe(false);
    await expect(
      assertSafeUrl("http://127.0.0.1:38003/v1/chat/completions")
    ).rejects.toThrow(/内网|保留地址/);
  });

  it("配置后放行精确匹配的 origin", async () => {
    process.env.INTERNAL_API_ALLOWLIST = "http://127.0.0.1:38003";
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38003/v1")).toBe(true);
    await expect(
      assertSafeUrl("http://127.0.0.1:38003/v1/chat/completions")
    ).resolves.toBeUndefined();
    expect(() =>
      assertSafeUrlLiteral("http://127.0.0.1:38003/v1")
    ).not.toThrow();
  });

  it("端口不同不放行（origin 必须精确匹配）", async () => {
    process.env.INTERNAL_API_ALLOWLIST = "http://127.0.0.1:38003";
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38004")).toBe(false);
    await expect(assertSafeUrl("http://127.0.0.1:38004")).rejects.toThrow();
  });

  it("不因前缀相同而被绕过（防 evil.com 构造）", () => {
    process.env.INTERNAL_API_ALLOWLIST = "http://127.0.0.1:38003";
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38003.evil.com/v1")).toBe(
      false
    );
  });

  it("白名单外的云元数据地址仍被拦截", async () => {
    process.env.INTERNAL_API_ALLOWLIST = "http://127.0.0.1:38003";
    await expect(
      assertSafeUrl("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/内网|保留地址/);
  });

  it("支持多条目并忽略格式非法的条目", () => {
    process.env.INTERNAL_API_ALLOWLIST =
      "http://127.0.0.1:38003, not-a-url , http://127.0.0.1:38002";
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38003")).toBe(true);
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38002")).toBe(true);
    expect(isAllowlistedInternalUrl("http://127.0.0.1:38001")).toBe(false);
  });

  it("非 http/https 协议即使在白名单也拒绝", async () => {
    process.env.INTERNAL_API_ALLOWLIST = "file://127.0.0.1";
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/协议/);
  });
});

describe("safeFetch 出站路径同样受白名单约束", () => {
  // 回归用例：首次修复只放行了 assertSafeUrl，漏了 safeFetch 内部的
  // resolveValidated（钉 IP 防 DNS rebinding 的那一层），导致配置校验通过、
  // 真正发请求时仍被拦 —— 线上表现为「拒绝访问内网/保留地址: 127.0.0.1」。
  it("白名单外的内网地址仍被 safeFetch 拒绝", async () => {
    delete process.env.INTERNAL_API_ALLOWLIST;
    await expect(safeFetch("http://127.0.0.1:9/nope")).rejects.toThrow(
      /内网|保留地址/
    );
  });

  it("白名单内的地址不再因内网判定被拒（连接失败是另一类错误）", async () => {
    process.env.INTERNAL_API_ALLOWLIST = "http://127.0.0.1:9";
    // 端口 9 (discard) 无监听：预期是连接层失败，而非内网校验失败。
    await expect(safeFetch("http://127.0.0.1:9/nope")).rejects.not.toThrow(
      /内网|保留地址/
    );
  });
});
