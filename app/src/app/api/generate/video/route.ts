import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { createLogger } from "@/lib/logger";
import { GenerationJobError } from "@/services/generation/jobs/types";
import { submitVideoJob } from "@/services/generation/jobs/video";
const log = createLogger("api:generate:video");
export const maxDuration = 1800;
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.videoGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const submission = await submitVideoJob(userId, await request.json());
    return NextResponse.json(submission, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationJobError)
      return NextResponse.json(error.body, { status: error.status });
    log.error("Video generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate video" },
      { status: 500 }
    );
  }
}
