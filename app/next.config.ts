import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  // 运行时上传目录不打包；固定调色资产显式收录，避免动态路径追踪整个仓库。
  outputFileTracingIncludes: {
    "/*": ["./public/luts/*.cube"],
    "/api/assistant/messages": [
      "../.claude/skills/**/SKILL.md",
      "../.agents/skills/**/SKILL.md",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "replicate.delivery" },
      { protocol: "https", hostname: "**.replicate.delivery" },
      { protocol: "https", hostname: "fal.media" },
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "cdn.siliconflow.cn" },
      {
        protocol: "https",
        hostname: "oaidalleapiprodscus.blob.core.windows.net",
      },
    ],
  },
};

export default nextConfig;
