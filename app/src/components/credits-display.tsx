"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import Link from "next/link";

async function fetchCredits() {
  const res = await fetch("/api/user/credits");
  if (!res.ok) throw new Error("Failed to fetch credits");
  return res.json();
}

export function CreditsDisplay() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["credits"],
    queryFn: fetchCredits,
    refetchInterval: 30000, // 每30秒刷新一次
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5">
        <Coins size={16} className="text-yellow-500" />
        <span className="text-sm text-gray-400">--</span>
      </div>
    );
  }

  if (error) {
    return null;
  }

  return (
    <Link
      href="/credits"
      className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 transition hover:bg-gray-700"
    >
      <Coins size={16} className="text-yellow-500" />
      <span className="text-sm font-medium">{data?.credits ?? 0}</span>
    </Link>
  );
}
