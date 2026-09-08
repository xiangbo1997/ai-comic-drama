/**
 * 管理员重置用户密码 API
 *
 * POST /api/admin/users/[id]/reset-password —— { newPassword }（仅超管）
 *
 * 重置密码等于直接接管账号，故限定超级管理员，且**任何环节都不记录明文或
 * 哈希**：审计日志只记「谁在什么时候重置了谁的密码」，密码本身连 before/after
 * 都不放——审计表的可见范围比 User 表更广，把哈希抄进去等于扩大泄露面。
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { requestIp, writeAuditLog } from "@/lib/admin-audit";
import { canActOn } from "@/lib/admin-users";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:users:reset-password");

/** bcrypt 成本因子：与 lib/auth.ts 的注册流程保持一致 */
const BCRYPT_ROUNDS = 10;

const bodySchema = z.object({
  newPassword: z.string().min(8, "密码至少 8 位").max(128, "密码最长 128 位"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin({ superOnly: true });
  if (gate.response) return gate.response;
  const { admin } = gate;

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "请求参数非法" },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const verdict = canActOn(admin, target, "password");
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 });
  }

  const ip = requestIp(request);

  try {
    const hashed = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { password: hashed },
      });

      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "user.password.reset",
        targetType: "user",
        targetId: id,
        note: "管理员重置密码",
        ip,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("重置用户密码失败:", error);
    return NextResponse.json({ error: "重置用户密码失败" }, { status: 500 });
  }
}
