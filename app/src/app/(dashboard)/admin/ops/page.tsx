"use client";

/**
 * 运维页
 *
 * 值班视角的三件事：服务活着吗（健康 / 存储 / Redis / 磁盘 / 备份）、有没有
 * 卡死的任务（僵尸列表）、能不能一键收拾（立即清理）。
 *
 * 两个回收入口的分工：「立即清理」是批量的，同时还做过期订单、老数据删除与
 * 候选裁剪，走的是 cron 那套完整逻辑；单行的「标记失败」只动一条任务，用于
 * 管理员已确认某条死了、但不想触发全量清理的场景。
 *
 * 清理是有破坏性的（删行、改状态），故必须过 ConfirmDialog；执行结果以
 * 汇总数字回显，让管理员知道「到底清掉了什么」而不是只看到一个 toast。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";
import { formatBytes, formatUptime } from "@/lib/admin-dashboard";

import { AdminPageHeader } from "../components/AdminPageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { StatCard } from "../components/StatCard";

interface ZombieTask {
  id: string;
  type: string;
  sceneId: string | null;
  projectId: string | null;
  updatedAt: string;
}

interface ZombieWorkflow {
  id: string;
  projectId: string;
  currentStep: string | null;
  updatedAt: string;
}

interface BackupFile {
  name: string;
  size: number;
  mtime: string;
}

interface OpsStatus {
  health: { ok: boolean; uptime: number; commit: string | null };
  storage: {
    r2Configured: boolean;
    localUploadsBytes: number | null;
    localUploadsFiles: number | null;
    localUploadsTruncated: boolean;
  };
  redisConfigured: boolean;
  zombies: {
    thresholdMinutes: number;
    tasks: ZombieTask[];
    workflows: ZombieWorkflow[];
  };
  backups: { dir: string; files: BackupFile[] | null };
  disk: { free: number; total: number } | null;
  generatedAt: string;
}

interface CleanupSummary {
  ok: boolean;
  deletedTasks: number;
  deletedWorkflows: number;
  expiredOrders: number;
  recycledZombieTasks: number;
  recycledZombieWorkflows: number;
  prunedAttempts: number;
  prunedAttemptFiles: number;
}

const backupColumns: DataTableColumn<BackupFile>[] = [
  {
    key: "name",
    header: "文件",
    className: "font-mono text-xs",
    render: (b) => b.name,
  },
  {
    key: "size",
    header: "大小",
    className: "text-right tabular-nums whitespace-nowrap",
    render: (b) => formatBytes(b.size),
  },
  {
    key: "mtime",
    header: "生成时间",
    className: "text-xs whitespace-nowrap",
    render: (b) => new Date(b.mtime).toLocaleString(),
  },
];

/** 距今多久（僵尸列表用；这些任务都是 15 分钟以上没动静的） */
function staleFor(updatedAt: string): string {
  const minutes = Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / 60000
  );
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

export default function AdminOpsPage() {
  const queryClient = useQueryClient();
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<CleanupSummary | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-ops-status"],
    queryFn: () => adminFetch<OpsStatus>("/api/admin/ops/status"),
    refetchInterval: 30_000,
  });

  const errorMessage =
    error instanceof Error ? error.message : error ? "加载失败" : null;

  const cleanupMutation = useMutation({
    mutationFn: () =>
      adminFetch<CleanupSummary>("/api/admin/ops/cleanup", { method: "POST" }),
    onSuccess: (summary) => {
      setLastCleanup(summary);
      void queryClient.invalidateQueries({ queryKey: ["admin-ops-status"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
  });

  const failTaskMutation = useMutation({
    mutationFn: (taskId: string) =>
      adminFetch<{ ok: boolean }>(`/api/admin/ops/zombies/${taskId}/fail`, {
        method: "POST",
      }),
    onSuccess: () => {
      setRowError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-ops-status"] });
    },
    onError: (err) => {
      setRowError(err instanceof Error ? err.message : "标记失败失败");
    },
  });

  const taskColumns: DataTableColumn<ZombieTask>[] = [
    {
      key: "id",
      header: "任务 ID",
      className: "font-mono text-xs",
      render: (t) => t.id.slice(0, 10),
    },
    {
      key: "type",
      header: "类型",
      className: "whitespace-nowrap",
      render: (t) => t.type,
    },
    {
      key: "scene",
      header: "分镜",
      className: "font-mono text-xs",
      render: (t) => t.sceneId?.slice(0, 8) ?? "-",
    },
    {
      key: "stale",
      header: "停滞",
      className: "text-destructive whitespace-nowrap tabular-nums",
      render: (t) => staleFor(t.updatedAt),
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (t) => (
        <Button
          variant="outline"
          size="sm"
          disabled={failTaskMutation.isPending}
          onClick={() => failTaskMutation.mutate(t.id)}
        >
          {failTaskMutation.isPending &&
            failTaskMutation.variables === t.id && (
              <Loader2 className="animate-spin" />
            )}
          标记失败
        </Button>
      ),
    },
  ];

  const workflowColumns: DataTableColumn<ZombieWorkflow>[] = [
    {
      key: "id",
      header: "Workflow ID",
      className: "font-mono text-xs",
      render: (w) => w.id.slice(0, 10),
    },
    {
      key: "project",
      header: "项目",
      className: "font-mono text-xs",
      render: (w) => w.projectId.slice(0, 8),
    },
    {
      key: "step",
      header: "卡在步骤",
      className: "text-xs",
      render: (w) => w.currentStep ?? "-",
    },
    {
      key: "stale",
      header: "停滞",
      className: "text-destructive whitespace-nowrap tabular-nums",
      render: (w) => staleFor(w.updatedAt),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="运维"
        description={`服务状态、僵尸任务与数据清理${
          data?.generatedAt
            ? `　·　更新于 ${new Date(data.generatedAt).toLocaleString()}`
            : ""
        }`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : undefined} />
              刷新
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCleanupOpen(true)}
              disabled={cleanupMutation.isPending}
            >
              {cleanupMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              立即清理
            </Button>
          </div>
        }
      />

      {errorMessage && (
        <p className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm">
          {errorMessage}
        </p>
      )}

      {lastCleanup && (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-sm">
          <p className="mb-1 font-medium text-green-700 dark:text-green-500">
            清理完成
          </p>
          <p className="text-muted-foreground text-xs">
            删除终结任务 {lastCleanup.deletedTasks} 条　删除 workflow{" "}
            {lastCleanup.deletedWorkflows} 条　过期订单{" "}
            {lastCleanup.expiredOrders} 笔　回收僵尸任务{" "}
            {lastCleanup.recycledZombieTasks} 条　回收僵尸 workflow{" "}
            {lastCleanup.recycledZombieWorkflows} 条　裁剪候选{" "}
            {lastCleanup.prunedAttempts} 条（清理文件{" "}
            {lastCleanup.prunedAttemptFiles} 个）
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="服务健康"
          value={data ? (data.health.ok ? "正常" : "异常") : "-"}
          valueClassName={
            data && !data.health.ok ? "text-destructive" : "text-green-600"
          }
          hint={
            data
              ? `运行 ${formatUptime(data.health.uptime)}　commit ${
                  data.health.commit?.slice(0, 7) ?? "未知"
                }`
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          label="对象存储"
          value={data ? (data.storage.r2Configured ? "R2" : "本地盘") : "-"}
          valueClassName={
            data && !data.storage.r2Configured ? "text-amber-600" : undefined
          }
          hint={
            data
              ? data.storage.r2Configured
                ? "已接入 Cloudflare R2"
                : `本地 ${formatBytes(data.storage.localUploadsBytes)}${
                    data.storage.localUploadsFiles !== null
                      ? ` / ${data.storage.localUploadsFiles} 个文件`
                      : ""
                  }${data.storage.localUploadsTruncated ? "（统计已截断）" : ""}`
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          label="Redis"
          value={data ? (data.redisConfigured ? "已配置" : "内存降级") : "-"}
          valueClassName={
            data && !data.redisConfigured ? "text-amber-600" : undefined
          }
          hint={
            data && !data.redisConfigured
              ? "限流走进程内存，多实例不同步"
              : "限流与缓存走 Redis"
          }
          isLoading={isLoading}
        />
        <StatCard
          label="磁盘可用"
          value={data?.disk ? formatBytes(data.disk.free) : "-"}
          hint={
            data?.disk
              ? `共 ${formatBytes(data.disk.total)}　已用 ${formatBytes(
                  data.disk.total - data.disk.free
                )}`
              : "当前环境不支持 statfs"
          }
          isLoading={isLoading}
        />
      </section>

      {rowError && (
        <p className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm">
          {rowError}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">
          僵尸任务
          {data && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              超过 {data.zombies.thresholdMinutes} 分钟无更新仍在处理中
            </span>
          )}
        </h2>
        <DataTable
          columns={taskColumns}
          rows={data?.zombies.tasks ?? []}
          rowKey={(t) => t.id}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="无僵尸任务"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">僵尸 Workflow</h2>
        <DataTable
          columns={workflowColumns}
          rows={data?.zombies.workflows ?? []}
          rowKey={(w) => w.id}
          isLoading={isLoading}
          error={errorMessage}
          emptyText="无僵尸 workflow"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">
          备份
          {data && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {data.backups.dir}
            </span>
          )}
        </h2>
        {data && data.backups.files === null ? (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-8 text-center text-sm">
            本机无备份目录（{data.backups.dir}），通常只在生产服务器上存在
          </p>
        ) : (
          <DataTable
            columns={backupColumns}
            rows={data?.backups.files ?? []}
            rowKey={(b) => b.name}
            isLoading={isLoading}
            error={errorMessage}
            emptyText="备份目录为空"
          />
        )}
      </section>

      <ConfirmDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        title="立即执行数据清理"
        description="将删除 30 天前已终结的任务与 workflow、把超 24 小时未支付的订单置为已过期、回收超过 15 分钟无更新的僵尸任务与 workflow，并裁剪多余的生成候选（含其文件）。此操作不可撤销。"
        confirmText="执行清理"
        confirmVariant="destructive"
        onConfirm={async () => {
          await cleanupMutation.mutateAsync();
        }}
      />
    </div>
  );
}
