-- 手写迁移草稿（数据库不可达，由 Claude Code 生成；需用户审阅后手动执行）
-- 内容：1) 新增 CreditTransaction 积分流水表  2) Order.amount 由 Float 改为 Decimal(10,2)

-- AlterTable: Order.amount Float(double precision) -> Decimal(10,2)
ALTER TABLE "Order"
  ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2);

-- CreateTable: CreditTransaction（积分流水，含变动后余额快照）
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_sourceId_idx" ON "CreditTransaction"("sourceId");

-- AddForeignKey
ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
