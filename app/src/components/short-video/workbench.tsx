"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HotDiscovery } from "./hot-discovery";
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
  status?: string;
  mode?: string;
  capabilitySnapshot?: { reason: string };
  disabledAt?: string | null;
  brief?: string;
  templateId?: string;
  currentArtifactId?: string;
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
  "border-border bg-background w-full rounded border p-2 text-sm";
const buttonClass =
  "bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50";
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
  return (
    <label className="block space-y-1">
      <span className="text-sm">{title}</span>
      {children}
    </label>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function time(value?: string, zone = "Asia/Shanghai") {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(value))
    : "未排期";
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
  const [hashtags, setHashtags] = useState("");
  const [commercial, setCommercial] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [zone, setZone] = useState("Asia/Shanghai");
  const [externalUrl, setExternalUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [metricText, setMetricText] = useState("{}");
  const [metricWindow, setMetricWindow] = useState("CUSTOM");
  const pending = useRef(
    new Map<string, { input: string; requestId: string }>()
  );
  const load = useCallback(async () => {
    const capability = await read<Capability>("capabilities");
    setCaps(capability);
    if (mode === "detail" && id) {
      const detail = await read<Item>(`videos/${id}`);
      setVideo(detail);
      const latest = detail.runs?.[0];
      if (latest) setRun(await read<Run>(`runs/${latest.id}`));
      const [m, a] = await Promise.all([
        read<{ items: Model[] }>("models"),
        read<{ items: Item[] }>("accounts?limit=100"),
      ]);
      setModels(m.items);
      setAccounts(a.items);
    } else {
      const endpoint =
        mode === "trends"
          ? `sources?q=${encodeURIComponent(filter)}${sourcePlatform ? `&platform=${sourcePlatform}` : ""}`
          : mode;
      const result = await read<{ items: Item[]; nextCursor: string | null }>(
        endpoint
      );
      setItems(result.items);
      setCursor(result.nextCursor);
      if (mode === "videos" || mode === "trends")
        setTemplates(
          (await read<{ items: Item[] }>("templates?limit=100")).items
        );
    }
  }, [mode, id, filter, sourcePlatform]);
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
      void load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load, mode]);
  const action = async (fn: () => Promise<void>, reload = true) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (reload) await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重新读取状态");
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
      <option value="">请选择{category}模型</option>
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={buttonClass}
          disabled={busy}
          onClick={() => void refresh()}
        >
          重新读取状态
        </button>
        {loading && <span role="status">加载中…</span>}
        {busy && <span role="status">保存中…</span>}
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-500 p-3">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {caps && (
        <p className="text-muted-foreground text-sm">
          {caps.platforms.some(
            (c) => c.publish === "VERIFIED" || c.discovery === "VERIFIED"
          )
            ? "按已核验连接器能力执行。"
            : "当前为人工导入与人工发布模式。"}
          自动提交开关：
          {caps.autoSubmitEnabled ? "开启（每份计划仍需确认）" : "关闭"}
          。供应方费用未取得账单；计划时间为提交时间。
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
            disabled={busy || !title}
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
                {names[c.platform]}：搜索 {c.discovery} · 发布 {c.publish} ·{" "}
                {c.reason}
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
              disabled={busy || !summary}
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
            disabled={busy || !title}
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
                  {names[item.platform || item.account?.platform || ""]}{" "}
                  {statuses[item.status || item.runs?.[0]?.status || ""] ||
                    item.status}
                </span>
              </div>
              {mode === "videos" && item.currentArtifactId && (
                <VideoThumbnail artifactId={item.currentArtifactId} />
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
                    {item.mode} · {item.capabilitySnapshot?.reason}
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
                    `${mode === "trends" ? "sources" : mode}?cursor=${encodeURIComponent(cursor)}${mode === "trends" ? `&q=${encodeURIComponent(filter)}` : ""}`
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
                onChange={(e) => setTitle(e.target.value)}
              />
            </Label>
            <button
              className={buttonClass}
              disabled={busy || !title}
              onClick={() =>
                void action(async () => {
                  await write(
                    `videos/${id}`,
                    { title, expectedVersion: video.version },
                    "PATCH"
                  );
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
          <Panel title="1 · 脚本与版本">
            <p>模型改编先创建计划并单独确认，不会自动开始生成视频。</p>
            {modelSelect("LLM", llm, setLlm)}
            <button
              className={buttonClass}
              disabled={busy || !llm || !video.template}
              onClick={() =>
                void action(async () =>
                  setRun(
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
                此作品未选模板，可先手动填写脚本；从作品列表创建时可选模板。
              </p>
            )}
            <Label title="脚本版本">
              <select
                className={inputClass}
                value={scriptId}
                onChange={(e) => {
                  setScriptId(e.target.value);
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
                    v{s.version} · {s.origin}
                  </option>
                ))}
              </select>
            </Label>
            <Label title="结构化脚本 JSON">
              <textarea
                className={`${inputClass} min-h-64 font-mono`}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
              />
            </Label>
            <p className="text-sm">
              schemaVersion=1，9:16，1–5镜、总时长15–30秒；角色引用与镜头时长须一致。
            </p>
            <button
              className={buttonClass}
              disabled={busy || !scriptText}
              onClick={() =>
                void action(async () => {
                  const content = ScriptZ.parse(JSON.parse(scriptText));
                  const saved = await write<Script>(`videos/${id}/scripts`, {
                    expectedVideoVersion: video.version,
                    content,
                  });
                  setScriptId(saved.id);
                  setNotice("新脚本版本已保存，旧版本保留");
                })
              }
            >
              保存为新版本
            </button>
          </Panel>
          <Panel title="2 · 生成计划与预算">
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
                !image ||
                !videoModel ||
                (ttsEnabled && !tts)
              }
              onClick={() =>
                void action(async () =>
                  setRun(
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
              <p>编号：{run.id}</p>
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
                  {m.category}：{m.model}（{m.id}）
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
                        setRun(
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
          <Panel title="3 · 上传成片或查看素材">
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
                  setArtifactId(data.id);
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
                  v{a.version} · {a.kind} ·{" "}
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
          <Panel title="4 · 创建审核快照">
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
                value={title}
                maxLength={80}
                placeholder={video.title}
                onChange={(e) => setTitle(e.target.value)}
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
                    title: title || video.title,
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
            <button className={buttonClass} disabled title="平台自动权限未核验">
              AUTO暂不可用
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
              <p>
                使用带UTC偏移的时间，例如
                2026-11-20T20:00:00+08:00；至少60秒后提交。
              </p>
              <Label title="计划提交时间（含时区）">
                <input
                  className={inputClass}
                  value={schedule}
                  placeholder="2026-11-20T20:00:00+08:00"
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </Label>
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
              <Label title="真实发布时间（含时区）">
                <input
                  className={inputClass}
                  value={publishedAt}
                  placeholder="2026-11-19T20:00:00+08:00"
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
              <Label title="指标窗口">
                <select
                  className={inputClass}
                  value={metricWindow}
                  onChange={(e) => setMetricWindow(e.target.value)}
                >
                  {["H24", "H72", "CUSTOM"].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </Label>
              <Label title="指标JSON（如 views、likes；未知留空对象）">
                <textarea
                  className={inputClass}
                  value={metricText}
                  onChange={(e) => setMetricText(e.target.value)}
                />
              </Label>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await write(`publications/${publication.id}/metrics`, {
                      observedAt: new Date().toISOString(),
                      windowLabel: metricWindow,
                      metrics: JSON.parse(metricText),
                    });
                    setNotice("指标快照已保存；未填写的指标保持未知");
                  })
                }
              >
                保存指标快照
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await read<{ items: unknown[] }>(
                      `publications/${publication.id}/metrics`
                    );
                    setNotice(JSON.stringify(result.items));
                  })
                }
              >
                读取指标记录
              </button>
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
