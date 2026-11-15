import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { AssistantStoreError } from "@/services/assistant-store";
import { AssistantReplyError } from "@/services/assistant-reply";

export const assistantScopeSchema = z
  .object({
    projectId: z.string().trim().min(1).max(100).optional(),
    seriesId: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) => Number(!!value.projectId) + Number(!!value.seriesId) === 1,
    "请选择一部作品或系列"
  );

export async function assistantUser(request: NextRequest, generating = false) {
  const session = await auth();
  if (!session?.user?.id) throw new AssistantStoreError(401, "请先登录");
  const limit = await (
    generating ? rateLimiters.imageGeneration : rateLimiters.default
  )(request, session.user.id);
  if (!limit.success)
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", retryAfter: limit.retryAfter },
      { status: 429, headers: rateLimitHeaders(limit) }
    );
  return session.user.id;
}

export function assistantQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (
    params.getAll("projectId").length > 1 ||
    params.getAll("seriesId").length > 1
  )
    throw new AssistantStoreError(400, "作品参数重复");
  return assistantScopeSchema.parse({
    projectId: params.get("projectId") ?? undefined,
    seriesId: params.get("seriesId") ?? undefined,
  });
}

export async function assistantBody(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 100_000)
    throw new AssistantStoreError(413, "请求内容过长");
  if (!request.body) throw new AssistantStoreError(400, "请求内容无效");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    // 流式计数，禁止缺少Content-Length的请求先完整占用内存再校验。
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 100_000) {
        await reader.cancel().catch(() => {});
        throw new AssistantStoreError(413, "请求内容过长");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (text.length > 50_000) throw new AssistantStoreError(413, "请求内容过长");
  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantStoreError(400, "请求内容无效");
  }
}

export function assistantErrorResponse(error: unknown) {
  if (
    error instanceof AssistantStoreError ||
    error instanceof AssistantReplyError
  )
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "请求参数无效" },
      { status: 400 }
    );
  // 上游异常可能含密钥和提示词，不直接记录或透传给浏览器。
  return NextResponse.json(
    { error: "助手暂时无法回复，请稍后重试；对话和记忆已保留" },
    { status: 500 }
  );
}
