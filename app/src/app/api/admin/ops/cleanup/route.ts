/**
 * 运维页的清理触发入口
 *
 * POST /api/admin/ops/cleanup
 *
 * 清理逻辑的**唯一实现**在 `/api/admin/cleanup`（它同时服务于外部 cron，
 * 带 x-cron-secret 双通道鉴权）。这里不复制那套删除/过期/回收/裁剪的 SQL——
 * 复制意味着以后改保留期要改两处，漏一处就是「面板点了没效果」这类最难查的
 * bug。做法是**直接调用它导出的 POST 函数**：Route Handler 就是普通的
 * `(req) => Response`，在同进程内调用没有 HTTP 往返，也不受端口/反代影响。
 *
 * 传进去的 NextRequest 只用于让被调方读取头部（requestIp 取 x-forwarded-for）。
 * 鉴权不依赖它——`auth()` 从 Next 的异步请求上下文读 cookie，上下文仍是当前
 * 这个真实请求，所以被调方解析出的管理员就是此刻登录的人，审计日志的 actorId
 * 自然正确。审计（`ops.cleanup`）也由被调方写，此处不重复记，否则一次操作
 * 两条日志。
 */

import { NextRequest, NextResponse } from "next/server";

import { POST as cleanupPost } from "@/app/api/admin/cleanup/route";
import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:ops:cleanup");

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // 先自行把关：被调方虽然也鉴权，但它接受 cron 密钥通道，而本端点只给
  // 后台页面用，必须是登录管理员。提前拦下也避免把 404 语义混在一起。
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    // 重建一个不含 x-cron-secret 的请求：避免调用方把密钥头透传进来，
    // 绕过上面刚做的管理员校验走 cron 通道。
    const forwarded = new NextRequest(request.url, {
      method: "POST",
      headers: sanitizedHeaders(request),
    });

    return await cleanupPost(forwarded);
  } catch (error) {
    log.error("触发清理失败:", error);
    return NextResponse.json({ error: "触发清理失败" }, { status: 500 });
  }
}

/** 复制请求头但剥掉 cron 密钥，只保留审计取 IP 需要的转发头 */
function sanitizedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete("x-cron-secret");
  return headers;
}
