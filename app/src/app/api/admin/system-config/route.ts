/**
 * 系统配置管理 API
 *
 * GET  /api/admin/system-config —— 列出全部配置项（管理员可读）
 * PUT  /api/admin/system-config —— 修改单项（仅超级管理员）
 *
 * 改价即改钱：这类写操作限定超管，并强制落审计日志（before/after + 操作 IP）。
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { requestIp, writeAuditLog } from "@/lib/admin-audit";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { listSystemConfigItems, setSystemConfig } from "@/lib/system-config";

const log = createLogger("api:admin:system-config");

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const items = await listSystemConfigItems();
    return NextResponse.json({ items });
  } catch (error) {
    log.error("读取系统配置失败:", error);
    return NextResponse.json({ error: "读取系统配置失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin({ superOnly: true });
  if (gate.response) return gate.response;
  const { admin } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const { key, value } =
    typeof body === "object" && body !== null
      ? (body as { key?: unknown; value?: unknown })
      : {};

  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "缺少配置项 key" }, { status: 400 });
  }

  try {
    const { before, after } = await setSystemConfig(key, value, admin.id);

    await writeAuditLog(prisma, {
      actorId: admin.id,
      action: "system_config.update",
      targetType: "system_config",
      targetId: key,
      before: { value: before },
      after: { value: after },
      ip: requestIp(request),
    });

    // 回读整表，让前端直接拿到带 updatedAt 的最新项，省一次往返
    const items = await listSystemConfigItems();
    const item = items.find((i) => i.key === key);

    return NextResponse.json({ item });
  } catch (error) {
    // setSystemConfig 的校验失败抛的是普通 Error，消息面向管理员可直接展示
    const message = error instanceof Error ? error.message : "修改系统配置失败";
    log.warn(`修改系统配置 ${key} 失败: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
