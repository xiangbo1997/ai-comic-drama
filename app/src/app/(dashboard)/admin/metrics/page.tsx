/**
 * Admin Metrics 页面（Stage 3.6）
 *
 * 路径：/admin/metrics
 * 仅管理员（`ADMIN_EMAILS`）可见；非管理员由 API 返回 404 → 此页展示"无权限"。
 *
 * 特意保持**极简**：
 * - 不用 shadcn 的复杂 Card，直接 Tailwind 原生
 * - 轮询 30s 刷新，避免 WebSocket 复杂度
 * - 不做可视化图表（等 Stage 3 后续再加 recharts）
 */

"use client";

import { useQuery } from "@tanstack/react-query";

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

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
  queues: QueueStats[];
  recentWorkflows: RecentWorkflow[];
  taskStats: TaskStat[];
  generatedAt: string;
}

async function fetchMetrics(): Promise<MetricsResponse> {
  const res = await fetch("/api/admin/metrics");
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("无权限或页面不存在");
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export default function AdminMetricsPage() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 30_000, // 30s 轮询
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-6 text-sm">加载中...</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">系统监控</h1>
        <div className="text-muted-foreground text-xs">
          更新于{" "}
          {data?.generatedAt
            ? new Date(data.generatedAt).toLocaleString()
            : "-"}
          <button
            onClick={() => refetch()}
            className="hover:bg-accent ml-3 rounded border px-2 py-0.5"
          >
            刷新
          </button>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-medium">任务队列</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data?.queues.map((q) => (
            <div key={q.name} className="bg-card rounded-lg border p-4">
              <div className="mb-2 text-sm font-medium capitalize">
                {q.name} 队列
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">等待</dt>
                <dd className="text-right tabular-nums">{q.waiting}</dd>
                <dt className="text-muted-foreground">运行中</dt>
                <dd className="text-right tabular-nums">{q.active}</dd>
                <dt className="text-muted-foreground">完成</dt>
                <dd className="text-right tabular-nums">{q.completed}</dd>
                <dt className="text-muted-foreground text-destructive">失败</dt>
                <dd className="text-destructive text-right tabular-nums">
                  {q.failed}
                </dd>
                <dt className="text-muted-foreground">延迟</dt>
                <dd className="text-right tabular-nums">{q.delayed}</dd>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">近 7 天生成统计</h2>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">类型</th>
                <th className="px-3 py-2 text-left font-medium">状态</th>
                <th className="px-3 py-2 text-right font-medium">数量</th>
                <th className="px-3 py-2 text-right font-medium">总积分</th>
              </tr>
            </thead>
            <tbody>
              {(data?.taskStats ?? []).map((t, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">{t.type}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        t.status === "COMPLETED"
                          ? "text-green-600"
                          : t.status === "FAILED"
                            ? "text-destructive"
                            : ""
                      }
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t._count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t._sum.cost ?? 0}
                  </td>
                </tr>
              ))}
              {(data?.taskStats.length ?? 0) === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="text-muted-foreground px-3 py-8 text-center"
                  >
                    近 7 天无生成任务
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">最近 Workflow</h2>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">状态</th>
                <th className="px-3 py-2 text-left font-medium">当前步骤</th>
                <th className="px-3 py-2 text-left font-medium">耗时</th>
                <th className="px-3 py-2 text-left font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentWorkflows ?? []).map((w) => {
                const duration =
                  w.startedAt && w.completedAt
                    ? Math.round(
                        (new Date(w.completedAt).getTime() -
                          new Date(w.startedAt).getTime()) /
                          1000
                      )
                    : null;
                return (
                  <tr key={w.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">
                      {w.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          w.status === "COMPLETED"
                            ? "text-green-600"
                            : w.status === "FAILED"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {w.currentStep ?? "-"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {duration !== null ? `${duration}s` : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(w.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {(data?.recentWorkflows.length ?? 0) === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="text-muted-foreground px-3 py-8 text-center"
                  >
                    暂无 workflow 记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-muted-foreground text-xs">
        <p>更多指标（token/成本/P95 延迟）请前往 Langfuse 面板查看。</p>
      </footer>
    </div>
  );
}
