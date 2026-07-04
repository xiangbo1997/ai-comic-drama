-- 积分幂等部分唯一索引（2026-07-05，a1 审计 P1-2）
--
-- 只约束「需要幂等」的类型：同一用户、同类型、同 sourceId 只能有一条流水。
-- 退款/发放靠此索引 + refundCredits 的 P2002 catch 兜底并发双花。
--
-- 为何是 partial（带 WHERE）：GENERATE_* 扣费每次都合法产生新流水，且历史
-- 上其 sourceId 未必唯一（如 GENERATE_REFERENCE 复用同一 sourceId），全类型
-- 约束会误伤正常多次扣费。故只覆盖 REFUND/PAYMENT/SUBSCRIPTION/CHECKIN/INVITE。
--
-- Prisma schema 无法声明带 WHERE 的唯一索引，用本 SQL 手动建（db push 后执行）。
-- IF NOT EXISTS 保证幂等，可重复执行。

CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_idempotency_key"
  ON "CreditTransaction" ("userId", "type", "sourceId")
  WHERE "sourceId" IS NOT NULL
    AND "type" IN ('REFUND', 'PAYMENT', 'SUBSCRIPTION', 'CHECKIN', 'INVITE');
