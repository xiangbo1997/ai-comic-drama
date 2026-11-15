import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assistantUser, assistantBody } from "@/lib/assistant-api";
import { CreateAssistantExecutionZ } from "@/lib/assistant-execution";
import { executionErrorResponse } from "@/lib/assistant-execution-api";
import {
  createAssistantExecution,
  latestAssistantExecution,
} from "@/services/assistant-execution/store";

export async function GET(request: NextRequest) {
  try {
    const userId = await assistantUser(request);
    if (userId instanceof NextResponse) return userId;
    const projectId = z
      .string()
      .min(1)
      .max(100)
      .parse(request.nextUrl.searchParams.get("projectId"));
    return NextResponse.json(
      { execution: await latestAssistantExecution(userId, projectId) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return executionErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const userId = await assistantUser(request);
    if (userId instanceof NextResponse) return userId;
    const input = CreateAssistantExecutionZ.parse(await assistantBody(request));
    return NextResponse.json({
      execution: await createAssistantExecution(
        userId,
        input.requestId,
        input.projectId,
        input.options
      ),
    });
  } catch (error) {
    return executionErrorResponse(error);
  }
}
