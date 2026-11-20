"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Clapperboard, Flame, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/short-videos", label: "作品", icon: Clapperboard },
  { href: "/short-videos/trends", label: "热点与导入", icon: Flame },
  {
    href: "/short-videos/publications",
    label: "发布中心",
    icon: CalendarClock,
  },
  { href: "/short-videos/accounts", label: "发布账号", icon: Users },
];

export function ShortVideoNavigation() {
  const pathname = usePathname();
  const activeHref =
    items.find(
      (item) => item.href !== "/short-videos" && pathname.startsWith(item.href)
    )?.href ?? "/short-videos";

  return (
    <nav
      aria-label="短视频导航"
      className="bg-muted/40 border-border grid grid-cols-4 gap-1 rounded-xl border p-1"
    >
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={activeHref === href ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/50 flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition outline-none focus-visible:ring-2 sm:min-h-11 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
            activeHref === href
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-center">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
