/**
 * Node.js runtime 专属的启动校验（由 instrumentation.ts 按 NEXT_RUNTIME 动态导入）
 *
 * 为什么单独成文件：instrumentation.ts 会被 Turbopack 同时编译进 edge 包，
 * 文件里只要静态出现 process.exit 就报「Node.js API 不支持 Edge Runtime」警告。
 * 按 Next 官方模式把 Node 专属逻辑放到独立模块、在 runtime 判断后再动态 import，
 * edge 侧会把这条 import 当死代码裁掉。
 */

import { createLogger } from "@/lib/logger";
import { validateEnv } from "@/lib/env";

export async function registerNode(): Promise<void> {
  const log = createLogger("instrumentation");

  // 必填 env 规则收口在 lib/env.ts（zod schema，单一真源）
  const { success, errors } = validateEnv();

  if (!success) {
    // 逐条打印，运维一眼看全所有缺失项（而非改一个重启一次发现下一个）
    for (const e of errors) {
      log.error(`启动配置校验失败 — ${e}`);
    }
    // 生产直接退出，拒绝带病启动（systemd Restart=on-failure 会重试，
    // 日志里留着上面的原因）；开发仅记日志便于本地继续调试
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
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
