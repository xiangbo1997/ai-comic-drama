import { defineConfig } from "@playwright/test";

// 独立组件浏览器验收使用本地模拟数据，不启动需数据库的 Next 登录流程。
export default defineConfig({
  testDir: "./e2e/components",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 375, height: 812 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/components/server.mjs",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
