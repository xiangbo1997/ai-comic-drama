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

  // 封禁用户即便手里有未过期的 JWT 也不得进入应用。status 由 jwt callback
  // 周期性回库刷新（5 分钟窗口），故封禁最迟一个窗口后生效。
  if (session.user.status === "BANNED") {
    redirect("/login?banned=1");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
