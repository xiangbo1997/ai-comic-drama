"use client";

/**
 * 审计日志页
 *
 * 后台每一次写操作（改角色、封禁、增减积分、改配置、运维动作）都在这里留痕。
 * 用途是事后追责与回滚参考，所以 before/after 快照必须能完整看到——列表里
 * 只显示摘要，点开行才展开 JSON，避免整页被大段 JSON 撑成不可读的瀑布。
 *
 * 分页用游标（服务端 `nextCursor`），配「加载更多」而非页码：日志只增不减且
 * 按时间倒序看，跳页无意义，游标翻页的代价还恒定。
 *
 * 筛选走受控输入 + 显式「查询」按钮，不做输入即查：管理员常要连填三四个条件
 * 才是一次有意义的查询，边打字边发请求既浪费也会让结果闪烁。
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "../components/AdminPageHeader";

interface AuditLogItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  ip: string | null;
  createdAt: string;
  actorId: string;
  actorEmail: string | null;
}

interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: string | null;
}

/** 筛选条件的草稿态（点「查询」才提交给 query key） */
interface Filters {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  actorId: "",
  action: "",
  targetType: "",
  targetId: "",
  from: "",
  to: "",
};

/** 与 lib/admin-audit.ts 的 AuditTargetType 对齐 */
const TARGET_TYPES = [
  "user",
  "order",
  "credit",
  "system_config",
  "ai_provider",
  "ops",
] as const;

/** 把筛选条件拼成查询串；空值不下发，避免 `actorId=` 被当成有效过滤 */
function buildQuery(filters: Filters, cursor?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
  }
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

const inputClass =
  "border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 rounded-lg border px-3 py-1.5 text-sm transition focus:ring-2 focus:outline-none";

export default function AdminAuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  // 已提交的筛选条件——它才进 queryKey，草稿变化不触发请求
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useInfiniteQuery({
    queryKey: ["admin-audit-logs", applied],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      adminFetch<AuditLogPage>(
        `/api/admin/audit-logs?${buildQuery(applied, pageParam)}`
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const errorMessage =
    query.error instanceof Error ? query.error.message : null;

  const toggle = (id: string) => {
    // 不可变更新：直接 mutate Set 不会触发重渲染
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setField = (key: keyof Filters, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="审计日志"
        description="后台写操作留痕：操作者、动作、变更前后快照。只读，不可修改或删除。"
      />

      <section className="border-border flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">动作前缀</span>
          <input
            className={inputClass}
            placeholder="如 user. 或 ops.cleanup"
            value={draft.action}
            onChange={(e) => setField("action", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">对象类型</span>
          <select
            className={inputClass}
            value={draft.targetType}
            onChange={(e) => setField("targetType", e.target.value)}
          >
            <option value="">全部</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">对象 ID</span>
          <input
            className={inputClass}
            placeholder="targetId"
            value={draft.targetId}
            onChange={(e) => setField("targetId", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">操作者 ID</span>
          <input
            className={inputClass}
            placeholder="actorId"
            value={draft.actorId}
            onChange={(e) => setField("actorId", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">起始时间</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={draft.from}
            onChange={(e) => setField("from", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">结束时间</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={draft.to}
            onChange={(e) => setField("to", e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setApplied(draft)}>
            <Search />
            查询
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
            }}
          >
            <RotateCcw />
            重置
          </Button>
        </div>
      </section>

      <section className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-muted-foreground">
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                时间
              </th>
              <th className="px-4 py-3 text-left font-medium">操作者</th>
              <th className="px-4 py-3 text-left font-medium">动作</th>
              <th className="px-4 py-3 text-left font-medium">对象</th>
              <th className="px-4 py-3 text-left font-medium">备注</th>
              <th className="px-4 py-3 text-left font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-border border-t">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="bg-secondary h-4 w-full animate-pulse rounded" />
                  </td>
                </tr>
              ))}

            {!query.isLoading && errorMessage && (
              <tr className="border-border border-t">
                <td
                  colSpan={7}
                  className="text-destructive px-4 py-10 text-center"
                >
                  {errorMessage}
                </td>
              </tr>
            )}

            {!query.isLoading && !errorMessage && items.length === 0 && (
              <tr className="border-border border-t">
                <td
                  colSpan={7}
                  className="text-muted-foreground px-4 py-10 text-center"
                >
                  无匹配的审计记录
                </td>
              </tr>
            )}

            {!query.isLoading &&
              !errorMessage &&
              items.map((item) => {
                const isOpen = expanded.has(item.id);
                return (
                  <AuditRow
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggle(item.id)}
                  />
                );
              })}
          </tbody>
        </table>
      </section>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "加载中…" : "加载更多"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 单条日志：摘要行 + 可展开的 before/after 快照 */
function AuditRow({
  item,
  isOpen,
  onToggle,
}: {
  item: AuditLogItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const hasSnapshot = item.before !== null || item.after !== null;

  return (
    <>
      <tr
        className="border-border hover:bg-secondary/40 cursor-pointer border-t"
        onClick={onToggle}
      >
        <td className="px-2 py-3 align-middle">
          {hasSnapshot ? (
            isOpen ? (
              <ChevronDown size={14} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground" />
            )
          ) : null}
        </td>
        <td className="px-4 py-3 text-xs whitespace-nowrap">
          {new Date(item.createdAt).toLocaleString()}
        </td>
        <td className="px-4 py-3 text-xs">
          {item.actorEmail ?? (
            <span className="text-muted-foreground font-mono">
              {item.actorId.slice(0, 8)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 font-mono text-xs">{item.action}</td>
        <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
          {item.targetType}
          {item.targetId ? `/${item.targetId.slice(0, 8)}` : ""}
        </td>
        <td className="text-muted-foreground max-w-xs truncate px-4 py-3 text-xs">
          {item.note ?? "-"}
        </td>
        <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
          {item.ip ?? "-"}
        </td>
      </tr>

      {isOpen && hasSnapshot && (
        <tr className="border-border bg-secondary/20 border-t">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <SnapshotBlock label="变更前" value={item.before} />
              <SnapshotBlock label="变更后" value={item.after} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** 快照 JSON 块；无内容时显式说明，避免留一片空白让人以为没加载出来 */
function SnapshotBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium">{label}</p>
      {value === null || value === undefined ? (
        <p className="text-muted-foreground text-xs">无</p>
      ) : (
        <pre className="border-border bg-card max-h-64 overflow-auto rounded border p-2 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
