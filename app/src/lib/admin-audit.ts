/**
 * 后台操作审计日志
 *
 * 所有管理员**写操作**都必须落一条 AdminAuditLog。读操作（列表、详情）不记，
 * 否则日志表会被翻页噪音淹没，真正需要追责的写动作反而找不到。
 *
 * ## action 命名约定：`<target>.<verb>`
 *
 * target 用单数名词，verb 用动词或 `子对象.动词`：
 *
 * | action                  | targetType    | 含义                     |
 * | ----------------------- | ------------- | ------------------------ |
 * | `user.role.update`      | user          | 修改用户角色             |
 * | `user.ban`              | user          | 封禁用户                 |
 * | `user.unban`            | user          | 解封用户                 |
 * | `user.credits.grant`    | user          | 管理员发放积分           |
 * | `user.credits.deduct`   | user          | 管理员扣减积分           |
 * | `user.password.reset`   | user          | 重置用户密码             |
 * | `order.mark_paid`       | order         | 手工标记订单已支付       |
 * | `order.refund`          | order         | 订单退款                 |
 * | `system_config.update`  | system_config | 修改系统配置             |
 * | `ops.cleanup`           | ops           | 触发数据清理             |
 * | `bootstrap.promote`     | user          | env 白名单自动提升为超管 |
 *
 * before / after 存变更前后的**局部快照**（只放改动字段），不要整行 dump——
 * 用户行里有 password 哈希与邀请码，整行进日志等于把敏感字段抄进另一张表。
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";

import { createLogger } from "@/lib/logger";

const log = createLogger("lib:admin-audit");

/** 审计对象类型（与 action 前缀对应） */
export type AuditTargetType =
  | "user"
  | "order"
  | "credit"
  | "system_config"
  | "ai_provider"
  | "ops";

/** 一条审计记录的入参 */
export interface AuditLogEntry {
  /** 操作者（管理员）用户 ID */
  actorId: string;
  /** 动作标识，见文件头命名约定 */
  action: string;
  targetType: AuditTargetType;
  targetId?: string;
  /** 变更前局部快照（只放改动字段，勿整行 dump） */
  before?: Prisma.InputJsonValue;
  /** 变更后局部快照 */
  after?: Prisma.InputJsonValue;
  note?: string;
  ip?: string;
}

/**
 * 写一条审计日志。
 *
 * @param db 事务客户端或 PrismaClient。**有业务事务时务必传 tx**——审计与业务
 *   变更同生共死，避免「改了角色但没日志」或「有日志但改动回滚了」。
 *
 * 本函数**不抛异常**：审计失败不该让已成功的管理动作回滚成 500。失败只打
 * error 日志。传 tx 时若事务因别的原因回滚，这条日志也会随之回滚，语义正确。
 */
export async function writeAuditLog(
  db: Prisma.TransactionClient | PrismaClient,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        before: entry.before ?? Prisma.DbNull,
        after: entry.after ?? Prisma.DbNull,
        note: entry.note ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    log.error("写审计日志失败", {
      action: entry.action,
      actorId: entry.actorId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 从请求头解析客户端 IP。
 *
 * 优先 `x-forwarded-for` 的第一跳（最靠近客户端的地址），其次 `x-real-ip`。
 * ⚠️ 两个头都可被客户端伪造，仅当部署在受信反向代理（Nginx / Cloudflare）
 * 之后、由代理覆写这些头时才可信。这里只用于审计参考，不作鉴权依据。
 */
export function requestIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || undefined;
}
