/**
 * 管理员增减用户积分 API
 *
 * POST /api/admin/users/[id]/credits —— { direction, amount, note }
 *
 * 积分变动一律经 lib/credits.ts（事务 + 流水 + balanceAfter 快照），审计日志
 * 写在同一事务里：要么「钱动了且有日志」，要么两者都没发生，杜绝「扣了钱查
 * 不到是谁扣的」。
 */

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { requestIp, writeAuditLog } from "@/lib/admin-audit";
import { canActOn } from "@/lib/admin-users";
import {
  chargeCredits,
  grantCredits,
  InsufficientCreditsError,
} from "@/lib/credits";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:users:credits");

/**
 * 单次操作上限 100 万。
 *
 * 不是业务需要这么大，而是防手滑：多敲几个 0 造成的巨额发放虽然能反向扣回，
 * 但期间用户可能已经把积分消费掉。上限把误操作的破坏半径钉死。
 */
const MAX_AMOUNT = 1_000_000;

const bodySchema = z.object({
  direction: z.enum(["grant", "deduct"]),
  amount: z
    .number()
    .int("积分必须是整数")
    .positive("积分必须大于 0")
    .max(MAX_AMOUNT, `单次不得超过 ${MAX_AMOUNT}`),
  note: z
    .string()
    .trim()
    .min(1, "请填写操作理由")
    .max(200, "操作理由最长 200 字"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
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
  const { direction, amount, note } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, credits: true },
  });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const verdict = canActOn(admin, target, "credits");
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 });
  }

  const ip = requestIp(request);
  const isGrant = direction === "grant";

  try {
    const credits = await prisma.$transaction(async (tx) => {
      if (isGrant) {
        await grantCredits(tx, {
          userId: id,
          amount,
          type: "ADMIN_GRANT",
          source: "admin",
          // ADMIN_GRANT 不进幂等索引（见 lib/credits.ts 注释），每次发放必须
          // 自带唯一 sourceId，否则流水无法定位到具体哪一次操作
          sourceId: `admin:${admin.id}:${randomUUID()}`,
          note,
        });
      } else {
        await chargeCredits(tx, {
          userId: id,
          amount,
          type: "ADMIN_DEDUCT",
          source: "admin",
          sourceId: `admin:${admin.id}:${randomUUID()}`,
          note,
        });
      }

      const after = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { credits: true },
      });

      await writeAuditLog(tx, {
        actorId: admin.id,
        action: isGrant ? "user.credits.grant" : "user.credits.deduct",
        targetType: "user",
        targetId: id,
        before: { credits: target.credits },
        after: { credits: after.credits },
        note: `${isGrant ? "发放" : "扣减"} ${amount} 积分：${note}`,
        ip,
      });

      return after.credits;
    });

    return NextResponse.json({ credits });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: `积分不足：当前余额 ${error.available}，需要扣减 ${error.required}`,
          credits: error.available,
        },
        { status: 400 }
      );
    }
    log.error("调整用户积分失败:", error);
    return NextResponse.json({ error: "调整用户积分失败" }, { status: 500 });
  }
}
