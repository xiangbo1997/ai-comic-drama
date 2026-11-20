"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Flame,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import {
  HotReportZ,
  type HotReport,
  type HotIdea,
  type HotPlatform,
} from "@/lib/short-video/hot-discovery";
import { z } from "zod";
import { ScriptZ, type SvScript } from "@/lib/short-video/contracts";
import { ModelSelector } from "@/components/ai-models/model-selector";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
const names = { DOUYIN: "抖音", KUAISHOU: "快手", XIAOHONGSHU: "小红书" };
const fieldClass =
  "border-input bg-background focus-visible:ring-ring/40 min-h-10 w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60";
const buttonClass =
  "bg-primary text-primary-foreground focus-visible:ring-ring/40 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:bg-primary/90 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50";
const unresolvedStatuses = [
  "UNKNOWN",
  "NEEDS_RECONCILIATION",
  "ROLLBACK_PAUSED",
];
// 编辑中允许暂时清空文本；结构仍需校验，避免高级 JSON 损坏可视化表单。
const EditableScriptZ = z
  .object({
    ...ScriptZ.shape,
    title: z.string().max(80),
    hook: z.string().max(500),
    premise: z.string().max(1000),
    shots: z
      .array(
        z
          .object({
            ...ScriptZ.shape.shots.element.shape,
            description: z.string().max(3000),
            imagePrompt: z.string().max(3000),
            videoPrompt: z.string().max(3000),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();
type Job = {
  id: string;
  status: string;
  report: HotReport | null;
  requestedAt: string;
  errorSummary: string | null;
  errorCode?: string | null;
};
async function api<T>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`/api/short-videos/${path}`, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message || "热点服务暂时不可用，请稍后读取最近搜索"
    );
  if (!data) throw new Error("未能读取热点结果，请稍后重试读取");
  return data;
}
function displayTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "未核验";
}
export function HotDiscovery({ onSaved }: { onSaved?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("搜索一下有啥最新的梗可以做成抽象视频吗");
  const [platforms, setPlatforms] = useState<HotPlatform[]>([
    "DOUYIN",
    "KUAISHOU",
    "XIAOHONGSHU",
  ]);
  const [style, setStyle] = useState("XIANXIA");
  const [windowDays, setWindowDays] = useState(3);
  const [searchMode, setSearchMode] = useState("AI");
  const [searchConfigId, setSearchConfigId] = useState("");
  const [aiTitle, setAiTitle] = useState("AI热点原创短视频");
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HotIdea | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [savedVideoId, setSavedVideoId] = useState("");
  const [aiSavedVideoId, setAiSavedVideoId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [unknownAcknowledged, setUnknownAcknowledged] = useState(false);
  const currentJobId = useRef<string | null>(null);
  const selectedSection = useRef<HTMLElement | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const saveIds = useRef(new Map<string, string>());
  const reading = useRef(false);
  const acceptJob = useCallback((next: Job | null) => {
    // 来源任务变化时清空旧选题，避免把旧草案保存到另一份简报。
    if (currentJobId.current !== (next?.id ?? null)) {
      setSelected(null);
      setScriptText("");
      setSavedVideoId("");
      setAiSavedVideoId("");
      setUnknownAcknowledged(false);
      currentJobId.current = next?.id ?? null;
    }
    setJob(next);
  }, []);
  const readLatest = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api<{ item: Job | null }>("hot-briefs");
      acceptJob(result.item);
      setError("");
    } finally {
      setRefreshing(false);
    }
  }, [acceptJob]);
  useEffect(() => {
    let active = true;
    void api<{ item: Job | null }>("hot-briefs")
      .then((r) => {
        if (active) acceptJob(r.item);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [acceptJob]);
  const unresolved =
    !!job &&
    (unresolvedStatuses.includes(job.status) ||
      job.errorCode === "HOT_AI_UNKNOWN");
  const pending =
    busy ||
    loading ||
    refreshing ||
    (unresolved && !unknownAcknowledged) ||
    (!!job && ["PENDING", "RUNNING"].includes(job.status));
  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || !["PENDING", "RUNNING"].includes(jobStatus))
      return;
    const id = jobId;
    let active = true;
    const timer = setInterval(() => {
      if (reading.current) return;
      reading.current = true;
      void api<Job>(`hot-briefs/${id}`)
        .then((r) => {
          if (active && currentJobId.current === id) {
            setJob(r);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          reading.current = false;
        });
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, jobStatus]);
  const search = async () => {
    if (pending) return;
    setBusy(true);
    setError("");
    setSelected(null);
    setSavedVideoId("");
    setAiSavedVideoId("");
    const input = {
      query,
      platforms,
      style,
      windowDays,
      ...(searchMode === "AI" ? { searchConfigId } : {}),
    };
    const fingerprint = JSON.stringify(input);
    const explicitlyNew = unresolved && unknownAcknowledged;
    if (explicitlyNew) setUnknownAcknowledged(false);
    let prior = explicitlyNew ? null : requestRef.current;
    try {
      const raw = sessionStorage.getItem("short-video-hot-pending");
      if (!explicitlyNew && !prior && raw) prior = JSON.parse(raw);
    } catch {
      /* 隐私模式保留当前页面请求编号。 */
    }
    const requestId =
      prior?.fingerprint === fingerprint ? prior.id : crypto.randomUUID();
    requestRef.current = { fingerprint, id: requestId };
    try {
      sessionStorage.setItem(
        "short-video-hot-pending",
        JSON.stringify(requestRef.current)
      );
    } catch {
      /* 不阻止搜索。 */
    }
    try {
      acceptJob(await api<Job>("hot-briefs", { ...input, requestId }));
      requestRef.current = null;
      try {
        sessionStorage.removeItem("short-video-hot-pending");
      } catch {
        /* 无需清理。 */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索未完成，请先读取状态");
    } finally {
      setBusy(false);
    }
  };
  const parsedReport = job?.report ? HotReportZ.safeParse(job.report) : null;
  const report = parsedReport?.success ? parsedReport.data : null;
  let editableScript: SvScript | null = null;
  let scriptError = "";
  if (selected) {
    try {
      const raw: unknown = JSON.parse(scriptText);
      const parsed = ScriptZ.safeParse(raw);
      // 字段编辑允许暂时清空必填项；保存时仍使用完整合同校验。
      const editable = EditableScriptZ.safeParse(raw);
      editableScript = editable.success ? editable.data : null;
      if (!parsed.success)
        scriptError = "请补全标题、开场和镜头内容，并确认镜头总时长为15–30秒。";
      if (!editable.success)
        scriptError = "草案结构有误，请在高级编辑中检查镜头、角色和字段格式。";
    } catch {
      scriptError = "草案格式有误，请在高级编辑中检查 JSON 格式。";
    }
  }
  const editScript = (patch: Partial<SvScript>) => {
    if (!editableScript) return;
    setSavedVideoId("");
    setScriptText(JSON.stringify({ ...editableScript, ...patch }, null, 2));
  };
  const saveAi = async () => {
    if (!job || !report?.ai || busy || aiSavedVideoId) return;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ job: job.id, title: aiTitle });
    let requestId = saveIds.current.get(fingerprint);
    try {
      requestId ||=
        sessionStorage.getItem(`hot-ai-save:${fingerprint}`) || undefined;
    } catch {
      /* 保留本页面幂等编号。 */
    }
    requestId ||= crypto.randomUUID();
    saveIds.current.set(fingerprint, requestId);
    try {
      sessionStorage.setItem(`hot-ai-save:${fingerprint}`, requestId);
    } catch {
      /* 隐私模式不阻止保存。 */
    }
    try {
      const result = await api<{ videoId: string }>(
        `hot-briefs/${job.id}/save-ai`,
        { requestId, title: aiTitle }
      );
      setAiSavedVideoId(result.videoId);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏失败，请读取作品列表核对");
    } finally {
      setBusy(false);
    }
  };
  const choose = (idea: HotIdea) => {
    setSelected(idea);
    setScriptText(JSON.stringify(idea.script, null, 2));
    setSavedVideoId("");
    setError("");
    requestAnimationFrame(() =>
      selectedSection.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      })
    );
  };
  const save = async () => {
    if (!selected || !job || busy || scriptError || savedVideoId) return;
    setBusy(true);
    setError("");
    try {
      // 用户审阅的草案和来源在同一幂等事务保存；不修改历史简报。
      const content = ScriptZ.parse(JSON.parse(scriptText));
      const key = `hot-save:${job.id}:${selected.id}`;
      const fingerprint = JSON.stringify(content);
      let requestId = saveIds.current.get(key + fingerprint);
      try {
        const prior = JSON.parse(sessionStorage.getItem(key) || "null");
        if (prior?.fingerprint === fingerprint) requestId = prior.requestId;
      } catch {
        /* 请求仍由服务端收据去重。 */
      }
      if (!requestId) requestId = crypto.randomUUID();
      saveIds.current.set(key + fingerprint, requestId);
      try {
        sessionStorage.setItem(key, JSON.stringify({ fingerprint, requestId }));
      } catch {
        /* 私密模式保留当前页面编号。 */
      }
      const result = await api<{ videoId: string }>(
        `hot-briefs/${job.id}/save-idea`,
        { requestId, ideaId: selected.id, content }
      );
      setSavedVideoId(result.videoId);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请核对作品列表");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="bg-card border-border min-w-0 overflow-hidden rounded-2xl border shadow-sm"
      aria-label="热点搜索与抽象创意"
    >
      <div className="border-border from-primary/10 to-card border-b bg-gradient-to-br p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="bg-primary/15 text-primary rounded-xl p-2.5">
            <Flame className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-primary mb-1 text-xs font-medium tracking-wide">
              从灵感到原创短片
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              先搜热点，再决定做哪条
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
              选择平台和画风，查看有出处的热点与改编建议，再把喜欢的点子存成作品。
            </p>
          </div>
        </div>
        <ol
          className="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"
          aria-label="热点创作步骤"
        >
          <li className="text-foreground flex items-center gap-1.5">
            <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px]">
              1
            </span>
            搜索灵感
          </li>
          <li aria-hidden="true">
            <ArrowRight className="size-3" />
          </li>
          <li>2. 挑选改编</li>
          <li aria-hidden="true">
            <ArrowRight className="size-3" />
          </li>
          <li>3. 保存后制作</li>
        </ol>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <label className="block space-y-2">
          <span className="text-sm font-medium">想找什么梗</span>
          <textarea
            className={`${fieldClass} min-h-24 resize-y`}
            value={query}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：最近适合做成动物打工视频的日常热梗"
          />
          <span className="text-muted-foreground block text-xs">
            写下题材、反差或你想要的感觉。{query.length}/500
          </span>
        </label>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium">搜索方式</span>
            <select
              aria-label="搜索方式"
              className={fieldClass}
              value={searchMode}
              disabled={busy}
              onChange={(e) => setSearchMode(e.target.value)}
            >
              <option value="AI">AI联网搜索与改编</option>
              <option value="PUBLIC">仅公开榜单</option>
            </select>
          </label>
          {searchMode === "AI" ? (
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">联网搜索模型</p>
              <ModelSelector
                category="LLM"
                capability="web-search"
                autoSelect
                value={searchConfigId}
                onChange={(id) => setSearchConfigId(id)}
                disabled={pending}
              />
            </div>
          ) : (
            <div className="bg-muted/50 text-muted-foreground rounded-lg px-3 py-2.5 text-xs leading-relaxed">
              公开榜单不调用付费模型，提供可编辑的规则草案；仅展示本轮取得来源的话题。
            </div>
          )}
        </div>
        {searchMode === "AI" && (
          <div className="bg-primary/5 border-primary/15 rounded-lg border p-3 text-xs leading-relaxed">
            <p>
              本次AI搜索会使用所选模型，供应方可能收费。一次点击提交一次搜索，刷新页面会继续读取已有任务。
            </p>
            <p className="text-muted-foreground mt-1">
              在{" "}
              <a
                className="text-primary underline underline-offset-2"
                href="/settings/ai-models"
              >
                共用AI模型设置
              </a>{" "}
              启用联网搜索、保存并测试通过后即可使用。
              {!searchConfigId && "也可先切换“仅公开榜单”寻找灵感。"}
            </p>
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">搜索平台</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(names).map(([platform, name]) => (
              <label
                key={platform}
                className={`focus-within:ring-ring/40 flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition focus-within:ring-2 ${platforms.includes(platform as HotPlatform) ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  disabled={busy}
                  checked={platforms.includes(platform as HotPlatform)}
                  onChange={(e) =>
                    setPlatforms((old) =>
                      e.target.checked
                        ? [...old, platform as HotPlatform]
                        : old.filter((p) => p !== platform)
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
          {!platforms.length && (
            <p className="text-destructive text-xs">请至少选择一个搜索平台。</p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium">改编画风</span>
            <select
              className={fieldClass}
              value={style}
              disabled={busy}
              onChange={(e) => setStyle(e.target.value)}
            >
              <option value="XIANXIA">修仙反差</option>
              <option value="ANIMALS">动物打工</option>
              <option value="DAILY">荒诞日常</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium">来源更新范围</span>
            <select
              className={fieldClass}
              value={windowDays}
              disabled={busy}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              {[1, 3, 7].map((days) => (
                <option key={days} value={days}>
                  最近{days}天
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className={buttonClass}
            disabled={
              pending ||
              !platforms.length ||
              !query.trim() ||
              (searchMode === "AI" && !searchConfigId)
            }
            onClick={() => void search()}
          >
            {job && ["PENDING", "RUNNING"].includes(job.status) ? (
              <Loader2
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            {job && ["PENDING", "RUNNING"].includes(job.status)
              ? "搜索进行中…"
              : "搜索最新梗与改编点子"}
          </button>
          <Button
            type="button"
            variant="outline"
            className="min-h-10"
            disabled={busy || loading || refreshing}
            onClick={() =>
              void readLatest().catch((e) =>
                setError(
                  e instanceof Error ? e.message : "暂时无法读取搜索结果"
                )
              )
            }
          >
            {refreshing && (
              <Loader2
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            读取最近搜索
          </Button>
        </div>
        {loading && (
          <p
            role="status"
            className="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <Loader2
              className="size-4 motion-safe:animate-spin"
              aria-hidden="true"
            />
            读取最近的热点任务…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm break-words"
          >
            {error}
          </p>
        )}
        {parsedReport && !parsedReport.success && (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-sm"
          >
            这份搜索结果暂时无法完整读取。请点击“读取最近搜索”重试，已有任务不会重新计费。
          </p>
        )}
        {job && ["PENDING", "RUNNING"].includes(job.status) && (
          <div
            role="status"
            className="border-primary/20 bg-primary/5 rounded-xl border p-4"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2
                className="text-primary size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
              {job.status === "PENDING"
                ? "等待后台读取来源"
                : "正在搜索与核对来源"}
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              可关闭页面，回来后继续读取；AI搜索可能需要1–3分钟。长时间未更新可点击“读取最近搜索”。
            </p>
          </div>
        )}
        {unresolved && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
          >
            <p className="text-sm font-medium">
              搜索结果未知，请先核对已有任务
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              上游可能已处理本次请求。请先读取最近搜索，仍未恢复时联系管理员核对请求和用量，避免重复计费。
              {job?.errorSummary ? ` ${job.errorSummary}` : ""}
            </p>
            <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4 shrink-0"
                checked={unknownAcknowledged}
                onChange={(e) => setUnknownAcknowledged(e.target.checked)}
              />
              已核对原请求和用量，我要另建一次搜索（可能产生新费用）
            </label>
          </div>
        )}
        {job?.status === "FAILED" && !unresolved && (
          <p
            role="alert"
            className="border-destructive/30 rounded-lg border p-3 text-sm"
          >
            {job.errorSummary || "搜索未完成，可以调整条件后重新搜索。"}
          </p>
        )}
        {!loading && !job && !error && (
          <div className="border-border bg-muted/20 rounded-xl border border-dashed p-5 text-center">
            <Sparkles
              className="text-primary mx-auto mb-2 size-6"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              还没有搜索记录，先找一个想做的点子
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              搜索后会保留来源与改编建议，收藏时不会开始生成视频。
            </p>
          </div>
        )}
        {report && (
          <div className="border-border space-y-5 border-t pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">本轮灵感简报</h3>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {report.query} · {displayTime(report.generatedAt)}（北京时间）
                </p>
              </div>
              <span className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 text-xs">
                {report.ai ? "AI联网搜索" : `${report.ideas.length}个改编草案`}
              </span>
            </div>
            {report.ai && (
              <section
                aria-label="AI联网搜索结果"
                className="min-w-0 space-y-4"
              >
                <h3 className="flex items-center gap-2 font-semibold">
                  <Sparkles
                    className="text-primary size-4"
                    aria-hidden="true"
                  />
                  AI联网搜索与原创改编
                </h3>
                <p className="text-muted-foreground text-xs break-words">
                  模型：{report.ai.model} · 搜索工具调用：{report.ai.toolCalls}
                  次 · {displayTime(report.ai.retrievedAt)}
                </p>
                <div className="bg-muted/25 max-w-full space-y-3 overflow-x-auto rounded-xl p-4 text-sm leading-relaxed break-words [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-inside [&_ol]:list-decimal [&_p]:my-2 [&_table]:min-w-full [&_td]:border-b [&_td]:p-2 [&_td]:align-top [&_th]:border-b [&_th]:p-2 [&_th]:text-left [&_ul]:list-inside [&_ul]:list-disc">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => <span>{alt}</span>,
                      a: ({ href, children }) =>
                        href &&
                        report.ai!.sources.some((s) => s.url === href) ? (
                          <a
                            href={href}
                            className="text-primary underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {children}
                          </a>
                        ) : (
                          <span>{children}</span>
                        ),
                    }}
                  >
                    {report.ai.answer}
                  </ReactMarkdown>
                </div>
                <details className="border-border rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    核对搜索来源与用量
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm">
                    {report.ai.sources.map((s) => (
                      <li key={s.url}>
                        <a
                          className="text-primary inline-flex items-start gap-1 underline underline-offset-2"
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {s.title}
                          <ExternalLink
                            className="mt-1 size-3 shrink-0"
                            aria-hidden="true"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                    上游记录：输入{report.ai.usage.inputTokens ?? "未知"} / 输出
                    {report.ai.usage.outputTokens ?? "未知"}{" "}
                    token。供应方金额未取得；网页日期以原文为准，第三方快照不代表官方授权搜索。
                  </p>
                </details>
                <div className="border-primary/20 bg-primary/5 space-y-3 rounded-xl border p-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">作品名称</span>
                    <input
                      className={fieldClass}
                      value={aiTitle}
                      maxLength={80}
                      disabled={busy || !!aiSavedVideoId}
                      onChange={(e) => setAiTitle(e.target.value)}
                    />
                  </label>
                  <p className="text-muted-foreground text-xs">
                    收藏后进入作品补全脚本、确认生成计划与预算。
                  </p>
                  {aiSavedVideoId ? (
                    <div className="space-y-2">
                      <p
                        role="status"
                        className="flex items-center gap-2 text-sm"
                      >
                        <CheckCircle2
                          className="text-primary size-4"
                          aria-hidden="true"
                        />
                        已收藏，接下来完善脚本
                      </p>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() =>
                          router.push(`/short-videos/${aiSavedVideoId}`)
                        }
                      >
                        进入作品继续制作
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy || !aiTitle.trim()}
                      onClick={() => void saveAi()}
                    >
                      收藏AI简报并开始创作
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </section>
            )}
            {!report.ai && (
              <p
                className="bg-primary/5 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap"
                role="status"
              >
                {report.summary}
              </p>
            )}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">直接榜单读取状态</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {report.sources.map((source) => (
                  <article
                    key={source.platform}
                    className="border-border min-w-0 space-y-2 rounded-xl border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm">
                        {names[source.platform]}
                      </strong>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${source.status === "AVAILABLE" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                      >
                        {source.status === "AVAILABLE"
                          ? "取得快照"
                          : source.status === "PARTIAL"
                            ? "部分候选待核验"
                            : "暂未取得"}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed break-words">
                      {source.reason}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      采集：{displayTime(source.fetchedAt)}
                    </p>
                    {source.sourceUrl && (
                      <a
                        className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-2"
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看数据来源
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </div>
            {!!report.ideas.length && (
              <div className="space-y-3">
                <h3 className="font-semibold">公开榜单快速草案（规则生成）</h3>
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                  {report.ideas.map((idea) => {
                    const topic = report.topics.find(
                      (t) => t.id === idea.topicId
                    );
                    if (!topic) return null;
                    const recommended = idea.id === report.recommendation;
                    return (
                      <article
                        key={idea.id}
                        className={`min-w-0 space-y-3 rounded-xl border p-4 ${recommended ? "border-primary/40 bg-primary/5" : "border-border"}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="bg-secondary rounded px-2 py-0.5 text-xs">
                            {names[topic.platform]}
                          </span>
                          {recommended && (
                            <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
                              <Sparkles className="size-3" aria-hidden="true" />
                              本轮优先
                            </span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {idea.durationSec}秒 · 两镜 · 难度{idea.difficulty}
                          </span>
                        </div>
                        <h4 className="text-base font-semibold break-words">
                          《{idea.title}》
                        </h4>
                        <p className="text-sm leading-relaxed break-words">
                          {idea.outline}
                        </p>
                        <div className="border-border border-t pt-3 text-xs leading-relaxed">
                          <p className="text-muted-foreground mb-1">
                            改编灵感来自
                          </p>
                          <a
                            href={topic.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary break-words underline underline-offset-2"
                          >
                            {topic.title}
                          </a>
                          <p className="text-muted-foreground mt-1">
                            {topic.sourceName} · 来源更新：
                            {displayTime(topic.snapshotAt)}
                            {topic.timeBasis === "RELATIVE" ? "（估计）" : ""}
                          </p>
                          <p className="text-muted-foreground">
                            {topic.rank
                              ? `该快照排名 ${topic.rank}`
                              : "未取得排名"}
                            {topic.heatLabel
                              ? ` · 来源热度 ${topic.heatLabel}`
                              : ""}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant={recommended ? "default" : "outline"}
                          className="min-h-10 w-full"
                          disabled={busy}
                          onClick={() => choose(idea)}
                        >
                          展开分镜
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
            {!report.ideas.length && !report.ai && (
              <div className="border-border bg-muted/20 space-y-1 rounded-xl border border-dashed p-4">
                <p className="text-sm font-medium">
                  这轮没有足够新鲜、适合日常反差的选题。
                </p>
                <p className="text-muted-foreground text-xs">
                  可以换个关键词、扩大更新时间范围，或在下方手动导入自己的灵感。
                </p>
              </div>
            )}
            <details className="border-border rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                全部来源话题与核验说明（{report.topics.length}条）
              </summary>
              <ul className="mt-3 space-y-3 text-xs leading-relaxed">
                {report.topics.map((topic) => (
                  <li key={`${topic.platform}:${topic.id}`}>
                    <a
                      className="text-primary break-words underline underline-offset-2"
                      href={topic.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {topic.title}
                    </a>
                    <span className="text-muted-foreground">
                      {" "}
                      · {names[topic.platform]} · 来源更新
                      {displayTime(topic.snapshotAt)}
                      {topic.evidenceKind === "WEB_SEARCH"
                        ? " · 网页候选，未核验是否在榜"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {report.notes.map((note) => (
                <p
                  key={note}
                  className="text-muted-foreground mt-2 text-xs leading-relaxed"
                >
                  {note}
                </p>
              ))}
            </details>
          </div>
        )}
        {selected && (
          <section
            ref={selectedSection}
            className="border-primary/25 bg-primary/5 scroll-mt-6 space-y-4 rounded-xl border p-4 sm:p-5"
            aria-label="原创草案编辑"
          >
            <div>
              <p className="text-primary mb-1 text-xs font-medium">
                把点子变成可制作的脚本
              </p>
              <h3 className="text-lg font-semibold">
                《{selected.title}》· 可编辑草案
              </h3>
            </div>
            <p className="text-sm leading-relaxed">
              首帧：{selected.firstFrame}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {selected.rationale}
            </p>
            {editableScript && (
              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">草案标题</span>
                  <input
                    className={fieldClass}
                    value={editableScript.title}
                    maxLength={80}
                    disabled={busy || !!savedVideoId}
                    onChange={(e) => editScript({ title: e.target.value })}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">开场钩子</span>
                  <textarea
                    className={fieldClass}
                    value={editableScript.hook ?? ""}
                    maxLength={500}
                    disabled={busy || !!savedVideoId}
                    onChange={(e) => editScript({ hook: e.target.value })}
                  />
                </label>
                <div className="grid gap-3 lg:grid-cols-2">
                  {editableScript.shots.map((shot, index) => (
                    <fieldset
                      key={shot.key ?? index}
                      className="bg-card border-border min-w-0 space-y-3 rounded-lg border p-3"
                    >
                      <legend className="px-1 text-sm font-medium">
                        镜头{index + 1} · {shot.durationSec}秒
                      </legend>
                      {(
                        [
                          ["description", "画面内容", 3000],
                          ["videoPrompt", "镜头动作", 3000],
                          ["dialogue", "对白", 500],
                          ["subtitle", "字幕", 1000],
                        ] as const
                      ).map(([key, label, max]) => (
                        <label key={key} className="block space-y-1">
                          <span className="text-muted-foreground text-xs">
                            {label}
                          </span>
                          <textarea
                            aria-label={`镜头${index + 1}${label}`}
                            className={fieldClass}
                            value={shot[key] ?? ""}
                            maxLength={max}
                            disabled={busy || !!savedVideoId}
                            onChange={(e) =>
                              editScript({
                                shots: editableScript!.shots.map((item, i) =>
                                  i === index
                                    ? { ...item, [key]: e.target.value }
                                    : item
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </div>
            )}
            <p className="text-muted-foreground text-xs leading-relaxed">
              首帧与动作分开做，每镜只安排一个动作；对白和字幕后期配。这里采用20秒有效脚本，保存后仍需单独查看模型和积分计划。
            </p>
            <details
              className="border-border rounded-lg border p-3"
              open={!editableScript}
            >
              <summary className="cursor-pointer text-xs font-medium">
                高级编辑：完整脚本 JSON
              </summary>
              <label className="mt-3 block space-y-2">
                <span className="text-xs">编辑结构化草案</span>
                <textarea
                  className={`${fieldClass} min-h-48 font-mono text-xs`}
                  value={scriptText}
                  disabled={busy || !!savedVideoId}
                  onChange={(e) => {
                    setScriptText(e.target.value);
                    setSavedVideoId("");
                  }}
                />
              </label>
            </details>
            {scriptError && (
              <p role="alert" className="text-destructive text-xs">
                {scriptError}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className={buttonClass}
                disabled={busy || !!savedVideoId || !!scriptError}
                onClick={() => void save()}
              >
                {busy ? (
                  <Loader2
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : savedVideoId ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : null}
                {savedVideoId ? "已保存来源与草案" : "保存来源与草案到作品"}
              </button>
              {savedVideoId && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => router.push(`/short-videos/${savedVideoId}`)}
                >
                  进入作品继续制作
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {savedVideoId && (
              <p role="status" className="text-sm">
                草案已保存。进入作品后选择模型、检查预算，再确认开始生成。
              </p>
            )}
          </section>
        )}
        {job && (
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">搜索任务信息</summary>
            <p className="mt-2 break-all">搜索任务：{job.id}</p>
          </details>
        )}
      </div>
    </section>
  );
}
