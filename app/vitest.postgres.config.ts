import { defineConfig } from "vitest/config";

// 必须显式指定隔离测试库；不读取.env.local，拒绝误连现有应用库。
const databaseUrl = process.env.COMIC_POSTGRES_TEST_URL;
if (!databaseUrl) throw new Error("请设置独立临时库 COMIC_POSTGRES_TEST_URL");
const target = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !target.pathname.startsWith("/ai_comic_verify")
) {
  throw new Error("PostgreSQL验收仅允许本机ai_comic_verify前缀的隔离测试库");
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/*.postgres.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { DATABASE_URL: databaseUrl, PG_POOL_MAX: "20" },
  },
});
