"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderOpen, Users, Coins, Settings, Cpu } from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { CreditsDisplay } from "@/components/credits-display";

const navItems = [
  { href: "/projects", label: "项目", icon: FolderOpen },
  { href: "/characters", label: "角色库", icon: Users },
  { href: "/credits", label: "积分", icon: Coins },
  { href: "/settings/ai-models", label: "模型配置", icon: Cpu },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-xl font-bold flex items-center gap-2">
              <span className="text-2xl">🎬</span>
              AI 漫剧
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                      isActive
                        ? "bg-gray-800 text-white"
                        : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <CreditsDisplay />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Mobile Nav */}
      <nav className="md:hidden border-b border-gray-800 px-4 py-2 flex justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition ${
                isActive ? "text-blue-500" : "text-gray-400"
              }`}
            >
              <Icon size={20} />
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Main Content */}
      <main>{children}</main>
    </div>
  );
}
