/**
 * Next.js 启动钩子（boot-time 校验，2026-07-04）
 *
 * 此前配置错误延迟到首个请求才炸：ENCRYPTION_KEY 少一位 → 服务正常起、
 * 首页正常开，用户第一次触发生成才 500，线上不知道是配置问题；R2/Redis
 * 未配是静默降级，无任何日志提示（a8 审计 P1-4）。
 *
 * 这里在 boot 时集中校验必填 env（缺失/格式错即 fail-fast），并对降级项
 * 打一行显式 warn，让"正在用 X 降级模式"在启动日志里可见。
 *
 * register() 仅在 nodejs runtime 执行一次（Next 稳定特性，无需 experimental）。
 */

export async function register() {
  // 仅在 Node.js runtime 跑（edge runtime 无这些 env 语义）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createLogger } = await import("@/lib/logger");
  const log = createLogger("instrumentation");

  const errors: string[] = [];

  // 必填：缺失或格式错直接 fail-fast
  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL 未设置");
  }
  if (!process.env.NEXTAUTH_SECRET) {
    errors.push("NEXTAUTH_SECRET 未设置");
  }
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) {
    errors.push("ENCRYPTION_KEY 未设置");
  } else if (encKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(encKey)) {
    errors.push("ENCRYPTION_KEY 必须是 64 位十六进制字符（32 字节）");
  }

  if (errors.length > 0) {
    // 生产直接抛，拒绝带病启动；开发仅 error 日志便于本地快速定位
    const msg = `启动配置校验失败:\n  - ${errors.join("\n  - ")}`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    log.error(msg);
  }

  // 降级项显式告警（不阻断启动，但让线上"在用降级模式"可见）
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !process.env.REDIS_URL) {
    // 限流走内存=每进程独立、重启清零；若启用平台兜底 key 则是烧钱风险
    log.warn(
      "未配置 REDIS_URL：限流走内存（每进程独立、重启清零）。多实例或启用平台兜底 key 时强烈建议配置 Redis。"
    );
  }
  const hasR2 =
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY;
  if (!hasR2) {
    log.warn(
      "未配置 R2（对象存储）：生成产物落本地盘 public/uploads（重启/多节点即丢，仅适合单机开发）。"
    );
  }
  if (!process.env.LANGFUSE_SECRET_KEY) {
    log.warn("未配置 Langfuse：AI 调用可观测性为 no-op（不影响功能）。");
  }

  log.info(
    `启动配置校验通过（env=${process.env.NODE_ENV}，并发上限=${process.env.GENERATION_MAX_CONCURRENCY ?? 8}）`
  );
}
