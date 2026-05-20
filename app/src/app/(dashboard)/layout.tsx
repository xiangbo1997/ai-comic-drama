import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import DashboardShell from "./dashboard-shell";

/**
 * Dashboard 区域的服务端布局：
 *
 * - 在 Node.js Runtime（RSC 默认）执行 NextAuth 的 auth() 鉴权
 * - 未登录立即 redirect("/login")，避免后续子页面访问 DB 时拿到 null user
 * - 通过 server -> client 的 props 边界，把渲染交给 DashboardShell（client 组件）
 *
 * 这层是真正的鉴权关口；middleware.ts 只做轻量 cookie 探测、不查 DB
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
