/**
 * 定价配置查询（登录用户可读）
 *
 * GET /api/config/pricing → `{ pricing: Record<key, value>, credits: Record<key, value> }`
 *
 * 用途：客户端的成本提示（「生成三视图需 9 积分」之类）此前把单价硬编码在
 * 组件里（GenerateReferenceModal 的 THREE_VIEWS_COST、LocationsDialog 的
 * PLATE_COST、SceneEditor 的成本提示），后台改价后前端显示会与实扣不一致。
 * 本端点把服务端真值暴露出去，供后续一次性替换那些字面量。
 *
 * 只返回 pricing / credits 两组：limits、feature 属于运营内部参数，
 * 不该让普通用户看见。
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { listSystemConfigItems } from "@/lib/system-config";

const log = createLogger("api:config:pricing");

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const items = await listSystemConfigItems();

    const pricing: Record<string, number | string | boolean> = {};
    const credits: Record<string, number | string | boolean> = {};

    for (const item of items) {
      if (item.group === "pricing") pricing[item.key] = item.value;
      else if (item.group === "credits") credits[item.key] = item.value;
    }

    return NextResponse.json({ pricing, credits });
  } catch (error) {
    log.error("读取定价配置失败:", error);
    return NextResponse.json({ error: "读取定价配置失败" }, { status: 500 });
  }
}
