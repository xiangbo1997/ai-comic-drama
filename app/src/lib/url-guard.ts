/**
 * SSRF 防护：在服务端 fetch 远程 URL 前校验目标地址。
 *
 * 背景：多处服务端代码会 fetch 用户可影响的 URL（scene.*Url、AI 测试端点的
 * customBaseUrl、storage.uploadFromUrl 的源 URL 等）。若不校验，攻击者可诱导
 * 服务端访问云元数据（169.254.169.254）或内网，泄露 IAM 凭证 / 探测内网。
 *
 * 本模块从 services/video-synthesis.ts 提取为公共能力，统一所有出站 fetch 的
 * 前置校验。分层：属于 lib，仅依赖 Node 内置 dns/net，不反向依赖 services。
 *
 * 策略：
 * 1. 仅允许 http: / https: 协议（挡住 file:// / gopher:// 等）
 * 2. hostname 是 IP 时直接判内网/保留段
 * 3. hostname 是域名时解析全部 A/AAAA 记录，任一落内网即拒绝（防 DNS rebinding）
 */

import { lookup } from "dns/promises";
import net from "net";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import type { LookupAddress } from "dns";

/** 判断 IP 是否落在内网 / 保留段 / 云元数据地址。 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 环回
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 链路本地 + 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // 环回 / 未指定
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // 链路本地
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped，回退按 IPv4 判断
      return isPrivateOrReservedIp(lower.replace("::ffff:", ""));
    }
    return false;
  }
  return true; // 非法 IP 按不安全处理
}

/**
 * 同步字面量校验：协议白名单 + hostname 若是 IP 字面量则拦内网/保留段。
 *
 * 用途：写入用户可控 URL（如 UserAIConfig.customBaseUrl）之前的第一道闸。
 * 不做 DNS 解析（同步、无网络往返），因此无法挡"域名解析到内网"——那一步
 * 留给运行时的 assertSafeUrl。二者配合：保存时挡明显的内网字面量与非法协议，
 * 运行时再挡 DNS rebinding / 域名指向内网。
 *
 * 不安全时抛 Error，安全时返回。
 */
export function assertSafeUrlLiteral(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`非法 URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`不允许的协议: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new Error(`拒绝访问内网/保留地址: ${host}`);
  }
}

/**
 * 校验远程 URL 安全：协议白名单 + DNS 解析后内网拦截。
 * 不安全时抛 Error；调用方应在 fetch 之前 await 本函数。
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`非法 URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`不允许的协议: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  // hostname 本身就是 IP 时直接判
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`拒绝访问内网/保留地址: ${host}`);
    }
    return;
  }
  // 域名：解析全部 A/AAAA 记录，任一落内网即拒绝（防 DNS rebinding）
  const results = await lookup(host, { all: true });
  for (const { address } of results) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`域名 ${host} 解析到内网/保留地址: ${address}`);
    }
  }
}

/** 解析并校验 hostname 的全部地址；返回可用于钉连接的已校验地址列表 */
async function resolveValidated(host: string): Promise<LookupAddress[]> {
  const ipVersion = net.isIP(host);
  if (ipVersion) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`拒绝访问内网/保留地址: ${host}`);
    }
    return [{ address: host, family: ipVersion }];
  }
  const results = await lookup(host, { all: true });
  if (results.length === 0) {
    throw new Error(`域名无法解析: ${host}`);
  }
  for (const { address } of results) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`域名 ${host} 解析到内网/保留地址: ${address}`);
    }
  }
  return results;
}

const SAFE_DOWNLOAD_MAX_REDIRECTS = 5;
const SAFE_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024; // 200MB（视频素材上限）
const SAFE_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface SafeDownloadResult {
  status: number;
  contentType?: string;
  buffer: Buffer;
}

/**
 * 钉 IP 安全下载（防 SSRF TOCTOU 与重定向绕过）。
 *
 * assertSafeUrl + fetch 的组合存在两个残余缺口：
 * 1. TOCTOU：校验时解析一次 DNS、fetch 时又解析一次——攻击者可让域名在
 *    两次解析之间翻转到内网地址（DNS rebinding 竞态）。
 * 2. 重定向绕过：fetch 默认自动跟随 302，跳转目标不再经过任何校验，
 *    外部服务器可 302 到 http://169.254.169.254。
 *
 * 本函数用 node:http(s) 自定义 `lookup`：连接期直接返回「校验通过的那次
 * 解析结果」，检查与连接使用同一地址（消除窗口）；TLS 的 SNI/证书校验仍
 * 按原 hostname 进行。重定向手动跟随，每一跳重新校验 + 重新钉 IP。
 *
 * 注：AI provider 调用链（SDK 内部 fetch）暂无法钉 IP，仍依赖
 * assertSafeUrl 的解析时校验，属已知残余面（见 CLAUDE.md 记录）。
 */
export async function safeDownload(
  rawUrl: string,
  opts?: { maxBytes?: number; timeoutMs?: number }
): Promise<SafeDownloadResult> {
  const maxBytes = opts?.maxBytes ?? SAFE_DOWNLOAD_MAX_BYTES;
  const timeoutMs = opts?.timeoutMs ?? SAFE_DOWNLOAD_TIMEOUT_MS;

  let current = rawUrl;
  for (let hop = 0; hop <= SAFE_DOWNLOAD_MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error(`非法 URL: ${current}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`不允许的协议: ${parsed.protocol}`);
    }
    const pinnedAll = await resolveValidated(parsed.hostname);
    const pinned = pinnedAll[0];

    // Node 的 LookupFunction 回调签名随 options.all 变化（(err, addr, family)
    // 或 (err, addresses[])），类型上是重载联合，此处用受控断言适配两种形态
    const pinnedLookup = ((_hostname, options, callback) => {
      if (typeof options === "object" && options.all) {
        (
          callback as unknown as (
            err: NodeJS.ErrnoException | null,
            addresses: LookupAddress[]
          ) => void
        )(null, [pinned]);
      } else {
        (
          callback as unknown as (
            err: NodeJS.ErrnoException | null,
            address: string,
            family: number
          ) => void
        )(null, pinned.address, pinned.family);
      }
    }) as net.LookupFunction;

    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const requester =
        parsed.protocol === "https:" ? httpsRequest : httpRequest;
      const req = requester(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: "GET",
          lookup: pinnedLookup,
          timeout: timeoutMs,
        },
        resolve
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error(`下载超时: ${current}`)));
      req.end();
    });

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume(); // 丢弃当前 body，跟随重定向（下一轮重新校验+钉 IP）
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new Error(`下载失败 (HTTP ${status}): ${current}`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          reject(new Error(`文件超过大小上限 ${maxBytes} 字节: ${current}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", resolve);
      res.on("error", reject);
    });

    return {
      status,
      contentType: res.headers["content-type"],
      buffer: Buffer.concat(chunks),
    };
  }
  throw new Error(`重定向次数超限: ${rawUrl}`);
}
