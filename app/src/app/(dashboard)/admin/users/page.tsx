"use client";

/**
 * 用户管理列表页
 *
 * 搜索（防抖）+ 角色 / 状态筛选 + 游标翻页。用 `useInfiniteQuery` 承接游标：
 * 「加载更多」是追加而非替换，管理员在长列表里往下翻时不会丢失已看过的行。
 *
 * 筛选条件进 queryKey，改条件即换缓存条目，不需要手动 reset 分页状态。
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "../components/AdminPageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { CreditsValue, RoleBadge, StatusBadge } from "./UserBadges";
import {
  formatDateTime,
  type AdminUserListItem,
  type AdminUserListResponse,
} from "./types";

/** 单页条数：与服务端 MAX_PAGE_SIZE(100) 一致的量级，一屏够翻 */
const PAGE_SIZE = 30;

/** 搜索防抖：输入停顿 300ms 才发请求，避免逐字符打全表扫描 */
const SEARCH_DEBOUNCE_MS = 300;

const ROLE_OPTIONS = [
  { value: "all", label: "全部角色" },
  { value: "USER", label: "普通用户" },
  { value: "ADMIN", label: "管理员" },
  { value: "SUPER_ADMIN", label: "超级管理员" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "ACTIVE", label: "正常" },
  { value: "BANNED", label: "已封禁" },
];

const SORT_OPTIONS = [
  { value: "createdAt", label: "按注册时间" },
  { value: "credits", label: "按积分" },
  { value: "lastLoginAt", label: "按最近登录" },
];

const SELECT_CLASS =
  "border-border bg-input text-foreground focus:border-primary focus:ring-primary/40 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none";

export default function AdminUsersPage() {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("createdAt");

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ["admin-users", debouncedSearch, role, status, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        sort,
      });
      if (pageParam) params.set("cursor", pageParam);
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (role !== "all") params.set("role", role);
      if (status !== "all") params.set("status", status);
      return adminFetch<AdminUserListResponse>(
        `/api/admin/users?${params.toString()}`
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: DataTableColumn<AdminUserListItem>[] = [
    {
      key: "user",
      header: "用户",
      render: (row) => (
        <div className="min-w-0">
          <div className="text-foreground truncate font-medium">
            {row.name || "未设置昵称"}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {row.email}
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "角色",
      render: (row) => <RoleBadge role={row.role} />,
    },
    {
      key: "status",
      header: "状态",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "credits",
      header: "积分",
      className: "text-right",
      render: (row) => <CreditsValue value={row.credits} />,
    },
    {
      key: "projects",
      header: "项目数",
      className: "text-right",
      render: (row) => <span className="tabular-nums">{row.projectCount}</span>,
    },
    {
      key: "lastLoginAt",
      header: "最近登录",
      render: (row) => (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {formatDateTime(row.lastLoginAt)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "注册时间",
      render: (row) => (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="用户管理"
        description="查看用户、调整角色、封禁 / 解封、增减积分。点击任意行进入详情。"
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索邮箱 / 昵称 / 用户 ID"
            className="border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={SELECT_CLASS}
          aria-label="按角色筛选"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={SELECT_CLASS}
          aria-label="按状态筛选"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={SELECT_CLASS}
          aria-label="排序方式"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={
          query.error
            ? query.error instanceof Error
              ? query.error.message
              : "加载失败"
            : null
        }
        emptyText={
          debouncedSearch || role !== "all" || status !== "all"
            ? "没有符合条件的用户"
            : "暂无用户"
        }
        onRowClick={(row) => router.push(`/admin/users/${row.id}`)}
      />

      <div className="mt-4 flex items-center justify-center gap-3">
        {query.hasNextPage && (
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
            加载更多
          </Button>
        )}
        {!query.isLoading && rows.length > 0 && (
          <span className="text-muted-foreground text-xs">
            已加载 {rows.length} 条{query.hasNextPage ? "" : "（全部）"}
          </span>
        )}
      </div>
    </div>
  );
}
