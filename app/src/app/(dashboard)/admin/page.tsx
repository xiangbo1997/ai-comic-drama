/**
 * 后台仪表盘（原 /admin/metrics 的内容，随后台改版迁到 /admin 根路径）
 *
 * 数据源仍是 GET /api/admin/metrics（未改动）：近 7 天生成统计 + 最近
 * workflow。30 秒轮询刷新，不做图表——趋势分析交给 Langfuse，这里只回答
 * 「现在有没有在大面积失败」。
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "./components/AdminPageHeader";
import { DataTable, type DataTableColumn } from "./components/DataTable";

interface RecentWorkflow {
  id: string;
  projectId: string;
  status: string;
  currentStep: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface TaskStat {
  type: string;
  status: string;
  _count: number;
  _sum: { cost: number | null };
}

interface MetricsResponse {
  recentWorkflows: RecentWorkflow[];
  taskStats: TaskStat[];
  generatedAt: string;
}

/** 任务/工作流状态的语义着色（成功绿、失败红、其余次要色） */
function statusClass(status: string): string {
  if (status === "COMPLETED") return "text-green-600";
  if (status === "FAILED") return "text-destructive";
  return "text-muted-foreground";
}

const taskColumns: DataTableColumn<TaskStat>[] = [
  { key: "type", header: "类型", render: (t) => t.type },
  {
    key: "status",
    header: "状态",
    render: (t) => <span className={statusClass(t.status)}>{t.status}</span>,
  },
  {
    key: "count",
    header: "数量",
    className: "text-right tabular-nums",
    render: (t) => t._count,
  },
  {
    key: "cost",
    header: "总积分",
    className: "text-right tabular-nums",
    render: (t) => t._sum.cost ?? 0,
  },
];

const workflowColumns: DataTableColumn<RecentWorkflow>[] = [
  {
    key: "id",
    header: "ID",
    className: "font-mono text-xs",
    render: (w) => w.id.slice(0, 8),
  },
  {
    key: "status",
    header: "状态",
    render: (w) => <span className={statusClass(w.status)}>{w.status}</span>,
  },
  {
    key: "step",
    header: "当前步骤",
    className: "text-xs",
    render: (w) => w.currentStep ?? "-",
  },
  {
    key: "duration",
    header: "耗时",
    className: "tabular-nums",
    render: (w) => {
      if (!w.startedAt || !w.completedAt) return "-";
      const seconds = Math.round(
        (new Date(w.completedAt).getTime() - new Date(w.startedAt).getTime()) /
          1000
      );
      return `${seconds}s`;
    },
  },
  {
    key: "createdAt",
    header: "创建时间",
    className: "text-xs",
    render: (w) => new Date(w.createdAt).toLocaleString(),
  },
];

export default function AdminDashboardPage() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: () => adminFetch<MetricsResponse>("/api/admin/metrics"),
    refetchInterval: 30_000, // 30s 轮询
  });

  const errorMessage =
    error instanceof Error ? error.message : error ? "加载失败" : null;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="仪表盘"
        description={`近 7 天生成统计与最近 workflow${
          data?.generatedAt
            ? `　·　更新于 ${new Date(data.generatedAt).toLocaleString()}`
            : ""
        }`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            刷新
          </Button>
        }
      />

      {/* 原「任务队列」区块已随 BullMQ 死代码移除：生产从未走队列，
          计数恒为 0 只会让管理员误判系统空闲 */}
      <section>
        <h2 className="mb-3 text-lg font-medium">近 7 天生成统计</h2>
        <DataTable
          columns={taskColumns}
          rows={data?.taskStats ?? []}
          rowKey={(t) => `${t.type}-${t.status}`}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="近 7 天无生成任务"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">最近 Workflow</h2>
        <DataTable
          columns={workflowColumns}
          rows={data?.recentWorkflows ?? []}
          rowKey={(w) => w.id}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="暂无 workflow 记录"
        />
      </section>

      <p className="text-muted-foreground text-xs">
        更多指标（token / 成本 / P95 延迟）请前往 Langfuse 面板查看。
      </p>
    </div>
  );
}
