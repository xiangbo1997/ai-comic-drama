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
