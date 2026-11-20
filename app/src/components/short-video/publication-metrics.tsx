"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { MetricZ } from "@/lib/short-video/contracts";

type Metric = {
  id: string;
  observedAt: string;
  windowLabel: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  attributedFollowers: number | null;
  completionRate: number | null;
  avgWatchMs: number | null;
};
const fields = [
  ["views", "播放量"],
  ["likes", "点赞数"],
  ["comments", "评论数"],
  ["shares", "分享数"],
  ["saves", "收藏数"],
  ["attributedFollowers", "新增关注"],
  ["completionRate", "完播率（%）"],
  ["avgWatchMs", "平均观看时长（秒）"],
] as const;
const windows: Record<string, string> = {
  H24: "发布后24小时",
  H72: "发布后72小时",
  CUSTOM: "自定义采集",
};
const control =
  "border-input bg-background focus-visible:ring-ring min-h-10 w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function PublicationMetrics({
  publicationId,
  userId,
  read,
  write,
}: {
  publicationId: string;
  userId: string;
  read: <T>(path: string) => Promise<T>;
  write: <T>(path: string, body: Record<string, unknown>) => Promise<T>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [windowLabel, setWindowLabel] = useState("CUSTOM");
  const [records, setRecords] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{
    fingerprint: string;
    body: Record<string, unknown>;
  } | null>(null);
  const endpoint = `publications/${publicationId}/metrics`;
  const storageKey = `short-video-metric:${userId}:${publicationId}`;
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await read<{ items: Metric[] }>(endpoint);
      if (!Array.isArray(result.items)) throw new Error("INVALID_METRIC_LIST");
      setRecords(result.items);
      setError("");
    } catch {
      setError("反馈记录读取失败，请重试。已填写的数据会保留。");
    } finally {
      setLoading(false);
    }
  }, [endpoint, read]);
  useEffect(() => {
    let active = true;
    void read<{ items: Metric[] }>(endpoint)
      .then((result) => {
        if (!Array.isArray(result.items))
          throw new Error("INVALID_METRIC_LIST");
        if (active) setRecords(result.items);
      })
      .catch(() => {
        if (active) setError("反馈记录读取失败，请重试。已填写的数据会保留。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, read]);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const metrics = Object.fromEntries(
        fields.map(([key]) => {
          const value = values[key]?.trim();
          const number = value ? Number(value) : null;
          return [
            key,
            number === null
              ? null
              : key === "completionRate"
                ? number / 100
                : key === "avgWatchMs"
                  ? Math.round(number * 1000)
                  : number,
          ];
        })
      );
      const fingerprint = JSON.stringify({ windowLabel, metrics });
      if (!pending.current) {
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(storageKey) || "null"
          );
          if (saved?.fingerprint === fingerprint) {
            pending.current = { fingerprint, body: MetricZ.parse(saved.body) };
          }
        } catch {
          /* 存储不可用或旧记录损坏时，仍保留当前页面的重试收据。 */
        }
      }
      // 丢失响应后继续使用同一采集时间及请求收据，避免重试生成重复快照。
      const body =
        pending.current?.fingerprint === fingerprint
          ? pending.current.body
          : MetricZ.parse({
              observedAt: new Date().toISOString(),
              windowLabel,
              metrics,
            });
      pending.current = { fingerprint, body };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(pending.current));
      } catch {
        /* 隐私模式仍可在当前页面核对原请求。 */
      }
      await write(endpoint, body);
      pending.current = null;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* 成功响应后无需再保留本次采集时间。 */
      }
      setNotice("指标快照已保存；未填写的指标保持未知。");
      await refresh();
    } catch {
      setError(
        "保存未确认。请检查数据：计数须为非负整数，完播率为0—100%。网络恢复后可再次保存核对原请求。"
      );
    } finally {
      setBusy(false);
    }
  }

  const display = (record: Metric, key: (typeof fields)[number][0]) => {
    const value = record[key];
    if (value === null || value === undefined) return "未知";
    if (key === "completionRate") return `${Number((value * 100).toFixed(2))}%`;
    if (key === "avgWatchMs") return `${value / 1000}秒`;
    return value.toLocaleString("zh-CN");
  };

  return (
    <section
      aria-label="发布反馈"
      className="border-border space-y-4 border-t pt-5"
    >
      <div className="flex items-center gap-2">
        <BarChart3 className="text-primary size-4" aria-hidden="true" />
        <h3 className="font-semibold">记录表现，找到下一条创作方向</h3>
      </div>
      <p className="text-muted-foreground text-sm">
        按平台实际数据填写，留空表示未知，0表示已确认没有。这里保存人工记录。
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-1.5 text-sm">
          <span>指标窗口</span>
          <select
            className={control}
            value={windowLabel}
            disabled={busy}
            onChange={(event) => setWindowLabel(event.target.value)}
          >
            {Object.entries(windows).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {fields.map(([key, label]) => (
            <label key={key} className="min-w-0 space-y-1.5 text-sm">
              <span>{label}</span>
              <input
                className={control}
                type="number"
                inputMode="decimal"
                min={0}
                max={
                  key === "completionRate"
                    ? 100
                    : key === "avgWatchMs"
                      ? 2147483.647
                      : 2147483647
                }
                step={
                  key === "completionRate" || key === "avgWatchMs"
                    ? "0.01"
                    : "1"
                }
                placeholder="未知"
                value={values[key] ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy}
          >
            {busy && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            保存指标快照
          </button>
          <button
            type="button"
            className="border-border inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            读取指标记录
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取反馈…
        </p>
      ) : records.length ? (
        <div className="max-w-full overflow-x-auto rounded-lg border">
          <table
            aria-label="发布反馈记录"
            className="w-full text-left text-xs whitespace-nowrap"
          >
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className="p-3">
                  采集时间 / 窗口
                </th>
                {fields.map(([key, label]) => (
                  <th key={key} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-t">
                  <th scope="row" className="p-3 font-normal">
                    {new Date(record.observedAt).toLocaleString("zh-CN")}
                    <br />
                    <span className="text-muted-foreground">
                      {windows[record.windowLabel] || "自定义采集"}
                    </span>
                  </th>
                  {fields.map(([key]) => (
                    <td key={key} className="p-3 tabular-nums">
                      {display(record, key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !error ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          还没有反馈记录，填写已知数据即可。
        </p>
      ) : null}
    </section>
  );
}
