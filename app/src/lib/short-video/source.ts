import { assertSafeUrlLiteral } from "@/lib/url-guard";
import { stableHash } from "./hash";
import { invariant, SvError } from "./errors";
const domains: Record<string, string[]> = {
  DOUYIN: ["douyin.com", "iesdouyin.com"],
  KUAISHOU: ["kuaishou.com", "gifshow.com"],
  XIAOHONGSHU: ["xiaohongshu.com", "xhslink.com"],
};
export function platformPostUrl(platform: string, raw: string) {
  try {
    assertSafeUrlLiteral(raw);
  } catch {
    throw new SvError(422, "INVALID_URL", "来源链接不安全或格式无效");
  }
  const url = new URL(raw);
  invariant(
    url.protocol === "https:" && !url.username && !url.password && !url.port,
    422,
    "INVALID_URL",
    "仅接受安全的 HTTPS 平台链接"
  );
  invariant(
    (domains[platform] ?? []).some(
      (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
    ),
    422,
    "INVALID_PLATFORM_URL",
    "链接不属于目标平台"
  );
  return url;
}
export function canonicalSource(
  platform: string,
  raw: string | undefined,
  summary: string
) {
  if (!raw)
    return {
      originalUrl: null,
      canonicalUrl: null,
      canonicalKey: `text:${stableHash(summary)}`,
    };
  let url: URL;
  if (platform !== "OTHER") url = platformPostUrl(platform, raw);
  else {
    try {
      assertSafeUrlLiteral(raw);
    } catch {
      throw new SvError(422, "INVALID_URL", "来源链接不安全或格式无效");
    }
    url = new URL(raw);
    invariant(
      url.protocol === "https:" && !url.username && !url.password && !url.port,
      422,
      "INVALID_URL",
      "仅接受安全 HTTPS 链接"
    );
  }
  // 不访问导入地址，不解析短链；只删除已知追踪字段，保留作品身份与签名参数。
  url.hash = "";
  for (const key of [
    "access_token",
    "token",
    "authorization",
    "signature",
    "xsec_token",
    "xsec_source",
  ])
    url.searchParams.delete(key);
  const tracking = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];
  for (const key of tracking) url.searchParams.delete(key);
  url.searchParams.sort();
  return {
    originalUrl: url.toString(),
    canonicalUrl: url.toString(),
    canonicalKey: `url:${stableHash(url.toString())}`,
  };
}
