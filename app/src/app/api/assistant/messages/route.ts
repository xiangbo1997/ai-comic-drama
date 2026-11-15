import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assistantUser,
  assistantQuery,
  assistantBody,
  assistantScopeSchema,
  assistantErrorResponse,
} from "@/lib/assistant-api";
import {
  resolveAssistantScope,
  sendAssistantMessage,
  clearAssistantMessages,
} from "@/services/assistant-store";

export const maxDuration = 90;
const messageSchema = assistantScopeSchema
  .safeExtend({
    content: z.string().trim().min(1, "请输入问题").max(4000, "问题最多4000字"),
    requestId: z.uuid(),
    configId: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) => Number(!!value.projectId) + Number(!!value.seriesId) === 1,
    "请选择一部作品或系列"
  );

export async function POST(request: NextRequest) {
  try {
    const user = await assistantUser(request, true);
    if (user instanceof NextResponse) return user;
    const input = messageSchema.parse(await assistantBody(request));
    const scope = await resolveAssistantScope(user, input);
    return NextResponse.json(await sendAssistantMessage(user, scope, input));
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await assistantUser(request);
    if (user instanceof NextResponse) return user;
    const scope = await resolveAssistantScope(user, assistantQuery(request));
    return NextResponse.json(await clearAssistantMessages(user, scope));
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
