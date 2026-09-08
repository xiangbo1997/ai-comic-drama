/**
 * 手工标记订单已支付（超级管理员）
 *
 * POST /api/admin/orders/[id]/mark-paid
 *   body { paymentMethod, paymentId?, note }
 *   → { status, order }
 *
 * 使用场景：用户实际付款成功但回调丢失/验签失败，订单卡在 PENDING。管理员在
 * 渠道后台核对到账后手工履约。
 *
 * 走的是与支付回调**完全同一条**履约路径（lib/orders.ts 的 fulfillPaidOrder），
 * 因此幂等语义、积分发放类型、订阅创建行为都一致；额外多一条审计日志。
 * 定为 superOnly：这是凭空给用户发积分的能力，等同于印钞。
 */

import type { PaymentMethod } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { requestIp } from "@/lib/admin-audit";
import { createLogger } from "@/lib/logger";
import { fulfillPaidOrder, serializeAmount } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:orders:mark-paid");

const PAYMENT_METHODS: PaymentMethod[] = ["WECHAT", "ALIPAY", "STRIPE"];

interface MarkPaidBody {
  paymentMethod?: unknown;
  paymentId?: unknown;
  note?: unknown;
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

    let body: MarkPaidBody;
    try {
      body = (await request.json()) as MarkPaidBody;
    } catch {
      return NextResponse.json(
        { error: "请求体不是合法 JSON" },
        { status: 400 }
      );
    }

    const paymentMethod = body.paymentMethod;
    if (
      typeof paymentMethod !== "string" ||
      !PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)
    ) {
      return NextResponse.json(
        { error: `paymentMethod 必须是 ${PAYMENT_METHODS.join(" / ")} 之一` },
        { status: 400 }
      );
    }

    const paymentId =
      typeof body.paymentId === "string" && body.paymentId.trim()
        ? body.paymentId.trim()
        : undefined;
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!note) {
      return NextResponse.json(
        { error: "请填写操作理由，将记入审计日志" },
        { status: 400 }
      );
    }

    // 先按主键取订单号：fulfillPaidOrder 的入口是 orderNo（与回调对齐）
    const existing = await prisma.order.findUnique({
      where: { id },
      select: { orderNo: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    const outcome = await fulfillPaidOrder({
      orderNo: existing.orderNo,
      paymentMethod: paymentMethod as PaymentMethod,
      paymentId,
      actor: {
        type: "admin",
        adminId: admin.id,
        note,
        ip: requestIp(request),
      },
    });

    if (outcome.status === "not_found") {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    if (outcome.status === "already_paid") {
      return NextResponse.json(
        { error: "订单已是已支付状态，无需重复标记" },
        { status: 409 }
      );
    }

    if (outcome.status === "invalid_state") {
      return NextResponse.json(
        {
          error: `订单当前状态为 ${outcome.order?.status}，只有待支付订单可标记为已支付`,
        },
        { status: 409 }
      );
    }

    // 重新读一次拿到履约后的最新状态（fulfillPaidOrder 返回的是履约前快照）
    const updated = await prisma.order.findUnique({ where: { id } });

    log.info(`管理员手工标记订单已支付: ${existing.orderNo} by ${admin.email}`);

    return NextResponse.json({
      status: outcome.status,
      order: updated
        ? { ...updated, amount: serializeAmount(updated.amount) }
        : null,
    });
  } catch (err) {
    log.error("手工标记订单已支付失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "标记失败，请稍后重试" },
      { status: 500 }
    );
  }
}
