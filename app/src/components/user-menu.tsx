"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { LogOut, User, CreditCard, Settings, ShieldCheck } from "lucide-react";

export function UserMenu() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (status === "loading") {
    return <div className="bg-secondary h-8 w-8 animate-pulse rounded-full" />;
  }

  const role = session?.user?.role;
  const isAdminRole = role === "ADMIN" || role === "SUPER_ADMIN";

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="bg-primary hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition"
      >
        登录
      </Link>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 transition hover:opacity-80"
        aria-label="用户菜单"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || "用户"}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium">
            {session.user.name?.[0] || session.user.email?.[0] || "U"}
          </div>
        )}
      </button>

      {isOpen && (
        <div className="border-border bg-card absolute right-0 z-50 mt-2 w-56 rounded-lg border py-1 shadow-xl">
          {/* User Info */}
          <div className="border-border border-b px-4 py-3">
            <p className="text-foreground truncate text-sm font-medium">
              {session.user.name || "用户"}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {session.user.email}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <Link
              href="/profile"
              className="text-foreground hover:bg-secondary flex items-center gap-3 px-4 py-2 text-sm transition"
              onClick={() => setIsOpen(false)}
            >
              <User size={16} />
              个人中心
            </Link>
            <Link
              href="/credits"
              className="text-foreground hover:bg-secondary flex items-center gap-3 px-4 py-2 text-sm transition"
              onClick={() => setIsOpen(false)}
            >
              <CreditCard size={16} />
              积分充值
            </Link>
            <Link
              href="/settings"
              className="text-foreground hover:bg-secondary flex items-center gap-3 px-4 py-2 text-sm transition"
              onClick={() => setIsOpen(false)}
            >
              <Settings size={16} />
              设置
            </Link>
            {/* 后台入口只对管理员显示。这只是**入口显隐**，不是权限判据——
                真正的闸门在 (dashboard)/admin/layout.tsx 与各 admin API。 */}
            {isAdminRole && (
              <Link
                href="/admin"
                className="text-foreground hover:bg-secondary flex items-center gap-3 px-4 py-2 text-sm transition"
                onClick={() => setIsOpen(false)}
              >
                <ShieldCheck size={16} />
                后台管理
              </Link>
            )}
          </div>

          {/* Logout */}
          <div className="border-border border-t py-1">
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="hover:bg-secondary flex w-full items-center gap-3 px-4 py-2 text-sm text-red-400 transition"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
