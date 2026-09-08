/**
 * 订单退款（超级管理员）
 *
 * POST /api/admin/orders/[id]/refund
 *   body { reason, deductCredits }
 *   → { status, clawedBack, order }
 *
 * ⚠️ **本接口不向支付渠道发起退款**。真钱要在微信商户平台 / 支付宝商家中心 /
 * Stripe Dashboard 里人工退。本接口做的是「渠道已退款，把系统内订单状态与积分
 * 对齐」，故必须在渠道操作完成后再调用，顺序反了会出现「系统显示已退但钱没退」。
 *
 * deductCredits=true 时按 min(订单积分, 用户余额) 扣回，绝不扣成负数；实际扣回
 * 数额与差额都记进审计日志。
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { requestIp } from "@/lib/admin-audit";
import { createLogger } from "@/lib/logger";
import { refundOrder, serializeAmount } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:orders:refund");

interface RefundBody {
  reason?: unknown;
  deductCredits?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin({ superOnly: true });
  if (gate.response) return gate.response;
  const { admin } = gate;

  try {
    const { id } = await params;

    let body: RefundBody;
    try {
      body = (await request.json()) as RefundBody;
    } catch {
      return NextResponse.json(
        { error: "请求体不是合法 JSON" },
        { status: 400 }
      );
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json(
        { error: "请填写退款理由，将记入审计日志" },
        { status: 400 }
      );
    }

    if (typeof body.deductCredits !== "boolean") {
      return NextResponse.json(
        { error: "deductCredits 必须是布尔值" },
        { status: 400 }
      );
    }

    const existing = await prisma.order.findUnique({
      where: { id },
      select: { orderNo: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    const outcome = await refundOrder({
      orderNo: existing.orderNo,
      adminId: admin.id,
      reason,
      deductCredits: body.deductCredits,
      ip: requestIp(request),
    });

    if (outcome.status === "not_found") {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    if (outcome.status === "already_refunded") {
      return NextResponse.json(
        { error: "订单已退款，无需重复操作" },
        { status: 409 }
      );
    }

    if (outcome.status === "invalid_state") {
      return NextResponse.json(
        {
          error: `订单当前状态为 ${outcome.order?.status}，只有已支付订单可退款`,
        },
        { status: 409 }
      );
    }

    const updated = await prisma.order.findUnique({ where: { id } });

    log.info(
      `管理员退款订单: ${existing.orderNo} by ${admin.email}, 扣回 ${outcome.clawedBack ?? 0} 积分`
    );

    return NextResponse.json({
      status: outcome.status,
      clawedBack: outcome.clawedBack ?? 0,
      order: updated
        ? { ...updated, amount: serializeAmount(updated.amount) }
        : null,
    });
  } catch (err) {
    log.error("订单退款失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "退款失败，请稍后重试" },
      { status: 500 }
    );
  }
}
