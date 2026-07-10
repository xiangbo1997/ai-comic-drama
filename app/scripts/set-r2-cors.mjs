/**
 * 一次性运维脚本：给 R2 bucket 配置 CORS，允许生产站点跨域直传（PUT）。
 *
 * 背景：上传走「预签名 PUT 直传 R2」，浏览器从 comic.cloudsentryai.com PUT 到
 * <account>.r2.cloudflarestorage.com 属跨域，需 bucket 侧返回 CORS 头，否则
 * preflight 被拒 → 前端 "Failed to fetch / net::ERR_FAILED"。
 *
 * 用法（在配了 R2_* 环境变量的机器上，app/ 目录）：
 *   node scripts/set-r2-cors.mjs            # 写入 CORS 规则
 *   node scripts/set-r2-cors.mjs --get      # 只查看当前 CORS
 *
 * 幂等：重复执行覆盖为同一规则集。允许的来源见 ALLOWED_ORIGINS。
 */

import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME = "ai-comic-drama",
} = process.env;

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error(
    "缺少 R2 环境变量（R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）"
  );
  process.exit(1);
}

// 允许跨域直传的来源。生产域名 + 本地开发。按需增删。
const ALLOWED_ORIGINS = [
  "https://comic.cloudsentryai.com",
  "http://localhost:3000",
];

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const corsConfig = {
  CORSRules: [
    {
      AllowedOrigins: ALLOWED_ORIGINS,
      // 预签名直传用 PUT；GET/HEAD 便于前端预览校验；OPTIONS 由 preflight 自动带
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ],
};

async function main() {
  const onlyGet = process.argv.includes("--get");

  if (onlyGet) {
    try {
      const res = await client.send(
        new GetBucketCorsCommand({ Bucket: R2_BUCKET_NAME })
      );
      console.log("当前 CORS 规则：");
      console.log(JSON.stringify(res.CORSRules, null, 2));
    } catch (err) {
      console.log(
        `未查询到 CORS（可能未配置）：${err?.name ?? err?.message ?? err}`
      );
    }
    return;
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET_NAME,
      CORSConfiguration: corsConfig,
    })
  );
  console.log(`✓ 已给 bucket "${R2_BUCKET_NAME}" 写入 CORS 规则：`);
  console.log(`  允许来源：${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`  允许方法：PUT / GET / HEAD`);

  // 回读确认
  const res = await client.send(
    new GetBucketCorsCommand({ Bucket: R2_BUCKET_NAME })
  );
  console.log("回读确认：");
  console.log(JSON.stringify(res.CORSRules, null, 2));
}

main().catch((err) => {
  console.error("配置 CORS 失败：", err);
  process.exit(1);
});
