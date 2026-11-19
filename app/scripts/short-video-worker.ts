import { existsSync } from "node:fs";
async function main() {
  // Node22内建env解析，先加载环境再导入会创建Prisma/存储客户端的业务模块。
  for (const file of [".env.local", ".env"])
    if (existsSync(file)) process.loadEnvFile(file);
  if (process.argv.includes("--check")) {
    const { shortVideoConfig } = await import("../src/lib/short-video/config");
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    await prisma.svWorker.count();
    const { spawnSync } = await import("node:child_process");
    for (const executable of ["ffmpeg", "ffprobe"])
      if (spawnSync(executable, ["-version"], { stdio: "ignore" }).status !== 0)
        throw new Error("媒体处理工具不可用");
    console.log(
      JSON.stringify({
        ok: true,
        mode: "check-only",
        enabled: shortVideoConfig().enabled,
        noSubmissions: true,
      })
    );
    await prisma.$disconnect();
    return;
  }
  const { sweepShortVideo } =
    await import("../src/services/short-video/worker");
  const { shortVideoConfig } = await import("../src/lib/short-video/config");
  const { prisma } = await import("../src/lib/prisma");
  const { createLogger } = await import("../src/lib/logger");
  const log = createLogger("short-video:process");
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  const owner = `sv-worker:${process.pid}`;
  log.info("worker启动", { owner, enabled: shortVideoConfig().enabled });
  try {
    do {
      try {
        await sweepShortVideo(owner, () => stopping);
      } catch {
        log.error("worker扫描失败", { code: "SWEEP_FAILED" });
      }
      if (stopping || process.argv.includes("--once")) break;
      await new Promise<void>((resolve) => {
        const end = () => {
          clearTimeout(timer);
          process.off("SIGTERM", end);
          process.off("SIGINT", end);
          resolve();
        };
        const timer = setTimeout(end, shortVideoConfig().pollMs);
        process.once("SIGTERM", end);
        process.once("SIGINT", end);
      });
    } while (!stopping);
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "短视频worker启动失败；请核对环境、迁移和依赖（未输出敏感异常）"
  );
  process.exitCode = 1;
});
