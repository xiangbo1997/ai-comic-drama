/**
 * Admin 权限判定（Stage 3.6）
 *
 * 简单方案：`ADMIN_EMAILS` 环境变量配置逗号分隔的管理员邮箱白名单。
 * - 未设置 → 所有 admin 端点返回 404（伪装不存在，避免被扫描探测）
 * - 邮箱匹配 → 允许访问
 *
 * 未来可升级：Prisma User.role 字段 + RBAC；当前保持最简。
 */

import type { Session } from "next-auth";

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(session: Session | null): boolean {
  const email = session?.user?.email?.toLowerCase();
  if (!email) return false;
  return getAdminEmails().includes(email);
}
