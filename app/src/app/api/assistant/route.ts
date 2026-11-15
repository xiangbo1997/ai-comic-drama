import { NextRequest, NextResponse } from "next/server";
import {
  assistantUser,
  assistantQuery,
  assistantErrorResponse,
} from "@/lib/assistant-api";
import {
  resolveAssistantScope,
  getAssistantState,
} from "@/services/assistant-store";

export async function GET(request: NextRequest) {
  try {
    const user = await assistantUser(request);
    if (user instanceof NextResponse) return user;
    const scope = await resolveAssistantScope(user, assistantQuery(request));
    return NextResponse.json(await getAssistantState(user, scope), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
