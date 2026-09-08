/**
 * safeDownload 的重定向 / 大小上限 / DNS 钉 IP 行为单测。
 *
 * 测试环境约束：safeDownload 无条件拒绝环回与内网地址，而本机只能起
 * 127.0.0.1 的服务器（macOS 上 127.0.0.2 需手工 ifconfig alias，不在测试里改系统）。
 * 因此本文件分两层覆盖：
 *
 *  1. 「校验层」用真实代码 + mock `dns/promises`：验证域名解析到内网/元数据即拒、
 *     解析到公网放行、重定向逐跳重新校验。这层跑的是 assertSafeUrl / resolveValidated
 *     的真实分支。
 *  2. 「传输层」用真实本地 http 服务器 + mock `http.request`：把请求转发到本地服务器，
 *     从而让 safeDownload 的重定向循环、最大跳数、maxBytes 截断这些逻辑真实执行，
 *     同时绕开「不能绑定公网 IP」的环境限制。
 *
 * 本文件不修改也不放宽 url-guard 的任何判据；被替换的只有 DNS 解析与 socket 目标，
 * 恰好等价于「攻击者控制 DNS 应答 / 上游服务器乱跳」的场景。
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// ── DNS mock：可按 hostname 改写解析结果 ──
const dnsTable = new Map<string, string>();

vi.mock("dns/promises", () => ({
  lookup: async (hostname: string, _opts?: unknown) => {
    const addr = dnsTable.get(hostname);
    if (!addr) {
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
    }
    return [{ address: addr, family: 4 }];
  },
}));

// ── http.request mock：保留真实实现，只把连接目标改写到本地测试服务器 ──
// safeDownload 传入的 hostname 是假公网域名、lookup 是它自己的 pinnedLookup；
// 我们丢弃这两者，改用 127.0.0.1:port，其余选项（path/method/timeout）原样透传。
// 这样 safeDownload 的响应处理（302 跟随 / 状态码判定 / maxBytes）全部真实执行。
vi.mock("http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("http")>();
  return {
    ...actual,
    default: actual,
    request: (
      options: http.RequestOptions,
      cb?: (res: http.IncomingMessage) => void
    ) =>
      actual.request(
        {
          ...options,
          hostname: "127.0.0.1",
          port: testServerPort,
          lookup: undefined,
        },
        cb
      ),
  };
});

import { safeDownload, assertSafeUrl } from "@/lib/url-guard";

let server: http.Server;
let testServerPort = 0;

/** 假公网域名：DNS mock 让它解析到一个公网长相的地址，通过 url-guard 的校验 */
const PUBLIC_HOST = "test-public.invalid";
const PUBLIC_IP = "93.184.216.34";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/ok")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello");
      return;
    }
    if (url.startsWith("/redirect-to-metadata")) {
      res.writeHead(302, {
        location: "http://169.254.169.254/latest/meta-data/",
      });
      res.end();
      return;
    }
    if (url.startsWith("/redirect-to-loopback")) {
      res.writeHead(302, { location: "http://127.0.0.1:9/ok" });
      res.end();
      return;
    }
    if (url.startsWith("/redirect-to-file")) {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
      return;
    }
    if (url.startsWith("/redirect-once")) {
      res.writeHead(302, { location: `http://${PUBLIC_HOST}/ok` });
      res.end();
      return;
    }
    if (url.startsWith("/loop")) {
      // 无限自跳，用于验证最大跳数上限
      res.writeHead(302, { location: `http://${PUBLIC_HOST}/loop` });
      res.end();
      return;
    }
    if (url.startsWith("/big")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      // 分多块写，保证 maxBytes 判定在 data 事件里触发
      for (let i = 0; i < 8; i += 1) res.write(Buffer.alloc(1024, 0x41));
      res.end();
      return;
    }
    if (url.startsWith("/notfound")) {
      res.writeHead(404);
      res.end("nope");
      return;
    }
    res.writeHead(500);
    res.end();
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  testServerPort = (server.address() as AddressInfo).port;

  dnsTable.set(PUBLIC_HOST, PUBLIC_IP);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("assertSafeUrl 的 DNS 解析路径（防 DNS rebinding）", () => {
  it("域名解析到环回地址即拒绝", async () => {
    dnsTable.set("evil.example", "127.0.0.1");
    await expect(assertSafeUrl("https://evil.example/x")).rejects.toThrow(
      /解析到内网|保留/
    );
  });

  it("域名解析到云元数据地址即拒绝", async () => {
    dnsTable.set("meta.example", "169.254.169.254");
    await expect(assertSafeUrl("https://meta.example/")).rejects.toThrow(
      /解析到内网|保留/
    );
  });

  it("域名解析到公网地址则放行", async () => {
    await expect(
      assertSafeUrl(`https://${PUBLIC_HOST}/`)
    ).resolves.toBeUndefined();
  });

  it("域名解析失败时错误上抛", async () => {
    await expect(assertSafeUrl("https://missing.example/")).rejects.toThrow(
      /ENOTFOUND/
    );
  });
});

describe("safeDownload — 正常下载", () => {
  it("200 返回状态码 / content-type / body", async () => {
    const result = await safeDownload(`http://${PUBLIC_HOST}/ok`);
    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/text\/plain/);
    expect(result.buffer.toString()).toBe("hello");
  });

  it("跟随一次 302 后拿到最终 body", async () => {
    const result = await safeDownload(`http://${PUBLIC_HOST}/redirect-once`);
    expect(result.status).toBe(200);
    expect(result.buffer.toString()).toBe("hello");
  });

  it("非 2xx 状态码抛错", async () => {
    await expect(
      safeDownload(`http://${PUBLIC_HOST}/notfound`)
    ).rejects.toThrow(/下载失败 \(HTTP 404\)/);
  });
});

describe("safeDownload — 重定向逐跳重新校验", () => {
  it("302 跳到云元数据地址被拒", async () => {
    await expect(
      safeDownload(`http://${PUBLIC_HOST}/redirect-to-metadata`)
    ).rejects.toThrow(/内网|保留/);
  });

  it("302 跳到环回地址被拒", async () => {
    await expect(
      safeDownload(`http://${PUBLIC_HOST}/redirect-to-loopback`)
    ).rejects.toThrow(/内网|保留/);
  });

  it("302 跳到非 http(s) 协议被拒", async () => {
    await expect(
      safeDownload(`http://${PUBLIC_HOST}/redirect-to-file`)
    ).rejects.toThrow(/不允许的协议/);
  });

  it("首跳 hostname 是环回 IP 字面量时直接拒（不发起连接）", async () => {
    await expect(safeDownload("http://127.0.0.1/ok")).rejects.toThrow(
      /内网|保留/
    );
  });

  it("无限重定向在超过最大跳数后抛错", async () => {
    await expect(safeDownload(`http://${PUBLIC_HOST}/loop`)).rejects.toThrow(
      /重定向次数超限/
    );
  });
});

describe("safeDownload — 大小上限", () => {
  it("body 超过 maxBytes 时中断并抛错", async () => {
    // /big 共写 8KB，限 2KB 必然触发
    await expect(
      safeDownload(`http://${PUBLIC_HOST}/big`, { maxBytes: 2048 })
    ).rejects.toThrow(/超过大小上限 2048 字节/);
  });

  it("body 未超过 maxBytes 时正常返回完整内容", async () => {
    const result = await safeDownload(`http://${PUBLIC_HOST}/big`, {
      maxBytes: 1024 * 1024,
    });
    expect(result.buffer.length).toBe(8 * 1024);
  });
});

describe("safeDownload — 参数与错误路径", () => {
  it("非法 URL 立即失败", async () => {
    await expect(safeDownload("not a url")).rejects.toThrow(/非法 URL/);
  });

  it("非 http(s) 协议立即失败", async () => {
    await expect(safeDownload("file:///etc/passwd")).rejects.toThrow(
      /不允许的协议/
    );
    await expect(safeDownload("gopher://example.com/")).rejects.toThrow(
      /不允许的协议/
    );
  });

  it("解析不到的域名错误上抛（不静默返回空 buffer）", async () => {
    await expect(safeDownload("https://missing.example/x")).rejects.toThrow(
      /ENOTFOUND|无法解析/
    );
  });
});
