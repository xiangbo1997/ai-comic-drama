"use client";

/**
 * 后台仪表盘
 *
 * 回答四个问题：有多少人在用、积分池什么水位、这个月收了多少钱、生成管线
 * 现在健不健康。数据源是 `/api/admin/dashboard`（单次聚合），30 秒轮询。
 *
 * 刻意**不做**趋势线与同比分析——那是 Langfuse / BI 的活。这里只承担
 * 「值班时扫一眼判断要不要介入」的职责，所以异常指标（失败、僵尸、封禁）
 * 一律着色前置，正常数字保持低对比度。
 *
 * 每日积分图的数据来自订单模块的独立端点，取数失败静默降级（见 CreditsChart）。
 */

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";
import {
  formatPercent,
  overallSuccessRate,
  type DailyCreditPoint,
  type GenerationTypeStat,
} from "@/lib/admin-dashboard";

import { AdminPageHeader } from "./components/AdminPageHeader";
import { CreditsChart } from "./components/CreditsChart";
import { DataTable, type DataTableColumn } from "./components/DataTable";
import { StatCard } from "./components/StatCard";

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

interface RecentFailure {
  id: string;
  type: string;
  error: string | null;
  projectId: string | null;
  sceneId: string | null;
  updatedAt: string;
}

interface DashboardResponse {
  users: { total: number; new7d: number; active7d: number; banned: number };
  credits: { totalBalance: number; granted7d: number; charged7d: number };
  revenue: { paidOrders30d: number; paidAmount30d: number };
  generation: { last7d: GenerationTypeStat[]; processingNow: number };
  workflows: { running: number; failed7d: number };
  recentWorkflows: RecentWorkflow[];
  recentFailures: RecentFailure[];
  generatedAt: string;
}

/** 任务/工作流状态的语义着色（成功绿、失败红、其余次要色） */
function statusClass(status: string): string {
  if (status === "COMPLETED") return "text-green-600";
  if (status === "FAILED") return "text-destructive";
  return "text-muted-foreground";
}

/** 成功率着色：低于 80% 标红，低于 95% 标黄 */
function rateClass(rate: number): string {
  if (rate < 0.8) return "text-destructive";
  if (rate < 0.95) return "text-amber-600";
  return "text-green-600";
}

const generationColumns: DataTableColumn<GenerationTypeStat>[] = [
  { key: "type", header: "类型", render: (s) => s.type },
  {
    key: "total",
    header: "总数",
    className: "text-right tabular-nums",
    render: (s) => s.total,
  },
  {
    key: "success",
    header: "成功",
    className: "text-right tabular-nums text-green-600",
    render: (s) => s.success,
  },
  {
    key: "failed",
    header: "失败",
    className: "text-right tabular-nums",
    render: (s) => (
      <span className={s.failed > 0 ? "text-destructive" : undefined}>
        {s.failed}
      </span>
    ),
  },
  {
    key: "rate",
    header: "成功率",
    className: "text-right tabular-nums",
    render: (s) => (
      <span className={rateClass(s.successRate)}>
        {formatPercent(s.successRate)}
      </span>
    ),
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

const failureColumns: DataTableColumn<RecentFailure>[] = [
  {
    key: "type",
    header: "类型",
    className: "whitespace-nowrap",
    render: (f) => f.type,
  },
  {
    key: "error",
    header: "错误",
    // 服务端已截到 200 字符；这里再限宽避免单行撑爆表格
    className: "text-destructive max-w-md truncate text-xs",
    render: (f) => f.error ?? "-",
  },
  {
    key: "scene",
    header: "分镜",
    className: "font-mono text-xs",
    render: (f) => f.sceneId?.slice(0, 8) ?? "-",
  },
  {
    key: "updatedAt",
    header: "时间",
    className: "text-xs whitespace-nowrap",
    render: (f) => new Date(f.updatedAt).toLocaleString(),
  },
];

export default function AdminDashboardPage() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => adminFetch<DashboardResponse>("/api/admin/dashboard"),
    refetchInterval: 30_000, // 30s 轮询
  });

  // 积分日曲线由订单模块提供，独立查询：它挂了不该影响主指标渲染，
  // 故 retry 关掉（端点可能还没上线，重试只是徒增噪音）
  const creditsQuery = useQuery({
    queryKey: ["admin-credit-summary", 30],
    queryFn: () =>
      adminFetch<DailyCreditPoint[]>(
        "/api/admin/credit-transactions/summary?days=30"
      ),
    refetchInterval: 60_000,
    retry: false,
  });

  const errorMessage =
    error instanceof Error ? error.message : error ? "加载失败" : null;

  const stats = data?.generation.last7d ?? [];
  const overallRate = overallSuccessRate(stats);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="仪表盘"
        description={`平台总览与近 7 天生成健康度${
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

      {errorMessage && (
        <p className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm">
          {errorMessage}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="用户总数"
          value={data?.users.total.toLocaleString() ?? "-"}
          hint={
            data
              ? `7 日新增 ${data.users.new7d}　活跃 ${data.users.active7d}　封禁 ${data.users.banned}`
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          label="积分池余额"
          value={data?.credits.totalBalance.toLocaleString() ?? "-"}
          hint={
            data
              ? `7 日发放 ${data.credits.granted7d.toLocaleString()}　消耗 ${data.credits.charged7d.toLocaleString()}`
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          label="30 日收入"
          value={data ? `¥${data.revenue.paidAmount30d.toFixed(2)}` : "-"}
          hint={data ? `${data.revenue.paidOrders30d} 笔已支付订单` : undefined}
          isLoading={isLoading}
        />
        <StatCard
          label="7 日生成成功率"
          value={data ? formatPercent(overallRate) : "-"}
          hint={
            data
              ? `在途 ${data.generation.processingNow}　运行中 workflow ${data.workflows.running}　7 日失败 ${data.workflows.failed7d}`
              : undefined
          }
          valueClassName={data ? rateClass(overallRate) : undefined}
          isLoading={isLoading}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">近 30 天积分收支</h2>
        <CreditsChart
          points={creditsQuery.data ?? []}
          isLoading={creditsQuery.isLoading}
          error={
            creditsQuery.error ? "积分流水暂不可用（该模块可能尚未就绪）" : null
          }
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">近 7 天生成统计</h2>
        <DataTable
          columns={generationColumns}
          rows={stats}
          rowKey={(s) => s.type}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="近 7 天无生成任务"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">最近失败</h2>
        <DataTable
          columns={failureColumns}
          rows={data?.recentFailures ?? []}
          rowKey={(f) => f.id}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="近 7 天无失败任务"
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
