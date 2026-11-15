import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assistantUser,
  assistantBody,
  assistantScopeSchema,
  assistantErrorResponse,
} from "@/lib/assistant-api";
import {
  resolveAssistantScope,
  updateAssistantMemory,
} from "@/services/assistant-store";

const memorySchema = assistantScopeSchema
  .safeExtend({
    content: z.string().trim().max(12000, "长期记忆最多12000字"),
    version: z.number().int().min(0).max(2147483646),
  })
  .refine(
    (value) => Number(!!value.projectId) + Number(!!value.seriesId) === 1,
    "请选择一部作品或系列"
  );

export async function PATCH(request: NextRequest) {
  try {
    const user = await assistantUser(request);
    if (user instanceof NextResponse) return user;
    const input = memorySchema.parse(await assistantBody(request));
    const scope = await resolveAssistantScope(user, input);
    return NextResponse.json(
      await updateAssistantMemory(user, scope, input.content, input.version)
    );
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
