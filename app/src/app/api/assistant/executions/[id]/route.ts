import { NextRequest, NextResponse } from "next/server";
import { assistantUser, assistantBody } from "@/lib/assistant-api";
import { AssistantExecutionActionZ } from "@/lib/assistant-execution";
import {
  readAssistantExecution,
  controlAssistantExecution,
} from "@/services/assistant-execution/store";
import { wakeAssistantExecutionWorker } from "@/services/assistant-execution/worker";
import { executionErrorResponse } from "@/lib/assistant-execution-api";
type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const userId = await assistantUser(request);
    if (userId instanceof NextResponse) return userId;
    return NextResponse.json(
      { execution: await readAssistantExecution(userId, (await params).id) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return executionErrorResponse(error);
  }
}
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const userId = await assistantUser(request);
    if (userId instanceof NextResponse) return userId;
    const input = AssistantExecutionActionZ.parse(await assistantBody(request));
    const execution = await controlAssistantExecution(
      userId,
      (await params).id,
      input.action,
      input.requestId
    );
    if (["running", "stopping"].includes(execution.status))
      wakeAssistantExecutionWorker();
    return NextResponse.json({ execution });
  } catch (error) {
    return executionErrorResponse(error);
  }
}
