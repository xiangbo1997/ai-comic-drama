"use client";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { HotDiscovery } from "./hot-discovery";
import { PublicationMetrics } from "./publication-metrics";
import { ScriptEditor, scriptValidationMessage } from "./script-editor";
import { Check, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ScriptZ, PublicationPayloadZ } from "@/lib/short-video/contracts";
type Item = {
  id: string;
  title?: string;
  summary?: string;
  platform?: string;
  originalUrl?: string;
  observedAt?: string;
  ingestionMode?: string;
  metrics?: Record<string, number | null> | null;
  version: number;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  status?: string;
  mode?: string;
  capabilitySnapshot?: { reason: string };
  disabledAt?: string | null;
  brief?: string;
  templateId?: string;
  currentArtifactId?: string;
  currentScriptVersionId?: string;
  workflowStatus?: "DRAFT" | "SCRIPTED" | "READY";
  createdAt?: string;
  updatedAt?: string;
  account?: { displayName: string; platform: string };
  scheduledAt?: string;
  displayTimeZone?: string;
  externalUrl?: string;
  publishedAt?: string;
  reviewHash?: string;
  approvedHash?: string;
  payload?: {
    title: string;
    text: string;
    hashtags: string[];
    aiGenerated: boolean;
    commercial: boolean;
  };
  artifactId?: string;
  artifacts?: Artifact[];
  scripts?: Script[];
  runs?: Run[];
  template?: { version: number };
  sources?: { source: Item }[];
};
type Artifact = {
  id: string;
  version: number;
  kind: string;
  bytes: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  storageBackend: string;
  verifiedAt: string | null;
};
type Script = { id: string; version: number; origin: string; content: unknown };
type Run = {
  id: string;
  kind: string;
  status: string;
  version: number;
  planHash: string;
  spentCredits: number;
  reservedCredits: number;
  maxCredits: number;
  errorSummary?: string;
  plan: {
    models: { id: string; category: string; model: string }[];
    upperBoundCredits: number;
    supplierFees: string;
    estimatedDuration?: number[];
  };
  steps?: {
    id: string;
    key: string;
    kind: string;
    status: string;
    estimatedCredits: number;
    actualCredits?: number;
  }[];
};
type Model = {
  id: string;
  selectedModel: string;
  provider: { category: string; name: string };
};
type Capability = {
  userId?: string;
  autoSubmitEnabled: boolean;
  platforms: {
    platform: string;
    discovery: string;
    publish: string;
    reason: string;
  }[];
  defaultTimeZone: string;
};
const names: Record<string, string> = {
  DOUYIN: "抖音",
  KUAISHOU: "快手",
  XIAOHONGSHU: "小红书",
  OTHER: "其他",
};
const statuses: Record<string, string> = {
  PLANNED: "待确认计划",
  QUEUED: "排队中",
  RUNNING: "执行中",
  PAUSED: "已暂停",
  NEEDS_RECONCILIATION: "结果未知，需核对",
  COMPLETED: "已完成",
  FAILED: "失败",
  STOPPING: "停止后续并核对",
  STOPPED: "已停止",
  DRAFT: "待审核",
  CLAIMED: "准备提交",
  CONNECTED: "已连接",
  DISCONNECTED: "已断开",
  MANUAL: "人工模式",
  AUTO: "自动模式",
  IMPORT: "手动导入",
  LLM: "文本",
  IMAGE: "图像",
  VIDEO: "视频",
  TTS: "配音",
  COVER: "封面",
  SCRIPT: "脚本",
  RENDER: "成片生成",
  VERIFIED: "已核验",
  APPROVED: "已批准，待排期",
  SCHEDULED: "已排期",
  AWAITING_MANUAL: "待人工发布",
  PUBLISHED: "已发布",
  BLOCKED: "受阻",
  EXPIRED: "已过期，请重排",
  CANCELLED: "已取消",
  SUBMITTING: "正在提交",
  PROCESSING: "供应方处理中",
  REJECTED: "平台拒绝",
  UNKNOWN: "结果未知",
  PENDING: "准备中",
};
const inputClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 w-full min-w-0 rounded-lg border px-3 py-2.5 text-sm outline-none transition-shadow focus-visible:ring-2 disabled:opacity-50";
const buttonClass =
  "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass =
  "border-border hover:bg-muted focus-visible:ring-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50";
async function read<T>(path: string): Promise<T> {
  const response = await fetch(`/api/short-videos/${path}`, {
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "读取失败");
  return data;
}
function Label({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    <label className="block space-y-1">
      <span id={labelId} className="text-sm">
        {title}
      </span>
      {isValidElement<{ "aria-labelledby"?: string }>(children)
        ? cloneElement(children, { "aria-labelledby": labelId })
        : children}
    </label>
  );
}
function Panel({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="border-border bg-card min-w-0 scroll-mt-6 space-y-4 rounded-2xl border p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function time(value?: string, zone = "Asia/Shanghai") {
  if (!value) return "未排期";
  if (Number.isNaN(Date.parse(value))) return "时间格式无效";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(value));
  } catch {
    return "请填写有效时区";
  }
}
function VideoThumbnail({ artifactId }: { artifactId: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void read<{ url: string }>(`artifacts/${artifactId}/access`)
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [artifactId]);
  return url ? (
    <video
      aria-label="成片缩略预览"
      src={url}
      muted
      preload="metadata"
      className="h-24 w-16 rounded object-cover"
    />
  ) : (
    <span className="text-muted-foreground text-sm">成片预览待读取</span>
  );
}
export function ShortVideoWorkbench({
  mode,
  id,
}: {
  mode: "videos" | "trends" | "accounts" | "publications" | "detail";
  id?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Item[]>([]);
  const [caps, setCaps] = useState<Capability | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [accounts, setAccounts] = useState<Item[]>([]);
  const [video, setVideo] = useState<Item | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [publication, setPublication] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [platform, setPlatform] = useState("DOUYIN");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [rights, setRights] = useState("");
  const [filter, setFilter] = useState("");
  const [videoStatus, setVideoStatus] = useState("");
  const [listFilter, setListFilter] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [llm, setLlm] = useState("");
  const [image, setImage] = useState("");
  const [videoModel, setVideoModel] = useState("");
  const [tts, setTts] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [budget, setBudget] = useState(100);
  const [file, setFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState("VIDEO");
  const [artifactId, setArtifactId] = useState("");
  const [coverId, setCoverId] = useState("");
  const [preview, setPreview] = useState("");
  const [accountId, setAccountId] = useState("");
  const [publicationMode, setPublicationMode] = useState("MANUAL");
  const [caption, setCaption] = useState("");
  const [publicationTitle, setPublicationTitle] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [commercial, setCommercial] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [zone, setZone] = useState("Asia/Shanghai");
  const [externalUrl, setExternalUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const initializedVideo = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const preferredRun = useRef<string | null>(null);
  const scriptDraftRef = useRef("");
  const scriptSelectionRef = useRef("");
  const artifactSelectionRef = useRef("");
  const pollingBusy = useRef(false);
  const [scriptDirty, setScriptDirty] = useState(false);
  const pending = useRef(
    new Map<string, { input: string; requestId: string }>()
  );
  useEffect(() => {
    scriptDraftRef.current = scriptText;
    scriptSelectionRef.current = scriptId;
    artifactSelectionRef.current = artifactId;
    pollingBusy.current = busy;
  }, [scriptText, scriptId, artifactId, busy]);
  const listEndpoint = useCallback(() => {
    const query = new URLSearchParams();
    if (mode === "trends") {
      if (filter) query.set("q", filter);
      if (sourcePlatform) query.set("platform", sourcePlatform);
    }
    if (mode === "videos") {
      if (filter) query.set("q", filter);
      if (videoStatus) query.set("status", videoStatus);
    }
    return `${mode === "trends" ? "sources" : mode}${query.size ? `?${query}` : ""}`;
  }, [mode, filter, sourcePlatform, videoStatus]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const capability = await read<Capability>("capabilities");
    if (sequence !== loadSequence.current) return;
    setCaps(capability);
    if (mode === "detail" && id) {
      const detail = await read<Item>(`videos/${id}`);
      if (sequence !== loadSequence.current) return;
      setVideo(detail);
      if (initializedVideo.current !== detail.id) {
        initializedVideo.current = detail.id;
        setTitle(detail.title || "");
        setPublicationTitle(detail.title || "");
        setTemplateId(detail.templateId || "");
        const initial =
          detail.scripts?.find(
            (script) => script.id === detail.currentScriptVersionId
          ) || detail.scripts?.[0];
        if (initial) {
          setScriptId(initial.id);
          setScriptText(JSON.stringify(initial.content, null, 2));
          setScriptDirty(false);
        }
      } else if (
        !scriptDraftRef.current &&
        !scriptSelectionRef.current &&
        detail.scripts?.length
      ) {
        const latestScript = detail.scripts[0];
        setScriptId(latestScript.id);
        setScriptText(JSON.stringify(latestScript.content, null, 2));
      }
      if (!artifactSelectionRef.current) {
        const film =
          detail.artifacts?.find(
            (artifact) =>
              artifact.id === detail.currentArtifactId &&
              artifact.kind === "VIDEO"
          ) ||
          detail.artifacts?.find(
            (artifact) => artifact.kind === "VIDEO" && artifact.verifiedAt
          );
        if (film) setArtifactId(film.id);
      }
      const latest = detail.runs?.[0];
      // 列表尚未反映刚创建的计划时，继续读取该计划，避免旧任务覆盖确认界面。
      const runId = preferredRun.current || latest?.id;
      if (latest?.id === preferredRun.current) preferredRun.current = null;
      if (runId) {
        const latestRun = await read<Run>(`runs/${runId}`);
        if (sequence !== loadSequence.current) return;
        setRun((current) =>
          current?.id === latestRun.id && current.version > latestRun.version
            ? current
            : latestRun
        );
      }
      const [m, a, t] = await Promise.all([
        read<{ items: Model[] }>("models"),
        read<{ items: Item[] }>("accounts?limit=100"),
        read<{ items: Item[] }>("templates?limit=100"),
      ]);
      if (sequence !== loadSequence.current) return;
      setModels(m.items);
      setAccounts(a.items);
      setTemplates(t.items);
    } else {
      const endpoint = listEndpoint();
      const result = await read<{ items: Item[]; nextCursor: string | null }>(
        endpoint
      );
      if (sequence !== loadSequence.current) return;
      setItems(result.items);
      setCursor(result.nextCursor);
      if (mode === "videos" || mode === "trends")
        setTemplates(
          (await read<{ items: Item[] }>("templates?limit=100")).items
        );
    }
  }, [mode, id, listEndpoint]);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve()
      .then(load)
      .catch((e) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [load]);
  useEffect(() => {
    if (mode !== "detail") return;
    const timer = setInterval(() => {
      if (!pollingBusy.current && document.visibilityState === "visible")
        void load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load, mode]);
  const action = async (fn: () => Promise<void>, reload = true) => {
    ++loadSequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (reload) await load();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues
              .map((issue) => issue.message)
              .slice(0, 3)
              .join("；")
          : e instanceof SyntaxError
            ? "输入格式不正确，请检查内容后重试"
            : e instanceof Error
              ? e.message
              : "操作失败，请重新读取状态"
      );
    } finally {
      setBusy(false);
    }
  };
  async function write<T>(
    path: string,
    body: Record<string, unknown>,
    method = "POST"
  ): Promise<T> {
    const input = JSON.stringify(body);
    const key = `${method}:${path}`;
    const storageKey = `short-video-request:${caps?.userId || "current"}:${key}`;
    let persisted: { input: string; requestId: string } | undefined;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) persisted = JSON.parse(stored);
    } catch {
      /* 隐私模式仍可使用当前页面的幂等编号。 */
    }
    const prior = pending.current.get(key) ?? persisted;
    const requestId =
      prior?.input === input ? prior.requestId : crypto.randomUUID();
    pending.current.set(key, { input, requestId });
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ input, requestId }));
    } catch {
      /* 存储不可用时保留内存收据。 */
    }
    const response = await fetch(`/api/short-videos/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, requestId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "操作失败");
    pending.current.delete(key);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* 无持久请求可清理。 */
    }
    return data;
  }
  function acceptRun(next: Run) {
    preferredRun.current = next.id;
    setRun(next);
  }
  const modelSelect = (
    category: string,
    value: string,
    change: (v: string) => void
  ) => (
    <select
      className={inputClass}
      aria-label={`${category}模型`}
      value={value}
      onChange={(e) => change(e.target.value)}
    >
      <option value="">请选择{statuses[category] || category}模型</option>
      {models
        .filter((m) => m.provider.category === category)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.provider.name} / {m.selectedModel || "未选模型"}
          </option>
        ))}
    </select>
  );
  const refresh = () =>
    action(async () => {
      await load();
      if (publication)
        setPublication(await read<Item>(`publications/${publication.id}`));
      setNotice("已重新读取服务器状态");
    });
  const create = () =>
    action(async () => {
      const created = await write<Item>("videos", {
        title,
        brief,
        sourceIds: [],
        ...(templateId ? { templateId } : {}),
      });
      router.push(`/short-videos/${created.id}`);
    });
  const createFromSource = (source: Item) =>
    action(async () => {
      const created = await write<Item>("videos", {
        title: source.title || "原创抽象短片",
        brief: source.summary || "",
        sourceIds: [source.id],
        ...(templateId ? { templateId } : {}),
      });
      router.push(`/short-videos/${created.id}`);
    });
  const publicationAction = (actionName: string) =>
    action(async () => {
      if (!publication) return;
      const extra: Record<string, unknown> = {};
      if (actionName === "approve" || actionName === "schedule")
        extra.approvedHash = publication.reviewHash;
      if (actionName === "schedule") {
        extra.scheduledAt = new Date(
          z.iso.datetime({ offset: true }).parse(schedule)
        ).toISOString();
        extra.timeZone = zone;
      }
      if (actionName === "mark_manual_published") {
        extra.externalUrl = externalUrl;
        extra.publishedAt = new Date(
          z.iso.datetime({ offset: true }).parse(publishedAt)
        ).toISOString();
      }
      setPublication(
        await write<Item>(`publications/${publication.id}/actions`, {
          action: actionName,
          expectedVersion: publication.version,
          ...extra,
        })
      );
    });
  return (
    <div className="min-w-0 space-y-6 [&_article]:min-w-0 [&_p]:break-words">
      {mode === "detail" && video && (
        <div className="border-primary/20 from-primary/10 to-card overflow-hidden rounded-2xl border bg-gradient-to-br p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">竖屏创作 · 15–30 秒</Badge>
            <Badge
              variant={
                video.artifacts?.some((artifact) => artifact.kind === "VIDEO")
                  ? "success"
                  : "muted"
              }
            >
              {video.artifacts?.some((artifact) => artifact.kind === "VIDEO")
                ? "已有成片"
                : video.scripts?.length
                  ? "脚本已就绪"
                  : "从一个笑点开始"}
            </Badge>
          </div>
          <p className="mt-4 text-lg font-semibold sm:text-xl">{video.title}</p>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            {video.artifacts?.some((artifact) => artifact.kind === "VIDEO")
              ? "下一步：选择成片和发布账号，创建审核快照。也可继续修改脚本，生成新版本。"
              : video.scripts?.length
                ? "下一步：检查脚本，选择生成模型并查看预算计划。已有成片也可以直接上传。"
                : "下一步：用表单写一个两镜头脚本，或选用模型改编。已有成片可直接上传进入审核。"}
          </p>
          <nav
            aria-label="创作步骤"
            className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {[
              ["sv-script", "1", "脚本", !!video.scripts?.length],
              ["sv-generation", "2", "生成计划", run?.status === "COMPLETED"],
              [
                "sv-artifacts",
                "3",
                "成片与封面",
                !!video.artifacts?.some(
                  (artifact) => artifact.kind === "VIDEO"
                ),
              ],
              ["sv-review", "4", "审核与发布", !!publication],
            ].map(([anchor, number, label, done]) => (
              <a
                key={String(anchor)}
                href={`#${anchor}`}
                className="border-border bg-background/80 hover:border-primary/40 focus-visible:ring-ring flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              >
                <span
                  className={
                    done
                      ? "bg-chart-2/15 text-chart-2 flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
                      : "bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
                  }
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : number}
                </span>
                {label}
              </a>
            ))}
          </nav>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={secondaryClass}
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden
          />
          重新读取状态
        </button>
        {loading && <span role="status">加载中…</span>}
        {busy && <span role="status">保存中…</span>}
      </div>
      {error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="border-chart-2/20 bg-chart-2/5 rounded-xl border p-4 text-sm"
        >
          {notice}
        </p>
      )}
      {caps && (
        <p className="text-muted-foreground bg-muted/40 rounded-xl px-4 py-3 text-xs leading-relaxed">
          {caps.platforms.some(
            (c) => c.publish === "VERIFIED" || c.discovery === "VERIFIED"
          )
            ? "按已核验连接器能力执行。"
            : "当前为人工导入与人工发布模式。"}
          {caps.autoSubmitEnabled
            ? "付费生成已开启，每份计划仍需确认预算。"
            : "付费生成暂未开启，可编辑脚本、上传成片并人工发布。"}
        </p>
      )}
      {mode === "videos" && (
        <Panel title="创建原创短片">
          <Label title="作品标题">
            <input
              className={inputClass}
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Label>
          <Label title="选题与笑点">
            <textarea
              className={inputClass}
              value={brief}
              maxLength={4000}
              onChange={(e) => setBrief(e.target.value)}
            />
          </Label>
          <Label title="系列模板">
            <select
              className={inputClass}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">请选择模板（模型改编需模板）</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title || (t as Item & { name: string }).name}
                </option>
              ))}
            </select>
          </Label>
          <button
            className={buttonClass}
            disabled={busy || !title.trim()}
            onClick={() => void create()}
          >
            创建草稿
          </button>
        </Panel>
      )}
      {mode === "trends" && <HotDiscovery />}
      {mode === "trends" && (
        <>
          <Panel title="平台授权能力与手动导入">
            {caps?.platforms.map((c) => (
              <p key={c.platform}>
                {names[c.platform]}：搜索 {statuses[c.discovery] || c.discovery}{" "}
                · 发布 {statuses[c.publish] || c.publish} · {c.reason}
              </p>
            ))}
            <Label title="筛选来源平台">
              <select
                className={inputClass}
                value={sourcePlatform}
                onChange={(e) => setSourcePlatform(e.target.value)}
              >
                <option value="">全部平台</option>
                {Object.entries(names).map(([v, name]) => (
                  <option key={v} value={v}>
                    {name}
                  </option>
                ))}
              </select>
            </Label>
            <Label title="搜索本人已导入来源">
              <input
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Label>
            <button
              className={buttonClass}
              disabled
              title="尚无已验证授权搜索来源"
            >
              平台授权搜索暂不可用
            </button>
          </Panel>
          <Panel title="导入链接或手动选题">
            <Label title="来源平台">
              <select
                className={inputClass}
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                {Object.entries(names).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </Label>
            <Label title="原链接（可留空，不自动下载原片）">
              <input
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Label>
            <Label title="梗摘要">
              <textarea
                className={inputClass}
                value={summary}
                maxLength={4000}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Label>
            <Label title="素材权利备注">
              <input
                className={inputClass}
                value={rights}
                maxLength={1000}
                onChange={(e) => setRights(e.target.value)}
              />
            </Label>
            <button
              className={buttonClass}
              disabled={busy || !summary.trim()}
              onClick={() =>
                void action(async () => {
                  await write("sources/import", {
                    platform,
                    ...(url ? { url } : {}),
                    summary,
                    rightsNote: rights,
                  });
                  setNotice("来源已保存；相同链接按可识别能力去重，短链未展开");
                })
              }
            >
              保存来源
            </button>
            <Label title="改编模板">
              <select
                className={inputClass}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">选择模板</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {(t as Item & { name: string }).name}
                  </option>
                ))}
              </select>
            </Label>
          </Panel>
        </>
      )}
      {mode === "accounts" && (
        <Panel title="新增人工发布账号">
          <p>账号昵称仅供识别，不代表完成平台授权；AUTO 在权限核验后开放。</p>
          <Label title="目标平台">
            <select
              className={inputClass}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {Object.entries(names)
                .filter(([v]) => v !== "OTHER")
                .map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
            </select>
          </Label>
          <Label title="账号昵称">
            <input
              className={inputClass}
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Label>
          <button
            className={buttonClass}
            disabled={busy || !title.trim()}
            onClick={() =>
              void action(async () => {
                await write("accounts", {
                  platform,
                  displayName: title,
                  mode: "MANUAL",
                });
                setNotice("人工账号已添加，尚未完成平台认证");
              })
            }
          >
            添加人工账号
          </button>
          <button
            className={buttonClass}
            disabled
            title="官方权限和授权连接器未核验"
          >
            自动授权暂不可用
          </button>
        </Panel>
      )}
      {mode !== "detail" && (
        <Panel
          title={
            mode === "trends"
              ? "已导入来源"
              : mode === "accounts"
                ? "发布账号"
                : mode === "publications"
                  ? "排期与发布记录"
                  : "作品列表"
          }
        >
          {mode === "videos" && (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                setFilter(listFilter.trim());
              }}
            >
              <Label title="搜索作品">
                <input
                  className={inputClass}
                  placeholder="搜索标题或选题"
                  maxLength={200}
                  value={listFilter}
                  onChange={(event) => setListFilter(event.target.value)}
                />
              </Label>
              <Label title="创作进度">
                <select
                  className={inputClass}
                  value={videoStatus}
                  onChange={(event) => setVideoStatus(event.target.value)}
                >
                  <option value="">全部进度</option>
                  <option value="DRAFT">草稿</option>
                  <option value="SCRIPTED">待生成</option>
                  <option value="READY">有成片</option>
                </select>
              </Label>
              <button className={`${secondaryClass} self-end`} type="submit">
                <Search className="size-4" aria-hidden="true" />
                搜索作品
              </button>
            </form>
          )}
          {!items.length && !loading && (
            <p>
              暂无记录。
              {mode === "publications"
                ? "请先在作品详情创建审核快照。"
                : "可使用上方表单创建。"}
            </p>
          )}
          {items.map((item) => (
            <article
              key={item.id}
              className="border-border space-y-2 border-b py-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {item.title ||
                    item.displayName ||
                    item.summary ||
                    item.payload?.title}
                </strong>
                <span>
                  {mode === "videos" && item.workflowStatus && (
                    <Badge variant="secondary" className="mr-2">
                      {
                        { DRAFT: "草稿", SCRIPTED: "待生成", READY: "有成片" }[
                          item.workflowStatus
                        ]
                      }
                    </Badge>
                  )}
                  {names[item.platform || item.account?.platform || ""]}{" "}
                  {statuses[item.status || item.runs?.[0]?.status || ""] ||
                    item.status}
                </span>
              </div>
              {mode === "videos" && item.currentArtifactId && (
                <VideoThumbnail artifactId={item.currentArtifactId} />
              )}
              {mode === "videos" && item.brief && (
                <p className="text-muted-foreground line-clamp-2 text-sm">
                  {item.brief}
                </p>
              )}
              {mode === "videos" && (
                <Link
                  className="text-primary underline"
                  href={`/short-videos/${item.id}`}
                >
                  进入创作
                </Link>
              )}
              {mode === "trends" && (
                <>
                  <p>{item.summary}</p>
                  {item.originalUrl && (
                    <a
                      className="text-primary break-all underline"
                      href={item.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原链接
                    </a>
                  )}
                  <p className="text-sm">
                    采集：{time(item.observedAt)} · {item.ingestionMode} ·
                    指标：{item.metrics ? JSON.stringify(item.metrics) : "未知"}
                  </p>
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void createFromSource(item)}
                  >
                    从此来源创建作品
                  </button>
                </>
              )}
              {mode === "accounts" && (
                <>
                  <p>
                    {statuses[item.mode || ""] || item.mode} ·{" "}
                    {item.capabilitySnapshot?.reason}
                  </p>
                  <button
                    className={buttonClass}
                    disabled={busy || !!item.disabledAt}
                    onClick={() =>
                      void action(async () => {
                        await write(`accounts/${item.id}/disconnect`, {
                          expectedVersion: item.version,
                        });
                      })
                    }
                  >
                    断开账号
                  </button>
                </>
              )}
              {mode === "publications" && (
                <>
                  <p>
                    账号：{item.account?.displayName} · 计划提交：
                    {time(item.scheduledAt, item.displayTimeZone)}（
                    {item.displayTimeZone}）
                  </p>
                  {item.externalUrl && (
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      作品链接（人工任务为用户回填）
                    </a>
                  )}
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setPublication(
                          await read<Item>(`publications/${item.id}`)
                        )
                      )
                    }
                  >
                    打开审核与排期
                  </button>
                </>
              )}
            </article>
          ))}
          {cursor && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await read<{
                    items: Item[];
                    nextCursor: string | null;
                  }>(
                    `${listEndpoint()}${listEndpoint().includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
                  );
                  setItems((old) => [...old, ...result.items]);
                  setCursor(result.nextCursor);
                }, false)
              }
            >
              加载更多
            </button>
          )}
        </Panel>
      )}
      {mode === "detail" && video && (
        <>
          <Panel title={`作品：${video.title}`}>
            <p>
              {video.brief} · 版本 {video.version}
            </p>
            {video.sources?.map((s) => (
              <p key={s.source.id}>来源：{s.source.summary}</p>
            ))}
            <Label title="更新标题">
              <input
                className={inputClass}
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Label>
            <button
              className={buttonClass}
              disabled={busy || !title.trim()}
              onClick={() =>
                void action(async () => {
                  await write(
                    `videos/${id}`,
                    { title: title.trim(), expectedVersion: video.version },
                    "PATCH"
                  );
                  setNotice("作品标题已保存");
                })
              }
            >
              保存标题
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (
                    !window.confirm(
                      "归档后作品将从列表隐藏，已有任务与发布记录仍保留。确认归档？"
                    )
                  )
                    return;
                  await write(
                    `videos/${id}`,
                    { archived: true, expectedVersion: video.version },
                    "PATCH"
                  );
                  router.push("/short-videos");
                })
              }
            >
              归档作品
            </button>
          </Panel>
          <Panel id="sv-script" title="1 · 脚本与版本">
            <p>模型改编先创建计划并单独确认，不会自动开始生成视频。</p>
            <Label title="脚本改编模板">
              <select
                className={inputClass}
                value={templateId}
                disabled={busy}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">请选择模板</option>
                {templates
                  .filter((template) => template.enabled !== false)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name || template.title}
                    </option>
                  ))}
              </select>
            </Label>
            <button
              className={secondaryClass}
              disabled={busy || !templateId || templateId === video.templateId}
              onClick={() =>
                void action(async () => {
                  await write(
                    `videos/${id}`,
                    { templateId, expectedVersion: video.version },
                    "PATCH"
                  );
                  setNotice("改编模板已保存，可以查看脚本改编计划");
                })
              }
            >
              保存改编模板
            </button>
            {modelSelect("LLM", llm, setLlm)}
            {!models.some((model) => model.provider.category === "LLM") && (
              <p className="text-muted-foreground text-sm">
                还没有可用的文本模型。可先手写脚本，或前往{" "}
                <Link
                  href="/settings/ai-models"
                  className="text-primary underline"
                >
                  AI 模型设置
                </Link>{" "}
                添加并验证。
              </p>
            )}
            <button
              className={buttonClass}
              disabled={busy || !llm || !video.template}
              onClick={() =>
                void action(async () =>
                  acceptRun(
                    await write<Run>(`videos/${id}/script-runs`, {
                      llmConfigId: llm,
                      templateVersion: video.template!.version,
                      expectedVideoVersion: video.version,
                    })
                  )
                )
              }
            >
              查看脚本改编计划
            </button>
            {!video.template && (
              <p>
                先选择并保存上方改编模板，即可用文本模型继续创作；也可以直接手写脚本。
              </p>
            )}
            <Label title="脚本版本">
              <select
                className={inputClass}
                value={scriptId}
                onChange={(e) => {
                  if (
                    scriptDirty &&
                    !window.confirm("切换版本会替换尚未保存的脚本，确定继续？")
                  )
                    return;
                  setScriptId(e.target.value);
                  setScriptDirty(false);
                  setScriptText(
                    JSON.stringify(
                      video.scripts?.find((s) => s.id === e.target.value)
                        ?.content || {},
                      null,
                      2
                    )
                  );
                }}
              >
                <option value="">选择已有版本或手动输入</option>
                {video.scripts?.map((s) => (
                  <option key={s.id} value={s.id}>
                    v{s.version} ·{" "}
                    {s.origin === "MANUAL" ? "手工编写" : "模型改编"}
                  </option>
                ))}
              </select>
            </Label>
            <ScriptEditor
              value={scriptText}
              title={video.title || ""}
              brief={video.brief || ""}
              disabled={busy}
              onChange={(value) => {
                setScriptText(value);
                setScriptDirty(true);
              }}
            />
            <p className="text-muted-foreground text-sm">
              9:16 竖屏 · 1–5 镜 · 总时长 15–30
              秒。每个镜头填写首帧和视频动作，角色可跨镜头复用。
            </p>
            {scriptDirty && (
              <p role="status" className="text-primary text-sm">
                有未保存的脚本修改，保存后再创建生成计划。
              </p>
            )}
            <button
              className={buttonClass}
              disabled={
                busy || !scriptText || !!scriptValidationMessage(scriptText)
              }
              onClick={() =>
                void action(async () => {
                  const content = ScriptZ.parse(JSON.parse(scriptText));
                  const saved = await write<Script>(`videos/${id}/scripts`, {
                    expectedVideoVersion: video.version,
                    content,
                  });
                  setScriptId(saved.id);
                  setScriptDirty(false);
                  setNotice("新脚本版本已保存，旧版本保留");
                })
              }
            >
              保存为新版本
            </button>
          </Panel>
          <Panel id="sv-generation" title="2 · 生成计划与预算">
            {modelSelect("IMAGE", image, setImage)}
            {modelSelect("VIDEO", videoModel, setVideoModel)}
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
              />
              启用配音
            </label>
            {ttsEnabled && modelSelect("TTS", tts, setTts)}
            <Label title="站内积分上限">
              <input
                className={inputClass}
                type="number"
                min={0}
                max={100000}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </Label>
            <button
              className={buttonClass}
              disabled={
                busy ||
                !scriptId ||
                scriptDirty ||
                !image ||
                !videoModel ||
                (ttsEnabled && !tts)
              }
              onClick={() =>
                void action(async () =>
                  acceptRun(
                    await write<Run>(`videos/${id}/render-plans`, {
                      scriptVersionId: scriptId,
                      modelConfigIds: {
                        image,
                        video: videoModel,
                        tts: ttsEnabled ? tts : null,
                      },
                      ttsEnabled,
                      maxCredits: budget,
                    })
                  )
                )
              }
            >
              查看生成计划
            </button>
          </Panel>
          {run && (
            <Panel title={`任务 · ${statuses[run.status] || run.status}`}>
              <p className="text-muted-foreground text-sm">
                {statuses[run.kind] || run.kind} ·
                可离开页面，任务状态将自动更新
              </p>
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer">任务编号</summary>
                <p className="mt-2 break-all">{run.id}</p>
              </details>
              <p>
                积分：已用 {run.spentCredits} / 预留 {run.reservedCredits} /
                上限 {run.maxCredits}
              </p>
              <p>
                计划上限：{run.plan.upperBoundCredits} 积分。
                {run.plan.supplierFees}
              </p>
              {run.plan.estimatedDuration && (
                <p>
                  各镜预计秒数：{run.plan.estimatedDuration.join("、")}
                  ；最终时长以媒体探测为准。
                </p>
              )}
              {run.plan.models.map((m) => (
                <p key={m.id}>
                  {statuses[m.category] || m.category}：{m.model}
                </p>
              ))}
              {run.errorSummary && <p role="status">{run.errorSummary}</p>}
              <ol className="list-inside list-decimal">
                {run.steps?.map((s) => (
                  <li key={s.id}>
                    {s.key}：{statuses[s.status] || s.status} · 上限
                    {s.estimatedCredits} / 实扣{s.actualCredits ?? "未结算"}
                  </li>
                ))}
              </ol>
              {run.status === "PLANNED" && !caps?.autoSubmitEnabled && (
                <p className="text-muted-foreground bg-muted/40 rounded-lg p-3 text-sm">
                  当前暂停付费生成，可保留此计划，或上传已完成的视频继续审核与人工发布。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {[
                  ...(run.status === "PLANNED" ? ["confirm"] : []),
                  ...([
                    "QUEUED",
                    "RUNNING",
                    "PAUSED",
                    "NEEDS_RECONCILIATION",
                    "STOPPING",
                  ].includes(run.status)
                    ? ["stop"]
                    : []),
                  ...(run.status === "PAUSED" ? ["resume"] : []),
                  ...(["NEEDS_RECONCILIATION", "STOPPING"].includes(run.status)
                    ? ["reconcile"]
                    : []),
                ].map((a) => (
                  <button
                    key={a}
                    className={buttonClass}
                    disabled={
                      busy || (a === "confirm" && !caps?.autoSubmitEnabled)
                    }
                    onClick={() =>
                      void action(async () =>
                        acceptRun(
                          await write<Run>(`runs/${run.id}/actions`, {
                            action: a,
                            expectedVersion: run.version,
                            ...(a === "confirm"
                              ? { planHash: run.planHash }
                              : {}),
                          })
                        )
                      )
                    }
                  >
                    {
                      {
                        confirm: "确认此计划并执行（可能产生上游费用）",
                        stop: "停止后续步骤",
                        resume: "恢复原计划",
                        reconcile: "核对原任务",
                      }[a]
                    }
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel id="sv-artifacts" title="3 · 上传成片或查看素材">
            <Label title="素材类型">
              <select
                className={inputClass}
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value)}
              >
                <option value="VIDEO">MP4 成片</option>
                <option value="COVER">封面图片</option>
              </select>
            </Label>
            <Label title="选择素材">
              <input
                className={inputClass}
                type="file"
                accept={
                  uploadKind === "VIDEO"
                    ? "video/mp4"
                    : "image/jpeg,image/png,image/webp"
                }
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Label>
            <Label title="我确认素材使用权限，备注">
              <input
                className={inputClass}
                value={rights}
                maxLength={1000}
                onChange={(e) => setRights(e.target.value)}
              />
            </Label>
            <button
              className={buttonClass}
              disabled={busy || !file || !rights}
              onClick={() =>
                void action(async () => {
                  const form = new FormData();
                  form.set("requestId", crypto.randomUUID());
                  form.set("kind", uploadKind);
                  form.set("rightsNote", rights);
                  form.set("file", file!);
                  const response = await fetch(
                    `/api/short-videos/videos/${id}/artifacts/upload`,
                    { method: "POST", body: form }
                  );
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(data.error?.message || "上传失败");
                  if (data.kind === "COVER" || data.kind === "IMAGE")
                    setCoverId(data.id);
                  else if (data.kind === "VIDEO") setArtifactId(data.id);
                  setNotice("素材已持久化并通过媒体检查，尚未审核");
                })
              }
            >
              上传并检查素材
            </button>
            <p className="text-sm">
              MP4上限200MiB、封面10MiB；只按实际媒体检查通过的素材发布。
            </p>
            {video.artifacts?.map((a) => (
              <article key={a.id} className="border-border border-b py-2">
                <p>
                  v{a.version} · {statuses[a.kind] || a.kind} ·{" "}
                  {a.durationMs ? `${a.durationMs / 1000}秒` : "时长不适用"} ·{" "}
                  {a.width}×{a.height} · {a.bytes} bytes · {a.storageBackend}
                </p>
                {a.kind === "VIDEO" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const access = await read<{ url: string }>(
                          `artifacts/${a.id}/access`
                        );
                        setPreview(access.url);
                        setArtifactId(a.id);
                      })
                    }
                  >
                    预览此版本
                  </button>
                )}
              </article>
            ))}
            {preview && (
              <video
                aria-label="成片预览"
                controls
                className="max-h-96 w-full"
                src={preview}
              />
            )}
          </Panel>
          <Panel id="sv-review" title="4 · 创建审核快照">
            <Label title="成片版本">
              <select
                className={inputClass}
                value={artifactId}
                onChange={(e) => setArtifactId(e.target.value)}
              >
                <option value="">选择成片</option>
                {video.artifacts
                  ?.filter((a) => a.kind === "VIDEO")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      v{a.version} · {a.bytes} bytes
                    </option>
                  ))}
              </select>
            </Label>
            <Label title="目标账号">
              <select
                className={inputClass}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">选择人工账号</option>
                {accounts
                  .filter((a) => !a.disabledAt)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {names[a.platform!]} / {a.displayName}
                    </option>
                  ))}
              </select>
            </Label>
            {!accounts.some((account) => !account.disabledAt) && (
              <p className="text-muted-foreground text-sm">
                还没有发布账号，先添加一个人工账号即可继续。
              </p>
            )}
            <Link
              className="text-primary underline"
              href="/short-videos/accounts"
            >
              管理发布账号
            </Link>
            <Label title="发布模式">
              <select
                className={inputClass}
                value={publicationMode}
                onChange={(e) => setPublicationMode(e.target.value)}
              >
                <option value="MANUAL">人工发布</option>
                <option
                  value="AUTO"
                  disabled={
                    !accounts.some(
                      (a) =>
                        a.id === accountId &&
                        a.status === "CONNECTED" &&
                        caps?.platforms.some(
                          (c) =>
                            c.platform === a.platform &&
                            c.publish === "VERIFIED"
                        )
                    )
                  }
                >
                  自动发布（需平台核验及账号授权）
                </option>
              </select>
            </Label>
            <Label title="发布标题">
              <input
                className={inputClass}
                value={publicationTitle}
                maxLength={80}
                placeholder={video.title}
                onChange={(e) => setPublicationTitle(e.target.value)}
              />
            </Label>
            <Label title="发布文案">
              <textarea
                className={inputClass}
                value={caption}
                maxLength={4000}
                onChange={(e) => setCaption(e.target.value)}
              />
            </Label>
            <Label title="话题（逗号分隔）">
              <input
                className={inputClass}
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
              />
            </Label>
            <Label title="封面">
              <select
                className={inputClass}
                value={coverId}
                onChange={(e) => setCoverId(e.target.value)}
              >
                <option value="">不指定封面</option>
                {video.artifacts
                  ?.filter((a) => ["IMAGE", "COVER"].includes(a.kind))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      封面v{a.version}
                    </option>
                  ))}
              </select>
            </Label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={aiGenerated}
                onChange={(e) => setAiGenerated(e.target.checked)}
              />
              AI生成内容声明
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={commercial}
                onChange={(e) => setCommercial(e.target.checked)}
              />
              商业内容声明
            </label>
            <button
              className={buttonClass}
              disabled={busy || !accountId || !artifactId}
              onClick={() =>
                void action(async () => {
                  const payload = PublicationPayloadZ.parse({
                    title: publicationTitle || video.title,
                    text: caption,
                    hashtags: hashtags
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    coverArtifactId: coverId || null,
                    aiGenerated,
                    commercial,
                  });
                  setPublication(
                    await write<Item>("publications", {
                      videoId: id,
                      accountId,
                      artifactId,
                      payload,
                      mode: publicationMode,
                    })
                  );
                })
              }
            >
              创建待审快照
            </button>
          </Panel>
        </>
      )}
      {publication && (
        <Panel
          title={`审核与排期 · ${statuses[publication.status!] || publication.status}`}
        >
          <p>
            {publication.payload?.title} · 目标账号{" "}
            {publication.account?.displayName} /{" "}
            {names[publication.account?.platform || ""]}
          </p>
          <p className="whitespace-pre-wrap">{publication.payload?.text}</p>
          <p>
            {publication.payload?.hashtags.join("、")} · AI声明{" "}
            {publication.payload?.aiGenerated ? "是" : "否"} · 商业声明{" "}
            {publication.payload?.commercial ? "是" : "否"}
          </p>
          <p className="text-xs break-all">
            快照摘要：{publication.reviewHash}
          </p>
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const access = await read<{ url: string }>(
                  `artifacts/${publication.artifactId}/access`
                );
                setPreview(access.url);
              })
            }
          >
            预览待审视频
          </button>
          {preview && (
            <video
              aria-label="审核视频预览"
              className="max-h-80 w-full"
              src={preview}
              controls
            />
          )}
          {publication.status === "DRAFT" && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void publicationAction("approve")}
            >
              批准此快照
            </button>
          )}
          {publication.status === "APPROVED" && (
            <>
              <p className="text-muted-foreground text-sm">
                选择快捷时间，或填写含时区的时间；排期至少在 60
                秒后。人工模式到时提醒发布，需下载发布包后自行上传平台。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={busy}
                  onClick={() =>
                    setSchedule(
                      new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    )
                  }
                >
                  1 小时后
                </button>
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={busy}
                  onClick={() =>
                    setSchedule(
                      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                    )
                  }
                >
                  明天此时
                </button>
              </div>
              <Label title="计划提交时间（含时区）">
                <input
                  className={inputClass}
                  value={schedule}
                  placeholder="YYYY-MM-DDTHH:mm:ss+08:00"
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </Label>
              {schedule && !Number.isNaN(Date.parse(schedule)) && (
                <p className="text-primary text-sm">
                  所选时间：{time(schedule, zone)}（{zone}）
                </p>
              )}
              <Label title="展示时区">
                <input
                  className={inputClass}
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </Label>
              <button
                className={buttonClass}
                disabled={busy || !schedule}
                onClick={() => void publicationAction("schedule")}
              >
                保存排期
              </button>
            </>
          )}
          <p>
            计划提交：
            {time(publication.scheduledAt, publication.displayTimeZone)}（
            {publication.displayTimeZone || "Asia/Shanghai"}）
          </p>
          {[
            "DRAFT",
            "APPROVED",
            "SCHEDULED",
            "CLAIMED",
            "AWAITING_MANUAL",
            "BLOCKED",
          ].includes(publication.status!) && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void publicationAction("cancel")}
            >
              取消未提交任务
            </button>
          )}
          <a
            className="text-primary block underline"
            href={`/api/short-videos/publications/${publication.id}/export`}
          >
            下载人工发布包（视频、文案、封面、清单）
          </a>
          {publication.status === "AWAITING_MANUAL" && (
            <>
              <Label title="平台公开作品链接">
                <input
                  className={inputClass}
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                />
              </Label>
              <button
                type="button"
                className={secondaryClass}
                disabled={busy}
                onClick={() => setPublishedAt(new Date().toISOString())}
              >
                填入当前时间
              </button>
              <Label title="真实发布时间（含时区）">
                <input
                  className={inputClass}
                  value={publishedAt}
                  placeholder="YYYY-MM-DDTHH:mm:ss+08:00"
                  onChange={(e) => setPublishedAt(e.target.value)}
                />
              </Label>
              <button
                className={buttonClass}
                disabled={busy || !externalUrl || !publishedAt}
                onClick={() => void publicationAction("mark_manual_published")}
              >
                登记人工发布结果（用户回填）
              </button>
            </>
          )}
          {publication.status === "PUBLISHED" && (
            <>
              <p>
                发布结果：
                {publication.mode === "MANUAL"
                  ? "USER_REPORTED · 用户回填"
                  : "平台核验"}{" "}
                · {time(publication.publishedAt)}
              </p>
              {publication.externalUrl && (
                <a
                  className="text-primary underline"
                  href={publication.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看平台作品
                </a>
              )}
              <PublicationMetrics
                key={publication.id}
                publicationId={publication.id}
                userId={caps?.userId || "current"}
                read={read}
                write={write}
              />
            </>
          )}
          {["PROCESSING", "SUBMITTING", "NEEDS_RECONCILIATION"].includes(
            publication.status!
          ) && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void publicationAction("reconcile")}
            >
              仅核对原发布任务
            </button>
          )}
        </Panel>
      )}
    </div>
  );
}
