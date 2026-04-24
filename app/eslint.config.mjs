import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier, // 禁用与 Prettier 冲突的规则
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 下划线前缀约定：argsIgnorePattern + varsIgnorePattern + caughtErrorsIgnorePattern
  // 让 _xxx 形式的变量/参数/错误被视为"故意忽略"
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // 项目场景：编辑器工具，大量 <img> 展示动态 AI 生成图（尺寸不定），
      // 使用 next/image 反而需 fill + sizes 全套且要配 remotePatterns，收益低。
      // 明确关闭此规则，视为项目决策。
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
