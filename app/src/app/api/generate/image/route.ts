import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { createLogger } from "@/lib/logger";
import { GenerationJobError } from "@/services/generation/jobs/types";
import { submitImageJob } from "@/services/generation/jobs/image";
const log = createLogger("api:generate:image");
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.imageGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const submission = await submitImageJob(userId, await request.json());
    return NextResponse.json(submission, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationJobError)
      return NextResponse.json(error.body, { status: error.status });
    log.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}
