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
