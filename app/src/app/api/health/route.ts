/**
 * 健康检查端点（运维，2026-09-08）
 *
 * GET /api/health
 *
 * 部署脚本 / 进程守护 / 外部拨测用它判断「服务真的起来了」——此前只能
 * curl 首页，首页是静态渲染，DB 挂了照样 200，重启后无从确认数据库连通。
 * 这里真跑一次 SELECT 1，DB 不通即 503，让 deploy.sh 能 fail fast。
 *
 * 无鉴权、无限流（拨测要能匿名打），故响应里不含任何配置/密钥信息：
 * 只有存活标志、进程运行时长与构建 commit（由部署时注入 GIT_COMMIT）。
 * proxy.ts 的 matcher 只列了页面前缀（/projects /characters …），
 * 不含 /api，本端点不会被登录跳转拦截。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:health");

// 必须每次真查库，不能被静态化/缓存
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      uptime: process.uptime(),
      commit: process.env.GIT_COMMIT ?? null,
    });
  } catch (error) {
    // 端点匿名可访问，故不回传原始错误（DB 错误常带连接串/主机名），
    // 详情只进服务端日志
    log.error("Health check failed:", error);
    return NextResponse.json(
      { ok: false, error: "database unreachable" },
      { status: 503 }
    );
  }
}
