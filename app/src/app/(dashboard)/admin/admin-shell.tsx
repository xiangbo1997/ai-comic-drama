"use client";

/**
 * 后台管理区外壳：左侧导航 + 右侧内容。
 *
 * 与 dashboard-shell 的横向顶栏不同，后台用左侧竖导航——模块条目会持续增加，
 * 竖排比顶栏更能容纳，也符合管理后台的惯例。顶栏（含用户菜单）由外层
 * DashboardShell 提供，这里不重复渲染。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Coins,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { UserRole } from "@prisma/client";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "用户", icon: Users, exact: false },
  { href: "/admin/orders", label: "订单", icon: Receipt, exact: false },
  { href: "/admin/credits", label: "积分流水", icon: Coins, exact: false },
  { href: "/admin/settings", label: "系统设置", icon: Settings, exact: false },
  { href: "/admin/ops", label: "运维", icon: Wrench, exact: false },
  { href: "/admin/audit", label: "审计日志", icon: ScrollText, exact: false },
];

export default function AdminShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role: UserRole;
}) {
  const pathname = usePathname();

  return (
    <div className="container mx-auto flex flex-col gap-6 px-6 py-6 md:flex-row">
      <aside className="md:w-52 md:shrink-0">
        <div className="mb-4 flex items-center gap-2 px-3">
          <ShieldCheck size={18} className="text-primary" />
          <span className="text-foreground text-sm font-semibold">
            管理后台
          </span>
          {role === "SUPER_ADMIN" && (
            <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
              超管
            </span>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {navItems.map((item) => {
            const Icon = item.icon;
            // 仪表盘挂在 /admin 根路径，必须精确匹配，否则所有子页都会把它点亮
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition",
                  isActive
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
