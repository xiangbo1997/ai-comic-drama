/**
 * 积分流水按日汇总（仪表盘用）
 *
 * GET /api/admin/credit-transactions/summary?days=30
 *   → { days, series: [{ date, granted, charged }] }
 *
 * 用原生 SQL 的 `date_trunc('day', ...)` 聚合：Prisma 的 groupBy 只能按整个
 * DateTime 分组，秒级不同的两条流水会各成一组，拿不到「按天」的曲线。
 *
 * 时区取 UTC（`date_trunc` 默认按列的时区，timestamp 列即 UTC）。运营看的是
 * 趋势不是精确日切，UTC 与东八区最多差 8 小时的归属，暂不引入时区参数。
 *
 * 无流水的日期**不会**出现在结果里（SQL 只聚合有数据的行）；前端补零成连续
 * 序列，避免在 SQL 里生成日历序列这种更难维护的写法。
 */

import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("api:admin:credit-transactions:summary");

/** 默认窗口天数 */
const DEFAULT_DAYS = 30;
/** 上限：再长的窗口应该走离线报表，不该让后台页面拖垮库 */
const MAX_DAYS = 180;

/** 原生 SQL 的行形状；SUM 在 Postgres 里返回 bigint → Prisma 映射成 BigInt */
interface DailyRow {
  day: Date;
  granted: bigint | null;
  charged: bigint | null;
}

/** 解析 days 参数并夹紧到 1..MAX_DAYS，非法值回落默认 */
function parseDays(raw: string | null): number {
  if (!raw) return DEFAULT_DAYS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_DAYS;
  }
  return Math.min(parsed, MAX_DAYS);
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const days = parseDays(searchParams.get("days"));

    // 窗口起点对齐到当天零点，避免「今天只统计了半天」造成曲线首尾塌陷
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    // 参数化查询：days 已被夹紧成整数，since 走 Prisma 参数绑定
    const rows = await prisma.$queryRaw<DailyRow[]>`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COALESCE(SUM(CASE WHEN "delta" > 0 THEN "delta" ELSE 0 END), 0) AS granted,
        COALESCE(SUM(CASE WHEN "delta" < 0 THEN -"delta" ELSE 0 END), 0) AS charged
      FROM "CreditTransaction"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return NextResponse.json({
      days,
      series: rows.map((row) => ({
        // 只取日期部分，前端不需要时间戳
        date: row.day.toISOString().slice(0, 10),
        // BigInt 不能直接 JSON 序列化，转成 Number（积分量级远小于 2^53）
        granted: Number(row.granted ?? 0),
        charged: Number(row.charged ?? 0),
      })),
    });
  } catch (err) {
    log.error("查询积分流水日汇总失败", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "查询日汇总失败" }, { status: 500 });
  }
}
