import { describe, it, expect } from "vitest";
import {
  isPrivateOrReservedIp,
  assertSafeUrl,
  assertSafeUrlLiteral,
  safeDownload,
} from "@/lib/url-guard";

describe("isPrivateOrReservedIp", () => {
  it("拦截 IPv4 内网/保留段", () => {
    expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true); // 10/8
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true); // 环回
    expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true); // 0/8
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true); // 云元数据
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true); // 172.16/12
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true); // 172.16/12 上界
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true); // 192.168/16
    expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true); // CGNAT
  });

  it("放行 IPv4 公网地址", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false); // 刚好越过 172.16/12
    expect(isPrivateOrReservedIp("100.128.0.1")).toBe(false); // 越过 CGNAT
  });

  it("拦截 IPv6 内网/保留地址", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true); // 环回
    expect(isPrivateOrReservedIp("::")).toBe(true); // 未指定
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true); // ULA
    expect(isPrivateOrReservedIp("fd12::1")).toBe(true); // ULA
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true); // 链路本地
    expect(isPrivateOrReservedIp("::ffff:169.254.169.254")).toBe(true); // v4-mapped 云元数据
  });

  it("放行 IPv6 公网地址", () => {
    expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("非法 IP 按不安全处理", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
    expect(isPrivateOrReservedIp("")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("拒绝非 http(s) 协议", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/协议/);
    await expect(assertSafeUrl("gopher://x")).rejects.toThrow(/协议/);
  });

  it("拒绝非法 URL", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow(/非法/);
  });

  it("拒绝 hostname 为内网/云元数据 IP 的 URL（不触发 DNS）", async () => {
    await expect(
      assertSafeUrl("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/内网|保留/);
    await expect(assertSafeUrl("http://127.0.0.1:8080/x")).rejects.toThrow(
      /内网|保留/
    );
    await expect(assertSafeUrl("https://10.0.0.5/")).rejects.toThrow(
      /内网|保留/
    );
  });

  it("放行 hostname 为公网 IP 的 URL", async () => {
    await expect(assertSafeUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});

describe("assertSafeUrlLiteral（同步字面量校验，落库前第一道闸）", () => {
  it("拒绝非 http(s) 协议", () => {
    expect(() => assertSafeUrlLiteral("file:///etc/passwd")).toThrow(/协议/);
    expect(() => assertSafeUrlLiteral("gopher://x")).toThrow(/协议/);
  });

  it("拒绝非法 URL", () => {
    expect(() => assertSafeUrlLiteral("not a url")).toThrow(/非法/);
  });

  it("拒绝 IP 字面量为内网/云元数据的 URL", () => {
    expect(() =>
      assertSafeUrlLiteral("http://169.254.169.254/latest/meta-data/")
    ).toThrow(/内网|保留/);
    expect(() => assertSafeUrlLiteral("http://127.0.0.1:8080/x")).toThrow(
      /内网|保留/
    );
    expect(() => assertSafeUrlLiteral("https://10.0.0.5/")).toThrow(
      /内网|保留/
    );
  });

  it("放行合法公网 http(s) URL（含域名，不做 DNS 解析）", () => {
    expect(() =>
      assertSafeUrlLiteral("https://api.openai.com/v1")
    ).not.toThrow();
    expect(() => assertSafeUrlLiteral("https://8.8.8.8/")).not.toThrow();
  });
});

describe("safeDownload（无网络的快速失败路径）", () => {
  it("拒绝非法 URL 与非 http(s) 协议", async () => {
    await expect(safeDownload("not a url")).rejects.toThrow(/非法 URL/);
    await expect(safeDownload("file:///etc/passwd")).rejects.toThrow(
      /不允许的协议/
    );
    await expect(safeDownload("gopher://example.com/")).rejects.toThrow(
      /不允许的协议/
    );
  });

  it("拒绝内网/云元数据 IP 字面量（不发起任何连接）", async () => {
    await expect(safeDownload("http://127.0.0.1/x")).rejects.toThrow(
      /内网|保留/
    );
    await expect(
      safeDownload("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/内网|保留/);
    await expect(safeDownload("https://192.168.1.10/a")).rejects.toThrow(
      /内网|保留/
    );
  });
});
