"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HotReportZ,
  type HotReport,
  type HotIdea,
  type HotPlatform,
} from "@/lib/short-video/hot-discovery";
import { ScriptZ } from "@/lib/short-video/contracts";
const names = { DOUYIN: "抖音", KUAISHOU: "快手", XIAOHONGSHU: "小红书" };
const fieldClass =
  "border-border bg-background w-full rounded border p-2 text-sm";
const buttonClass =
  "bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50";
type Job = {
  id: string;
  status: string;
  report: HotReport | null;
  requestedAt: string;
  errorSummary: string | null;
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
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "热点服务暂时不可用");
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
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HotIdea | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [savedVideoId, setSavedVideoId] = useState("");
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const saveIds = useRef(new Map<string, string>());
  const reading = useRef(false);
  const readLatest = useCallback(async () => {
    const result = await api<{ item: Job | null }>("hot-briefs");
    setJob(result.item);
    setError("");
  }, []);
  useEffect(() => {
    let active = true;
    void api<{ item: Job | null }>("hot-briefs")
      .then((r) => {
        if (active) setJob(r.item);
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
  }, []);
  const pending =
    busy || (!!job && ["PENDING", "RUNNING"].includes(job.status));
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
          if (active) {
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
    setBusy(true);
    setError("");
    setSelected(null);
    setSavedVideoId("");
    const input = { query, platforms, style, windowDays };
    const fingerprint = JSON.stringify(input);
    let prior = requestRef.current;
    try {
      const raw = sessionStorage.getItem("short-video-hot-pending");
      if (!prior && raw) prior = JSON.parse(raw);
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
      setJob(await api<Job>("hot-briefs", { ...input, requestId }));
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
  const report = job?.report ? HotReportZ.parse(job.report) : null;
  const choose = (idea: HotIdea) => {
    setSelected(idea);
    setScriptText(JSON.stringify(idea.script, null, 2));
    setSavedVideoId("");
  };
  const save = async () => {
    if (!selected || !job) return;
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
      className="border-border space-y-5 rounded-lg border p-4"
      aria-label="热点搜索与抽象创意"
    >
      <div>
        <h2 className="text-lg font-semibold">先搜热点，再决定做哪条</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          读取公开来源，为近期话题提供原创反差草案。搜索和草案不调用付费模型；无有效来源时直接显示原因。
        </p>
      </div>
      <label className="block space-y-1">
        <span>想找什么梗</span>
        <textarea
          className={fieldClass}
          value={query}
          maxLength={500}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <fieldset className="flex flex-wrap gap-4">
        <legend>搜索平台</legend>
        {Object.entries(names).map(([platform, name]) => (
          <label key={platform} className="flex items-center gap-2">
            <input
              type="checkbox"
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
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span>改编画风</span>
          <select
            className={fieldClass}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            <option value="XIANXIA">修仙反差</option>
            <option value="ANIMALS">动物打工</option>
            <option value="DAILY">荒诞日常</option>
          </select>
        </label>
        <label className="space-y-1">
          <span>来源更新范围</span>
          <select
            className={fieldClass}
            value={windowDays}
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
      <div className="flex flex-wrap gap-3">
        <button
          className={buttonClass}
          disabled={pending || !platforms.length || !query.trim()}
          onClick={() => void search()}
        >
          {pending ? "搜索进行中…" : "搜索最新梗与改编点子"}
        </button>
        <button
          className={buttonClass}
          disabled={busy}
          onClick={() => void readLatest().catch((e) => setError(e.message))}
        >
          读取最近搜索
        </button>
      </div>
      {loading && <p role="status">读取最近的热点任务…</p>}
      {error && (
        <p role="alert" className="rounded border border-red-500 p-3">
          {error}
        </p>
      )}
      {job && ["PENDING", "RUNNING"].includes(job.status) && (
        <p role="status">
          {job.status === "PENDING"
            ? "等待后台读取公开来源"
            : "正在核对榜单与来源时间"}
          。可关闭页面，回来后继续读取；通常需10–30秒。长时间未更新可点击“读取最近搜索”。
        </p>
      )}
      {job?.status === "FAILED" && (
        <p role="alert">
          {job.errorSummary || "搜索未完成，可以重新创建一次搜索。"}
        </p>
      )}
      {report && (
        <>
          <p
            className="rounded bg-slate-500/10 p-3 whitespace-pre-wrap"
            role="status"
          >
            {report.summary}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {report.sources.map((source) => (
              <article
                key={source.platform}
                className="border-border space-y-1 rounded border p-3"
              >
                <strong>
                  {names[source.platform]} ·{" "}
                  {source.status === "AVAILABLE"
                    ? "取得快照"
                    : source.status === "PARTIAL"
                      ? "部分候选待核验"
                      : "暂未取得"}
                </strong>
                <p className="text-sm">{source.reason}</p>
                <p className="text-xs">采集：{displayTime(source.fetchedAt)}</p>
                {source.sourceUrl && (
                  <a
                    className="text-primary text-sm underline"
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看数据来源
                  </a>
                )}
              </article>
            ))}
          </div>
          {!!report.ideas.length && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="min-w-44 p-2">本轮快照里的话题</th>
                    <th className="min-w-72 p-2">可以做的原创抽象版本</th>
                    <th className="p-2">创作</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ideas.map((idea) => {
                    const topic = report.topics.find(
                      (t) => t.id === idea.topicId
                    )!;
                    return (
                      <tr key={idea.id} className="border-border border-b">
                        <td className="space-y-2 p-2 align-top">
                          <a
                            href={topic.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            {topic.title}
                          </a>
                          <p>
                            {names[topic.platform]} · {topic.sourceName}
                          </p>
                          <p>
                            来源更新：{displayTime(topic.snapshotAt)}
                            {topic.timeBasis === "RELATIVE" ? "（估计）" : ""}
                          </p>
                          <p>
                            {topic.rank
                              ? `该快照排名 ${topic.rank}`
                              : "未取得排名"}
                            {topic.heatLabel
                              ? ` · 来源热度 ${topic.heatLabel}`
                              : ""}
                          </p>
                        </td>
                        <td className="space-y-2 p-2 align-top">
                          <strong>
                            《{idea.title}》
                            {idea.id === report.recommendation
                              ? " · 本轮优先"
                              : ""}
                          </strong>
                          <p>{idea.outline}</p>
                          <p className="text-muted-foreground">
                            {idea.durationSec}秒 · 两镜 · 难度{idea.difficulty}
                          </p>
                        </td>
                        <td className="p-2 align-top">
                          <button
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => choose(idea)}
                          >
                            展开分镜
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!report.ideas.length && (
            <p>
              这轮没有足够新鲜、适合日常反差的选题。可以调整范围，或核对下方来源。
            </p>
          )}
          <details>
            <summary>
              全部来源话题与核验说明（{report.topics.length}条）
            </summary>
            <ul className="mt-3 space-y-2">
              {report.topics.map((topic) => (
                <li key={`${topic.platform}:${topic.id}`}>
                  <a
                    className="text-primary underline"
                    href={topic.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {topic.title}
                  </a>{" "}
                  · {names[topic.platform]} · 来源更新
                  {displayTime(topic.snapshotAt)}
                  {topic.evidenceKind === "WEB_SEARCH"
                    ? " · 网页候选，未核验是否在榜"
                    : ""}
                </li>
              ))}
            </ul>
            {report.notes.map((note) => (
              <p key={note} className="text-muted-foreground mt-2 text-sm">
                {note}
              </p>
            ))}
          </details>
        </>
      )}
      {selected && (
        <section className="border-border space-y-3 border-t pt-4">
          <h3 className="font-semibold">《{selected.title}》· 可编辑草案</h3>
          <p>首帧：{selected.firstFrame}</p>
          <p>{selected.rationale}</p>
          <ol className="list-inside list-decimal space-y-2">
            {selected.script.shots.map((shot) => (
              <li key={shot.key}>
                {shot.durationSec}秒：{shot.description}；动作：
                {shot.videoPrompt}；对白：“{shot.dialogue}”；字幕：“
                {shot.subtitle}”
              </li>
            ))}
          </ol>
          <p className="text-sm">
            首帧与动作分开做，每镜只安排一个动作；对白和字幕后期配。这里采用20秒有效脚本，保存后仍需单独查看模型和积分计划。
          </p>
          <label className="block space-y-1">
            <span>编辑结构化草案</span>
            <textarea
              className={`${fieldClass} min-h-48 font-mono`}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
            />
          </label>
          <button
            className={buttonClass}
            disabled={busy || !!savedVideoId}
            onClick={() => void save()}
          >
            保存来源与草案到作品
          </button>
          {savedVideoId && (
            <button
              className={buttonClass}
              onClick={() => router.push(`/short-videos/${savedVideoId}`)}
            >
              进入作品继续制作
            </button>
          )}
        </section>
      )}
    </section>
  );
}
