/**
 * 用户管理模块的纯逻辑助手
 *
 * 这里只放**不碰 DB、不碰请求**的判定函数，目的是让「谁能对谁做什么」这条
 * 最容易出安全事故的规则有单一真源，并且能被单测穷举覆盖。API 路由与前端
 * 页面共用同一份判定：服务端用它拦请求，客户端用它决定按钮是否渲染，避免
 * 两边规则漂移导致「按钮点得动但请求被拒」或更糟的「按钮不该点但能点通」。
 *
 * 分层约束：属于 lib 层，除 @prisma/client 的类型外零依赖。
 */

import type { UserRole } from "@prisma/client";

/** 管理员可对目标用户执行的动作 */
export type AdminUserAction =
  | "update" // 改昵称等非敏感字段
  | "role" // 改角色（超管专属）
  | "ban" // 封禁 / 解封（超管专属）
  | "credits" // 增减积分
  | "password"; // 重置密码（超管专属）

/** 判定所需的操作者信息（AdminUser 的结构子集） */
export interface ActorLike {
  id: string;
  role: UserRole;
}

/** 判定所需的目标用户信息 */
export interface TargetLike {
  id: string;
  role: UserRole;
}

/** 判定结果：允许则 allowed=true，拒绝时带面向管理员的中文原因 */
export type PermissionVerdict =
  | { allowed: true; reason?: undefined }
  | { allowed: false; reason: string };

/**
 * 仅超级管理员可执行的动作。
 *
 * 改角色 / 封禁 / 重置密码都能直接夺取或摧毁账号，故收窄到超管。改昵称与
 * 增减积分留给普通管理员，是客服日常工单的主要动作。
 */
const SUPER_ONLY_ACTIONS: ReadonlySet<AdminUserAction> =
  new Set<AdminUserAction>(["role", "ban", "password"]);

/** 该动作是否需要超级管理员 */
export function isSuperOnlyAction(action: AdminUserAction): boolean {
  return SUPER_ONLY_ACTIONS.has(action);
}

/**
 * 权限矩阵：判断 actor 能否对 target 执行 action。
 *
 * 规则按拒绝优先级从高到低：
 *
 * 1. **自我保护**：任何人不得对自己执行 role / ban / password / credits。
 *    改自己的角色等于自我提权或误把自己踢出后台（超管把自己降级后就再也没
 *    人能改回来）；封自己会把自己锁在门外；给自己发积分是最典型的内部舞弊
 *    路径，必须由另一个管理员操作以留下可追责的双人痕迹。改自己昵称无害，
 *    放行。
 * 2. **非管理员一律拒绝**：role=USER 不该走到这里，但兜底防止调用方漏判。
 * 3. **超管目标只有超管能动**：普通管理员对 SUPER_ADMIN 的任何写操作都拒绝，
 *    否则 ADMIN 可以给超管扣光积分或改其昵称，构成横向越权。
 * 4. **超管专属动作**：普通管理员不能改角色 / 封禁 / 重置密码。
 *
 * 注意本函数**不校验业务参数**（积分数额、密码强度等），那些由 zod 负责。
 */
export function canActOn(
  actor: ActorLike,
  target: TargetLike,
  action: AdminUserAction
): PermissionVerdict {
  const isSelf = actor.id === target.id;

  if (isSelf && action !== "update") {
    return {
      allowed: false,
      reason: "不能对自己执行该操作，请由其他管理员代为处理",
    };
  }

  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return { allowed: false, reason: "需要管理员权限" };
  }

  if (target.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    return { allowed: false, reason: "普通管理员不能操作超级管理员账号" };
  }

  if (isSuperOnlyAction(action) && actor.role !== "SUPER_ADMIN") {
    return { allowed: false, reason: "需要超级管理员权限" };
  }

  return { allowed: true };
}

/** 列表排序字段（与 API 查询参数 `sort` 一一对应） */
export type AdminUserSort = "createdAt" | "credits" | "lastLoginAt";

/** 合法排序字段集合，用于把不可信的查询参数收敛到白名单 */
const SORT_FIELDS: readonly AdminUserSort[] = [
  "createdAt",
  "credits",
  "lastLoginAt",
];

/**
 * 解析排序参数。
 *
 * 直接把用户传的字符串塞进 Prisma 的 orderBy 会在字段不存在时抛 500，且相当
 * 于把查询计划的控制权交给调用方，故一律走白名单，非法值回落 createdAt。
 */
export function parseUserSort(raw: string | null): AdminUserSort {
  const value = raw?.trim();
  return SORT_FIELDS.includes(value as AdminUserSort)
    ? (value as AdminUserSort)
    : "createdAt";
}
