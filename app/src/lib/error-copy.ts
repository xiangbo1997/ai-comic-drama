/**
 * 错误文案映射层（UX 失败闭环）
 *
 * 背景：此前各页面把服务端 / 上游 provider 的原始 error 串直接抛给 toast，
 * 中文用户会看到 "Insufficient credits" / "rate limit exceeded" 之类
 * 无法行动的英文技术串，且没有「去充值 / 去配置」的出口。
 *
 * 本模块统一做两件事：
 * 1. formatApiError：服务端错误 JSON → 可读中文消息（保留积分差额等结构化信息），
 *    供 fetch 助手在 throw new Error(...) 时组装消息。
 * 2. toFriendlyError：Error/字符串 → 中文文案 + 建议动作 CTA，
 *    供 mutation onError 在 toast.error(message, cta) 时使用。
 */

export interface ErrorCta {
  label: string;
  href: string;
}

export interface FriendlyError {
  message: string;
  cta?: ErrorCta;
}

const RECHARGE_CTA: ErrorCta = { label: "去充值", href: "/credits" };
const CONFIGURE_CTA: ErrorCta = {
  label: "去配置模型",
  href: "/settings/ai-models",
};

const hasCJK = (s: string) => /[一-鿿]/.test(s);

/**
 * 服务端错误 JSON → 可读中文消息。
 * 识别积分不足的结构化差额字段（generate 类接口返回 { error, required, current }），
 * 此前前端只取 error 丢弃差额，用户不知道差多少。
 */
export function formatApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const { error, required, current } = payload as {
    error?: unknown;
    required?: unknown;
    current?: unknown;
  };
  if (typeof error !== "string" || !error) return fallback;
  if (/insufficient credits|积分不足/i.test(error)) {
    if (typeof required === "number" && typeof current === "number") {
      return `积分不足：本次需 ${required} 积分，当前剩余 ${current} 积分`;
    }
    return "积分不足，请充值后重试";
  }
  return error;
}

interface ErrorPattern {
  re: RegExp;
  message: string;
  cta?: ErrorCta;
  /** 原始消息已是中文时保留原文（通常信息量更大，如带差额的积分提示） */
  keepCjk?: boolean;
}

const PATTERNS: ErrorPattern[] = [
  {
    re: /insufficient credits|积分不足/i,
    message: "积分不足，请充值后重试",
    cta: RECHARGE_CTA,
    keepCjk: true,
  },
  {
    re: /请先.*配置|未配置|not configured/i,
    message: "尚未配置对应的 AI 模型，请先在设置中完成配置",
    cta: CONFIGURE_CTA,
    keepCjk: true,
  },
  {
    re: /invalid.{0,10}(api.?key|token)|api.?key.{0,10}(invalid|expired|incorrect|missing)|authentication.{0,10}(fail|error)/i,
    message: "API Key 无效或已失效，请检查模型配置",
    cta: CONFIGURE_CTA,
  },
  {
    re: /^unauthorized$/i,
    message: "登录已过期，请刷新页面重新登录",
  },
  {
    re: /rate.?limit|too many requests|quota.{0,20}(exceeded|exhausted)|insufficient_quota/i,
    message: "请求过于频繁或服务额度受限，请稍后重试",
  },
  {
    re: /timeout|timed.?out|超时/i,
    message: "请求超时，请稍后重试",
    keepCjk: true,
  },
  {
    re: /content.{0,10}(policy|safety|moderation)|flagged|敏感内容|安全审核|内容审核/i,
    message: "内容未通过安全审核，请调整文案后重试",
    keepCjk: true,
  },
  {
    re: /already checked in/i,
    message: "今天已经签到过了",
  },
];

/**
 * Error / 字符串 → 中文文案 + 建议动作。
 * 未命中任何模式时：中文原文直接展示，英文技术串收敛为调用方的 fallback，
 * 不再把上游原始英文错误泄露给用户。
 */
export function toFriendlyError(
  error: unknown,
  fallback: string
): FriendlyError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  for (const p of PATTERNS) {
    if (p.re.test(raw)) {
      return {
        message: p.keepCjk && hasCJK(raw) ? raw : p.message,
        cta: p.cta,
      };
    }
  }
  if (hasCJK(raw)) return { message: raw };
  return { message: fallback };
}
