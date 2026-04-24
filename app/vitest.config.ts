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
      include: ["src/lib/**", "src/services/**"],
      exclude: [
        "src/lib/prisma.ts",
        "src/lib/auth.ts",
        "src/services/storage.ts",
        "src/services/payment.ts",
        "src/services/ai/index.ts", // 有副作用，E2E 覆盖更合适
        "**/*.d.ts",
      ],
    },
  },
});
