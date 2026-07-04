/**
 * Playwright E2E 配置
 *
 * 冒烟定位：验证「登录 → 项目 → 编辑器」关键用户路径可达，
 * 与 Vitest 纯函数单测互补（vitest 只跑 tests/**，互不干扰）。
 *
 * 前置条件：本地 PostgreSQL 可连（.env 的 DATABASE_URL），schema 已
 * `prisma db push`。webServer 会自动拉起 `pnpm dev`（已有则复用）。
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // 注册/登录等用例共享 dev server，串行避免编译抖动下的偶发超时
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
