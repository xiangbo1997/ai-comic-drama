/**
 * 后台管理区布局（服务端鉴权关口）
 *
 * 与 API 侧同一判据（resolveAdmin 回库读 role），非管理员 `notFound()` ——
 * 渲染标准 404 而不是「无权限」，与 API 的 404 伪装保持一致：后台路径不该
 * 通过响应差异被扫描器识别出「存在但没权限」。
 *
 * 外层 (dashboard)/layout.tsx 已保证已登录，这里只判角色。
 */

import { notFound } from "next/navigation";

import { resolveAdmin } from "@/lib/admin";
import { auth } from "@/lib/auth";

import AdminShell from "./admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await resolveAdmin(await auth());

  if (!admin) {
    notFound();
  }

  return <AdminShell role={admin.role}>{children}</AdminShell>;
}
