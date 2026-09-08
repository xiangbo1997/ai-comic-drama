/**
 * Vitest 配置（Stage 3.7）
 *
 * 设计：
 * - 只覆盖 src/**，排除 Next.js 生成物 / prisma / node_modules
 * - `tsconfigPaths()` 复用 tsconfig.json 的 @/* 路径
 * - 默认 node 环境；无需 jsdom（当前测试都是纯函数）
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vite 原生支持 tsconfig paths（@/* → ./src/*）
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // 只统计 .ts 源码：原 "src/lib/**" 把同目录的 CLAUDE.md 也算进来，
      // v8 provider 尝试解析 markdown 会抛 PARSE_ERROR 刷屏
      include: ["src/lib/**/*.ts", "src/services/**/*.ts"],
      exclude: [
        "src/lib/prisma.ts",
        "src/lib/auth.ts",
        "src/services/storage.ts",
        "src/services/payment.ts",
        "src/services/ai/index.ts", // 有副作用，E2E 覆盖更合适
        "**/*.d.ts",
      ],
      // 下限而非目标：低于此值说明有整块逻辑裸奔，CI 应当拦下。
      // 当前实际值高于此线，留出余量避免正常迭代频繁踩线。
      thresholds: {
        lines: 40,
      },
    },
  },
});
