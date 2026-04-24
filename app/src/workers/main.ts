/**
 * 独立 Worker 进程入口（Stage 2.2）
 *
 * 生产环境推荐：Web 进程只处理 HTTP 请求，Worker 进程专门消费 BullMQ。
 * 好处：
 * - Web 进程 fast start / restart（K8s rolling update 时不丢任务）
 * - Worker 独立伸缩（根据队列深度自动扩容）
 * - 崩溃隔离：Web OOM/Panic 不影响正在处理的长任务
 *
 * 用法：
 *   pnpm -C app worker:start    # 生产
 *   pnpm -C app worker:dev      # 带 tsx 热重载
 *
 * 部署：
 *   - systemd unit / PM2 ecosystem / Docker CMD
 *   - 必须设置 REDIS_URL、DATABASE_URL、ENCRYPTION_KEY 等 Web 进程需要的 env
 */

import { config as loadDotenv } from "dotenv";
import { createLogger } from "@/lib/logger";
import { initializeWorkers } from "@/services/queue-workers";
import { queueManager } from "@/services/queue";
import { flushLangfuse } from "@/lib/observability/langfuse";

// 加载 .env.local / .env
loadDotenv({ path: ".env.local" });
loadDotenv();

const log = createLogger("worker:main");

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) {
    log.error("REDIS_URL is required for worker process; exiting");
    process.exit(1);
  }

  log.info("Starting AI Comic Drama worker process", {
    node: process.version,
    pid: process.pid,
    redisUrl: maskRedisUrl(process.env.REDIS_URL),
  });

  initializeWorkers();
  log.info(
    "Worker process ready, consuming queues: image / video / audio / export"
  );

  // 优雅退出
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, closing queues...`);
    try {
      await queueManager.closeAll();
      await flushLangfuse();
      log.info("All queues closed; bye");
      process.exit(0);
    } catch (err) {
      log.error("Error during shutdown", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", { message: err.message, stack: err.stack });
    // 让进程管理器（systemd/pm2）拉起新实例
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

function maskRedisUrl(url: string): string {
  // rediss://user:pass@host:port → rediss://***@host:port
  return url.replace(/(:\/\/)[^@]+@/, "$1***@");
}

main().catch((err) => {
  log.error("Worker bootstrap failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
