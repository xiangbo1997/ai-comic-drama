"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Square, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/ai-models/model-selector";
import type {
  AssistantExecutionOptions,
  AssistantExecutionSnapshot,
} from "@/lib/assistant-execution";
import type { AssistantTarget } from "./use-project-assistant";
import { useAssistantExecution } from "./use-assistant-execution";

interface ModelConfig {
  id: string;
  isDefault: boolean;
  testStatus: string | null;
  provider: { category: string };
}
interface Episode {
  id: string;
  title: string;
  episodeNumber: number | null;
}
export function AssistantExecutionPanel({
  target,
  title,
  llmConfigId,
}: {
  target: AssistantTarget;
  title: string;
  llmConfigId?: string;
}) {
  const [episodeId, setEpisodeId] = useState("");
  const series = useQuery({
    queryKey: ["assistant-series-episodes", target.seriesId],
    enabled: !!target.seriesId,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/series/${target.seriesId}`, {
        signal,
      });
      if (!response.ok) throw new Error("无法加载各集，请重试");
      return response.json() as Promise<{ projects: Episode[] }>;
    },
    retry: false,
  });
  const projectId = target.projectId ?? episodeId;
  const episode = series.data?.projects.find((item) => item.id === episodeId);
  return (
    <section
      className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
      aria-label="自动制作"
    >
      {target.seriesId && (
        <div className="space-y-2">
          <label
            htmlFor="assistant-execution-episode"
            className="block text-sm font-medium"
          >
            选择要制作的一集
          </label>
          {series.isPending ? (
            <p className="text-muted-foreground text-sm">正在读取各集…</p>
          ) : series.error ? (
            <div role="alert" className="text-destructive text-sm">
              无法加载各集。
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void series.refetch()}
              >
                重试
              </Button>
            </div>
          ) : series.data?.projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              先新建一集，再让助手执行制作。
            </p>
          ) : (
            <select
              id="assistant-execution-episode"
              value={episodeId}
              onChange={(event) => setEpisodeId(event.target.value)}
              className="border-border bg-background w-full rounded-lg border p-2 text-sm"
            >
              <option value="">请选择一集</option>
              {series.data?.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.episodeNumber != null
                    ? `第${item.episodeNumber}集 · `
                    : ""}
                  {item.title}
                </option>
              ))}
            </select>
          )}
          <p className="text-muted-foreground text-xs">
            仅制作选中的一集；同剧其他集不受本次计划影响。
          </p>
        </div>
      )}
      {projectId && (
        <ProjectExecution
          key={projectId}
          projectId={projectId}
          title={episode?.title || title}
          llmConfigId={llmConfigId}
        />
      )}
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  planned: "待确认计划",
  running: "后台制作中",
  stopping: "正在停止后续步骤",
  paused: "制作已暂停",
  completed: "制作已完成",
  stopped: "已停止后续步骤",
  failed: "制作未完成",
};
const STEP_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  skipped: "已跳过",
  failed: "未完成",
  unknown: "结果待核对",
};

function ProjectExecution({
  projectId,
  title,
  llmConfigId,
}: {
  projectId: string;
  title: string;
  llmConfigId?: string;
}) {
  const state = useAssistantExecution(projectId);
  const [newPlan, setNewPlan] = useState(false);
  const execution = state.execution;
  const active =
    execution && ["running", "stopping"].includes(execution.status);
  const hasUnknown = execution?.steps.some((step) => step.status === "unknown");
  const hasRunning = execution?.steps.some((step) => step.status === "running");
  const hasFailed = execution?.steps.some((step) => step.status === "failed");
  // 需要人工注意不代表结果未知；继续与重新计划分别遵循服务端允许的状态。
  const mayResume =
    execution &&
    execution.status === "paused" &&
    !execution.resumeBlocked &&
    !hasUnknown &&
    !hasRunning &&
    !hasFailed;
  const mayReplan = execution && !active && !hasUnknown && !hasRunning;
  const showSettings =
    !execution || execution.status === "planned" || (newPlan && mayReplan);
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-base font-semibold">当前集自动制作</h3>
        <p className="text-sm break-words">{title}</p>
        <p className="text-muted-foreground text-sm">
          先查看可执行计划，再一次确认。确认后由后台制作，关闭页面也会继续；重新打开可查看进度和结果。
        </p>
        <p className="text-muted-foreground text-xs">
          此流程用于场景参考、图片、连续性检查和可选视频，不含配乐、配音或成片导出。只需背景音乐时，请在「对话」中要求添加免费曲库配乐。
        </p>
      </div>
      {state.loading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" />
          正在恢复本集任务…
        </p>
      )}
      {state.pollError && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm"
        >
          暂时无法读取任务进度，后台状态尚未确认；请刷新查看，不要重复开始。
          <Button
            variant="outline"
            size="sm"
            onClick={state.refresh}
            className="mt-2"
          >
            刷新任务
          </Button>
        </div>
      )}
      {state.error && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm"
        >
          {state.error}
          {state.conflict &&
            " 当前素材或计划已变化，请重新查看执行计划后再确认。"}
        </p>
      )}
      {!state.loading && !state.pollError && showSettings && (
        <ExecutionSettings
          key={execution?.id ?? projectId}
          execution={execution?.status === "planned" ? execution : null}
          llmConfigId={llmConfigId}
          pending={state.pending}
          conflict={state.conflict}
          onPlan={async (options) => {
            if (await state.createPlan(options)) setNewPlan(false);
          }}
          onConfirm={state.confirm}
        />
      )}
      {execution && execution.status !== "planned" && (
        <div className="border-border space-y-4 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold" role="status">
              {STATUS_LABELS[execution.status] || execution.status}
            </h4>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新任务"
              disabled={state.pending}
              onClick={state.refresh}
            >
              <RefreshCw size={15} />
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">已用积分 / 上限</dt>
            <dd>
              {execution.budget.spent} / {execution.budget.limit}
            </dd>
            <dt className="text-muted-foreground">处理中预留积分</dt>
            <dd>{execution.budget.reserved}</dd>
            <dt className="text-muted-foreground">已修复 / 最多次数</dt>
            <dd>
              {execution.repairRounds} / {execution.options.maxRepairRounds}
            </dd>
          </dl>
          <ol className="space-y-3">
            {execution.steps.map((step) => (
              <li key={step.id} className="border-border border-l-2 pl-3">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="break-words">{step.label}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {STEP_LABELS[step.status] || step.status}
                  </span>
                </div>
                {step.actualCredits != null && (
                  <p className="text-muted-foreground text-xs">
                    实际使用 {step.actualCredits} 积分
                  </p>
                )}
                {step.note && (
                  <p className="text-muted-foreground mt-1 text-xs break-words">
                    {step.note}
                  </p>
                )}
                {step.error && (
                  <p className="text-destructive mt-1 text-xs break-words">
                    {step.error}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {execution.error && (
            <p className="text-destructive text-sm break-words">
              {execution.error}
            </p>
          )}
          {hasUnknown ? (
            <p className="bg-secondary rounded-lg p-3 text-sm">
              有生成任务的结果尚未确认。请进入编辑器核对，为避免重复提交和扣费，暂不继续。
            </p>
          ) : hasRunning && !active ? (
            <p className="bg-secondary rounded-lg p-3 text-sm">
              仍有已提交的生成正在处理，请刷新核对结果后再继续或重新计划。
            </p>
          ) : execution.requiresAttention ? (
            <p className="bg-secondary rounded-lg p-3 text-sm">
              {mayResume
                ? "本次制作已暂停，请处理上方原因（如补充余额），再继续原任务；也可检查素材后重新计划。"
                : "本次制作需要检查素材，请查看步骤结果和暂停原因，再重新查看执行计划。"}
            </p>
          ) : null}
          {active && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                停止将阻止后续步骤，当前已提交的生成仍可能完成；已发生的费用会保留。
              </p>
              <Button
                variant="outline"
                disabled={state.pending || execution.status === "stopping"}
                onClick={() => void state.stop()}
              >
                <Square size={15} />
                {execution.status === "stopping" ? "正在停止…" : "停止后续步骤"}
              </Button>
            </div>
          )}
          {mayResume && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                从未完成步骤继续，沿用原积分上限和修复次数；累计花费不会清零。
              </p>
              <Button
                disabled={state.pending}
                onClick={() => void state.resume()}
              >
                <Play size={15} />
                继续未完成步骤
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/editor/${projectId}`}>
                查看本集结果
                <ArrowRight size={15} />
              </Link>
            </Button>
            {mayReplan && (
              <Button
                variant="ghost"
                disabled={state.pending}
                onClick={() => setNewPlan(true)}
              >
                重新查看计划
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ExecutionSettings({
  execution,
  llmConfigId,
  pending,
  conflict,
  onPlan,
  onConfirm,
}: {
  execution: AssistantExecutionSnapshot | null;
  llmConfigId?: string;
  pending: boolean;
  conflict: boolean;
  onPlan: (options: AssistantExecutionOptions) => Promise<void>;
  onConfirm: () => Promise<unknown>;
}) {
  const [maxCredits, setMaxCredits] = useState(
    execution?.options.maxCredits ?? 100
  );
  const [rounds, setRounds] = useState(execution?.options.maxRepairRounds ?? 1);
  const [videos, setVideos] = useState(
    execution?.options.generateVideos ?? true
  );
  const [imageId, setImageId] = useState(execution?.options.imageConfigId);
  const [videoId, setVideoId] = useState(execution?.options.videoConfigId);
  const configs = useQuery({
    queryKey: ["ai-configs"],
    queryFn: async () => {
      const response = await fetch("/api/ai-models/configs");
      if (!response.ok) throw new Error("无法读取模型配置");
      return response.json() as Promise<{ configs: ModelConfig[] }>;
    },
    staleTime: 30000,
  });
  function available(category: string, id?: string) {
    const list = (configs.data?.configs ?? []).filter(
      (item) =>
        item.provider.category === category && item.testStatus === "SUCCESS"
    );
    return (
      list.find((item) => item.id === id) ??
      list.find((item) => item.isDefault) ??
      list[0]
    )?.id;
  }
  const chosenImage = available("IMAGE", imageId);
  const chosenVideo = available("VIDEO", videoId);
  const options: AssistantExecutionOptions = {
    maxCredits,
    maxRepairRounds: rounds as 0 | 1 | 2,
    generateVideos: videos,
    ...(chosenImage && { imageConfigId: chosenImage }),
    ...(videos && chosenVideo && { videoConfigId: chosenVideo }),
    ...(llmConfigId && { llmConfigId }),
  };
  const valid =
    Number.isInteger(maxCredits) && maxCredits >= 1 && maxCredits <= 10000;
  const changed =
    !!execution &&
    (execution.options.maxCredits !== maxCredits ||
      execution.options.maxRepairRounds !== rounds ||
      execution.options.generateVideos !== videos ||
      execution.options.imageConfigId !== chosenImage ||
      (videos && execution.options.videoConfigId !== chosenVideo) ||
      execution.options.llmConfigId !== llmConfigId);
  return (
    <div className="space-y-4">
      <div className="border-border space-y-4 rounded-xl border p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="block">最多使用积分</span>
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              aria-label="最多使用积分"
              value={Number.isNaN(maxCredits) ? "" : maxCredits}
              onChange={(event) => setMaxCredits(event.target.valueAsNumber)}
              disabled={pending}
              className="border-border bg-background w-full rounded-lg border p-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">最多自动修复次数</span>
            <select
              aria-label="最多自动修复次数"
              value={rounds}
              onChange={(event) =>
                setRounds(Number(event.target.value) as 0 | 1 | 2)
              }
              disabled={pending}
              className="border-border bg-background w-full rounded-lg border p-2"
            >
              {[0, 1, 2].map((value) => (
                <option key={value} value={value}>
                  {value} 次
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={videos}
            onChange={(event) => setVideos(event.target.checked)}
            disabled={pending}
          />
          同时生成视频
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>图片模型</span>
          <ModelSelector
            category="IMAGE"
            value={chosenImage}
            onChange={(id) => setImageId(id)}
            disabled={pending}
            size="sm"
          />
        </div>
        {videos && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>视频模型</span>
            <ModelSelector
              category="VIDEO"
              value={chosenVideo}
              onChange={(id) => setVideoId(id)}
              disabled={pending}
              size="sm"
            />
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          上限仅约束站内积分；你配置的模型服务商可能另行计费，不计入此上限。已有图片如需修复，会保留旧版本。
        </p>
        {!valid && (
          <p className="text-destructive text-sm">
            请输入 1 至 10000 之间的整数积分上限。
          </p>
        )}
        <Button
          variant="outline"
          disabled={pending || !valid || configs.isPending || !!configs.error}
          onClick={() => void onPlan(options)}
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          {execution ? "重新查看执行计划" : "查看执行计划"}
        </Button>
        {configs.error && (
          <p className="text-destructive text-sm">
            无法读取模型配置，请关闭面板后重试。
          </p>
        )}
      </div>
      {execution && (
        <div className="border-primary/40 space-y-4 rounded-xl border p-4">
          <h4 className="font-semibold">执行计划 · 等待你的确认</h4>
          {execution.plan.baseCredits != null && (
            <p className="text-sm">
              基本制作最多 {execution.plan.baseCredits} 积分。
            </p>
          )}
          <p className="text-sm">
            预计最多 {execution.plan.estimatedCredits}{" "}
            积分（含自动修复），授权上限 {execution.budget.limit} 积分。
          </p>
          <dl className="text-muted-foreground space-y-1 text-xs">
            <div>图片：{execution.plan.models.image}</div>
            {execution.options.generateVideos && (
              <div>视频：{execution.plan.models.video}</div>
            )}
            <div>检查与建议：{execution.plan.models.llm}</div>
          </dl>
          <ol className="list-inside list-decimal space-y-2 text-sm">
            {execution.plan.steps.map((step) => (
              <li key={step.id}>
                {step.label}
                <span className="text-muted-foreground ml-2 text-xs">
                  最多 {step.maxCredits} 积分
                </span>
              </li>
            ))}
          </ol>
          {execution.plan.warnings?.map((warning, index) => (
            <p key={index} className="text-muted-foreground text-sm">
              {warning}
            </p>
          ))}
          {execution.plan.blockers.length > 0 && (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive space-y-1 rounded-lg p-3 text-sm"
            >
              <p>以下事项处理后才能开始：</p>
              {execution.plan.blockers.map((item, index) => (
                <p key={index}>· {item}</p>
              ))}
            </div>
          )}
          {(changed || conflict) && (
            <p className="text-destructive text-sm">
              设置或素材已变化，请重新查看执行计划。
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            确认后按以上计划制作本集；修复次数和积分上限不会在继续任务时重置，旧版本会保留。
          </p>
          <Button
            disabled={
              pending ||
              changed ||
              conflict ||
              execution.plan.blockers.length > 0
            }
            onClick={() => void onConfirm()}
          >
            <Play size={15} />
            确认并开始后台制作
          </Button>
        </div>
      )}
    </div>
  );
}
