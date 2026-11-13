import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ProducerSettingsZ } from "@/lib/producer-run";
import {
  createProducerRun,
  listProducerRuns,
  ProducerRunError,
} from "@/services/producer-runs";
import { createLogger } from "@/lib/logger";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
const log = createLogger("api:producer-runs");
const CreateZ = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  settings: ProducerSettingsZ,
});
export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listProducerRuns(session.user.id));
  } catch (error) {
    log.error("List checkpoints failed", error);
    return NextResponse.json({ error: "读取制片人草稿失败" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimiters.default(request, session.user.id);
  if (!limited.success)
    return NextResponse.json(
      { error: "创建草稿过于频繁，请稍后重试", retryAfter: limited.retryAfter },
      { status: 429, headers: rateLimitHeaders(limited) }
    );
  const parsed = CreateZ.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "草稿参数无效" }, { status: 400 });
  try {
    return NextResponse.json(
      await createProducerRun(
        session.user.id,
        parsed.data.operationId,
        parsed.data.settings
      )
    );
  } catch (error) {
    if (error instanceof ProducerRunError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    log.error("Create checkpoint failed", error);
    return NextResponse.json(
      { error: "创建草稿失败，请重试同一请求" },
      { status: 500 }
    );
  }
}
