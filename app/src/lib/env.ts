/**
 * 必填环境变量校验（boot-time，2026-09-08）
 *
 * 此前 instrumentation.ts 里手写 if 链做同样的事，规则散落且没有统一的
 * 错误消息格式。这里用 zod 收成单一 schema：新增必填项只改这一处，
 * 校验规则（格式、长度）与人类可读的报错绑定在一起。
 *
 * 只覆盖「缺了服务必然带病运行」的三项。可选能力（R2 / Redis / Langfuse /
 * 各 AI provider key）保持不校验——它们缺失是显式降级，由
 * instrumentation.ts 打 warn 提示，不该拦启动。
 *
 * 本模块不做进程控制（不 exit、不 throw 到顶层），只返回结构化结果，
 * 由调用方（instrumentation.register）决定生产 fail-fast、开发仅告警。
 */

import { readFileSync } from "fs";
import path from "path";

import { z } from "zod";

/** 必填 env 的 schema；报错文案直接面向运维，说清「要填成什么样」 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 未设置")
    .refine(
      (v) => /^postgres(ql)?:\/\//.test(v),
      "DATABASE_URL 必须是 postgresql:// 连接串"
    ),
  NEXTAUTH_SECRET: z
    .string()
    .min(1, "NEXTAUTH_SECRET 未设置")
    .min(16, "NEXTAUTH_SECRET 至少 16 个字符（建议 openssl rand -base64 32）"),
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY 未设置")
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "ENCRYPTION_KEY 必须是 64 位十六进制字符（32 字节，openssl rand -hex 32）"
    ),
});

export type RequiredEnv = z.infer<typeof envSchema>;

export interface EnvValidationResult {
  success: boolean;
  /** 每条一个变量的可读错误，形如 "ENCRYPTION_KEY: 必须是 64 位十六进制字符…" */
  errors: string[];
}

/**
 * 校验必填 env。不抛异常，把问题逐条返回给调用方。
 *
 * @param source 待校验的环境变量来源，默认 process.env。类型取宽松的
 *   字符串字典（而非 NodeJS.ProcessEnv）——后者在本项目的 TS 配置下要求
 *   NODE_ENV 必填，会让测试里构造子集变得别扭，而这里只读三个 key。
 */
export function validateEnv(
  source: Record<string, string | undefined> = process.env
): EnvValidationResult {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) {
    return { success: true, errors: [] };
  }

  // 同一变量可能命中多条规则（未设置 + 格式错），按变量取第一条即可，
  // 避免运维看到重复噪音
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "env");
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(`${key}: ${issue.message}`);
  }

  return { success: false, errors };
}

// ============ 可选能力分组（typed accessor，2026-09-08）============
//
// 背景：可选能力的 env 此前散在各文件里裸读 `process.env.X || ""`，同一变量
// 的默认值/类型转换在多处各写一遍，改名或加默认值必须全仓 grep。这里按「能力
// 组」收成 zod schema，各文件改读 getXxxEnv()，变量清单与默认值只此一处。
//
// 三条硬约束（改动本节前先读）：
// 1. **不改变运行时行为**：可选组解析失败只 warn + 回落到「未配置」，绝不 throw
//    ——这些能力缺失本就是显式降级路径（R2 → 本地盘、Redis → 内存限流）。
// 2. **保留空串语义**：现有代码大量用 `process.env.X || ""`，空串与未设置等价
//    （`isConfigured()` 靠真值判断）。故这里统一把空串归一为 undefined，
//    调用方再 `?? ""`，结果与原来逐字相同。
// 3. **懒解析 + 记忆化**：模块顶层不读 env（测试可在 import 后改 process.env），
//    首次调用时解析并缓存；测试用 resetEnvCache() 清缓存。

/** 空串按「未设置」处理：与原先 `process.env.X || ""` 的真值语义一致 */
const optionalStr = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional()
);

/** 可选正整数（用于并发/连接池上限等）：非法值交由调用方回落到默认 */
const optionalPositiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().int().positive().optional()
);

/** 支付：微信 v3 / 支付宝 / Stripe */
const paymentSchema = z.object({
  WECHAT_APP_ID: optionalStr,
  WECHAT_MCH_ID: optionalStr,
  WECHAT_API_KEY: optionalStr,
  WECHAT_NOTIFY_URL: optionalStr,
  WECHAT_PRIVATE_KEY: optionalStr,
  WECHAT_CERT_SERIAL: optionalStr,
  WECHAT_PLATFORM_PUBLIC_KEY: optionalStr,
  ALIPAY_APP_ID: optionalStr,
  ALIPAY_PRIVATE_KEY: optionalStr,
  ALIPAY_PUBLIC_KEY: optionalStr,
  ALIPAY_NOTIFY_URL: optionalStr,
  STRIPE_SECRET_KEY: optionalStr,
  STRIPE_WEBHOOK_SECRET: optionalStr,
});

/** 存储：R2 对象存储 + 本地盘降级 */
const storageSchema = z.object({
  R2_ENDPOINT: optionalStr,
  R2_ACCESS_KEY_ID: optionalStr,
  R2_SECRET_ACCESS_KEY: optionalStr,
  R2_BUCKET_NAME: optionalStr,
  R2_PUBLIC_URL: optionalStr,
  USE_LOCAL_STORAGE: optionalStr,
  LOCAL_STORAGE_DIR: optionalStr,
  LOCAL_STORAGE_URL_PREFIX: optionalStr,
});

/** Redis：限流 / 缓存 / PubSub 的共享连接串 */
const redisSchema = z.object({
  REDIS_URL: optionalStr,
});

/** 各类上限：生成并发闸 + PG 连接池 */
const limitsSchema = z.object({
  GENERATION_MAX_CONCURRENCY: optionalPositiveInt,
  PG_POOL_MAX: optionalPositiveInt,
});

/** 内容安全：阿里云 / 腾讯云审核 */
const contentSafetySchema = z.object({
  ALIYUN_ACCESS_KEY_ID: optionalStr,
  ALIYUN_ACCESS_KEY_SECRET: optionalStr,
  ALIYUN_CONTENT_SAFETY_ENDPOINT: optionalStr,
  TENCENT_SECRET_ID: optionalStr,
  TENCENT_SECRET_KEY: optionalStr,
});

/** 运维：管理员白名单 + 定时任务密钥 */
const adminSchema = z.object({
  ADMIN_EMAILS: optionalStr,
  CRON_SECRET: optionalStr,
});

/** 可观测性：Langfuse */
const observabilitySchema = z.object({
  LANGFUSE_PUBLIC_KEY: optionalStr,
  LANGFUSE_SECRET_KEY: optionalStr,
  LANGFUSE_BASE_URL: optionalStr,
  LANGFUSE_FLUSH_AT: optionalPositiveInt,
});

/**
 * 运行时元信息：环境标识 + 部署版本。
 *
 * 不含 LOG_LEVEL：lib/logger.ts 每次打日志都重读一次 process.env.LOG_LEVEL，
 * 收进这里就会被记忆化（运行中改 LOG_LEVEL 不再生效），且 logger 是所有模块
 * 的依赖底座，让它反向 import env 会造成难以推理的依赖环。保持原样。
 */
const runtimeSchema = z.object({
  NODE_ENV: optionalStr,
  GIT_COMMIT: optionalStr,
});

/** 各能力组的默认值：解析失败或变量缺失时的「未配置」形态 */
const GROUP_DEFAULTS = {
  payment: {} as z.infer<typeof paymentSchema>,
  storage: {} as z.infer<typeof storageSchema>,
  redis: {} as z.infer<typeof redisSchema>,
  limits: {} as z.infer<typeof limitsSchema>,
  contentSafety: {} as z.infer<typeof contentSafetySchema>,
  admin: {} as z.infer<typeof adminSchema>,
  observability: {} as z.infer<typeof observabilitySchema>,
} as const;

/** 生成任务进程级并发上限的兜底值（见 lib/generation-concurrency.ts） */
export const DEFAULT_GENERATION_MAX_CONCURRENCY = 8;
/** PostgreSQL 连接池上限兜底值（见 lib/prisma.ts） */
export const DEFAULT_PG_POOL_MAX = 20;
/** Langfuse 批量刷新阈值兜底值 */
export const DEFAULT_LANGFUSE_FLUSH_AT = 1;
/** 本地存储降级的默认目录与 URL 前缀（见 services/storage.ts） */
export const DEFAULT_LOCAL_STORAGE_DIR = "public/uploads";
export const DEFAULT_LOCAL_STORAGE_URL_PREFIX = "/uploads";
/** R2 默认桶名（见 services/storage.ts） */
export const DEFAULT_R2_BUCKET_NAME = "ai-comic-drama";
/** 阿里云内容安全默认接入点 */
export const DEFAULT_ALIYUN_CONTENT_SAFETY_ENDPOINT =
  "green.cn-shanghai.aliyuncs.com";

const cache = new Map<string, unknown>();

/**
 * 懒解析 + 记忆化一个能力组。
 *
 * 这里刻意不用 lib/logger（env 是最底层模块，logger 反过来要读 LOG_LEVEL，
 * 互相 import 会让依赖环变得难以推理），直接 console.warn。可选组解析失败
 * 只告警并回落到 fallback，保持「配错 = 静默降级」而非「配错 = 起不来」。
 */
function parseGroup<T>(
  name: string,
  schema: z.ZodType<T>,
  fallback: T,
  source: Record<string, string | undefined>
): T {
  const cached = cache.get(name);
  if (cached !== undefined) return cached as T;

  const parsed = schema.safeParse(source);
  let value: T;
  if (parsed.success) {
    value = parsed.data;
  } else {
    const detail = parsed.error.issues
      .map((i) => `${String(i.path[0] ?? "?")}: ${i.message}`)
      .join("; ");
    console.warn(
      `[env] 可选配置组 ${name} 解析失败，按「未配置」降级处理 — ${detail}`
    );
    value = fallback;
  }
  cache.set(name, value);
  return value;
}

/** 清空分组缓存（仅测试用；生产环境 env 在进程生命周期内不变） */
export function resetEnvCache(): void {
  cache.clear();
  gitCommitResolved = false;
  gitCommitFromFile = undefined;
}

export type PaymentEnv = z.infer<typeof paymentSchema>;
export type StorageEnv = z.infer<typeof storageSchema>;
export type RedisEnv = z.infer<typeof redisSchema>;
export type LimitsEnv = z.infer<typeof limitsSchema>;
export type ContentSafetyEnv = z.infer<typeof contentSafetySchema>;
export type AdminEnv = z.infer<typeof adminSchema>;
export type ObservabilityEnv = z.infer<typeof observabilitySchema>;

/** 支付相关 env（微信/支付宝/Stripe）；未配置的键为 undefined */
export function getPaymentEnv(
  source: Record<string, string | undefined> = process.env
): PaymentEnv {
  return parseGroup("payment", paymentSchema, GROUP_DEFAULTS.payment, source);
}

/** 存储相关 env（R2 + 本地盘降级） */
export function getStorageEnv(
  source: Record<string, string | undefined> = process.env
): StorageEnv {
  return parseGroup("storage", storageSchema, GROUP_DEFAULTS.storage, source);
}

/** Redis 连接串；未配置时 REDIS_URL 为 undefined（调用方降级到内存实现） */
export function getRedisEnv(
  source: Record<string, string | undefined> = process.env
): RedisEnv {
  return parseGroup("redis", redisSchema, GROUP_DEFAULTS.redis, source);
}

/** 并发/连接池上限；未配置或非法时返回 undefined，由调用方套默认常量 */
export function getLimitsEnv(
  source: Record<string, string | undefined> = process.env
): LimitsEnv {
  return parseGroup("limits", limitsSchema, GROUP_DEFAULTS.limits, source);
}

/** 内容安全审核 env（阿里云/腾讯云） */
export function getContentSafetyEnv(
  source: Record<string, string | undefined> = process.env
): ContentSafetyEnv {
  return parseGroup(
    "contentSafety",
    contentSafetySchema,
    GROUP_DEFAULTS.contentSafety,
    source
  );
}

/** 管理员白名单与 cron 密钥 */
export function getAdminEnv(
  source: Record<string, string | undefined> = process.env
): AdminEnv {
  return parseGroup("admin", adminSchema, GROUP_DEFAULTS.admin, source);
}

/** Langfuse 可观测性 env */
export function getObservabilityEnv(
  source: Record<string, string | undefined> = process.env
): ObservabilityEnv {
  return parseGroup(
    "observability",
    observabilitySchema,
    GROUP_DEFAULTS.observability,
    source
  );
}

// ---- 运行时元信息（含部署 commit 的文件兜底）----

/**
 * 部署 commit 的文件兜底路径。
 *
 * 服务器上没有 git（代码靠 rsync 同步），拿不到 `git rev-parse`；systemd unit
 * 里也没有注入 GIT_COMMIT，于是 /api/health 的 commit 恒为 null，无法确认
 * 「重启后跑的到底是不是新代码」。deploy.sh 在 rsync 前把本地短 SHA 写进
 * app/.git-commit 一并推送，这里在 env 缺失时读它。
 */
const GIT_COMMIT_FILE = "app/.git-commit";

let gitCommitResolved = false;
let gitCommitFromFile: string | undefined;

/**
 * 从 app/.git-commit 读部署版本；文件不存在（本地开发 / 未走 deploy.sh）即
 * 返回 undefined。只读一次并缓存：这是启动期的一次性同步读，不会进热路径。
 *
 * cwd 兼容：进程既可能在仓库根启动，也可能在 app/ 下启动（systemd unit 用
 * WorkingDirectory=…/app），两个候选路径都试。
 */
function readGitCommitFile(): string | undefined {
  if (gitCommitResolved) return gitCommitFromFile;
  gitCommitResolved = true;

  const candidates = [
    path.join(process.cwd(), GIT_COMMIT_FILE),
    path.join(process.cwd(), ".git-commit"),
  ];
  for (const file of candidates) {
    try {
      const raw = readFileSync(file, "utf8").trim();
      if (raw) {
        gitCommitFromFile = raw;
        return gitCommitFromFile;
      }
    } catch {
      // 文件不存在/不可读都属正常（本地开发），继续试下一个候选
    }
  }
  return undefined;
}

export interface RuntimeEnv {
  /** NODE_ENV 原值（未设置时为 undefined） */
  nodeEnv: string | undefined;
  /** 是否生产环境 */
  isProduction: boolean;
  /** 部署的 commit：GIT_COMMIT 优先，其次 app/.git-commit 文件，都没有则 null */
  commit: string | null;
}

/**
 * 运行时元信息。注意 NODE_ENV 在客户端包里由 Next 做静态替换，本函数只供
 * 服务端使用（lib/services/route 均在 Node runtime 执行）。
 */
export function getRuntimeEnv(
  source: Record<string, string | undefined> = process.env
): RuntimeEnv {
  const cached = cache.get("runtime");
  if (cached !== undefined) return cached as RuntimeEnv;

  const parsed = runtimeSchema.safeParse(source);
  const data: z.infer<typeof runtimeSchema> = parsed.success ? parsed.data : {};
  if (!parsed.success) {
    console.warn(
      `[env] 可选配置组 runtime 解析失败，按「未配置」降级处理 — ${parsed.error.issues
        .map((i) => `${String(i.path[0] ?? "?")}: ${i.message}`)
        .join("; ")}`
    );
  }

  const value: RuntimeEnv = {
    nodeEnv: data.NODE_ENV,
    isProduction: data.NODE_ENV === "production",
    commit: data.GIT_COMMIT ?? readGitCommitFile() ?? null,
  };
  cache.set("runtime", value);
  return value;
}
