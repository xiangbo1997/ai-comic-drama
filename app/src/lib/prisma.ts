import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // 连接池显式上限 + 超时（原用 pg 默认 max=10 且无 connectionTimeout）：
  // fire-and-forget 生成任务在单 node 进程后台跑，高并发下每个 run() 各持
  // 一条连接。无 connectionTimeoutMillis 时借不到连接会无限等待而非快速失败，
  // 叠加无并发闸（见 lib/generation-concurrency.ts）曾是单机雪崩路径。
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
