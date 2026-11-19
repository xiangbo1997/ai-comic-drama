import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { canAccessShortVideo } from "./config";
import { invariant, SvError } from "./errors";
import { createLogger } from "@/lib/logger";
const log = createLogger("short-video:api");
export async function shortVideoUser(request: NextRequest) {
  const session = await auth();
  invariant(session?.user?.id, 401, "UNAUTHENTICATED", "请先登录");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true },
  });
  invariant(
    user && canAccessShortVideo(user),
    403,
    "FEATURE_DISABLED",
    "抽象短视频尚未向当前账号开放"
  );
  if (!["GET", "HEAD"].includes(request.method)) {
    const expected = new Set([request.nextUrl.origin]);
    for (const raw of [process.env.AUTH_URL, process.env.NEXTAUTH_URL])
      if (raw) expected.add(new URL(raw).origin);
    const origin = request.headers.get("origin");
    invariant(
      origin &&
        expected.has(origin) &&
        request.headers.get("sec-fetch-site") !== "cross-site",
      403,
      "ORIGIN_DENIED",
      "请从本站页面提交操作"
    );
  }
  const limit = await rateLimiters.default(request, user.id);
  if (!limit.success)
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后重试",
          retryable: true,
        },
        requestId: randomUUID(),
      },
      { status: 429, headers: rateLimitHeaders(limit) }
    );
  return user;
}
export async function shortVideoBody(request: Request): Promise<unknown> {
  invariant(
    request.headers.get("content-type")?.split(";")[0].trim() ===
      "application/json",
    422,
    "JSON_REQUIRED",
    "请提交JSON请求"
  );
  invariant(request.body, 422, "EMPTY_BODY", "请求内容为空");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      invariant(total <= 100000, 413, "BODY_TOO_LARGE", "请求内容过长");
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new SvError(422, "INVALID_JSON", "JSON内容无效");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function shortVideoError(error: unknown, requestId: string) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: error.issues[0]?.message || "参数无效",
          retryable: false,
        },
        requestId,
      },
      { status: 422 }
    );
  if (error instanceof SvError)
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message, retryable: false },
        requestId,
      },
      { status: error.status }
    );
  log.error("请求未完成", { requestId, code: "INTERNAL_ERROR" });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "操作未完成，请先重新读取状态核对；不要重复创建付费操作",
        retryable: false,
      },
      requestId,
    },
    { status: 500 }
  );
}
