/**
 * 任务队列状态 API
 */

import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getJobStatus, getUserJobs, queueManager } from "@/services/queue";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:jobs");

// 获取任务状态
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const queueName = searchParams.get("queue") as
      | "generation"
      | "export"
      | null;

    // 如果指定了 jobId，返回单个任务状态
    if (jobId && queueName) {
      const job = await getJobStatus(queueName, jobId);

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // 验证任务归属
      if (job.data.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      return NextResponse.json({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        result: job.result,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      });
    }

    // 否则返回用户的所有任务
    const jobs = await getUserJobs(session.user.id, queueName || undefined);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        projectId: job.data.projectId,
        sceneId: job.data.sceneId,
      })),
      total: jobs.length,
      queueType: queueManager.isUsingRedis() ? "redis" : "memory",
    });
  } catch (error) {
    log.error("Get job status error:", error);
    return NextResponse.json(
      { error: "Failed to get job status" },
      { status: 500 }
    );
  }
}
