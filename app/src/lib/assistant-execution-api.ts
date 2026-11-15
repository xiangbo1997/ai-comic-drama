import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantExecutionError } from "./assistant-execution";
import { AssistantStoreError } from "@/services/assistant-store";

export function executionErrorResponse(error: unknown) {
  if (
    error instanceof AssistantExecutionError ||
    error instanceof AssistantStoreError
  )
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: "执行参数无效，请检查预算、修复次数与当前集" },
      { status: 400 }
    );
  return NextResponse.json(
    { error: "读取或保存执行任务失败，请稍后重试" },
    { status: 500 }
  );
}
