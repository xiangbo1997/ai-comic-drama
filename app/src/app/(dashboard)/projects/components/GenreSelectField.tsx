"use client";

/**
 * GenreSelectField — 题材选择器（批 3 · 题材蓝海引导）
 *
 * 不是干巴巴的下拉列表：
 *   ① 按推荐档位分组（首选 / 推荐 / 蓝海 / 红海 / 不建议 / 避开 / 平台不要）；
 *   ② 选中后同屏展示该题材的**数据依据**（带数字或案例）；
 *   ③ 命中风险档位时同屏展示**警告与理由**，但**不阻断**提交 ——
 *      给信息让用户自己决定（沿用本项目「不硬阻断」的产品哲学）。
 *
 * 数据全部来自 lib/genre-matrix.ts（单一真源），本组件只消费不定义。
 */

import { useState } from "react";
import { Info, AlertTriangle, Ban } from "lucide-react";
import {
  GENRE_TIER_GROUPS,
  getGenreById,
  getGenreTierMeta,
  resolveGenreAdvisory,
} from "@/lib/genre-matrix";

interface GenreSelectFieldProps {
  /**
   * 当前题材（空串 = 未选，由 AI 自行判断）。
   * 通常是 GENRE_OPTIONS 的 id；也允许矩阵外的自由文本（如 AI 起草回填的类型名），
   * 此时下拉显示为「其它：xxx」，不伪装成某个矩阵档位。
   */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 标签文案（不同入口措辞略有差异） */
  label?: string;
}

/** 风险语义 → 提示条样式（与全局色彩语义一致） */
const SEVERITY_STYLES: Record<string, string> = {
  good: "border-primary/30 bg-primary/10 text-muted-foreground",
  neutral: "border-border bg-card/60 text-muted-foreground",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  danger: "border-red-500/40 bg-red-500/10 text-red-200",
};

/**
 * 「自定义题材」哨兵值。
 *
 * 用不可能与真实题材 id 冲突的值，避免用户输入的题材名恰好等于哨兵时
 * 把下拉卡在自定义态。它只存在于 select 的 UI 层，绝不会落库——
 * 切到自定义态时 onChange("") 会先清空，实际值由下方输入框接管。
 */
const CUSTOM_OPTION = "__custom__";

export function GenreSelectField({
  value,
  onChange,
  disabled,
  label = "题材",
}: GenreSelectFieldProps) {
  const selected = getGenreById(value);
  const tierMeta = getGenreTierMeta(selected?.tier);
  const advisory = resolveGenreAdvisory(value);
  // 矩阵外的自由文本题材（如 AI 起草回填的类型名）：补一个选项承接它，
  // 否则 select 的 value 不在 options 里会被浏览器重置为第一项，静默丢掉用户/AI 的值。
  const freeformValue = value && !selected ? value : null;
  // 自定义输入态：用户主动选「自定义题材…」后展开输入框。
  // 已有矩阵外的值（AI 回填 / 存量系列）默认走上面的「其它：xxx」选项，不强制进输入态。
  const [customMode, setCustomMode] = useState(false);

  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-sm">
        {label}
        <span className="ml-1 text-xs opacity-70">
          （按平台数据分档，可不选）
        </span>
      </label>
      <select
        value={customMode ? CUSTOM_OPTION : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM_OPTION) {
            // 切到自定义：清空当前值，交给下面的输入框接管
            setCustomMode(true);
            onChange("");
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
        disabled={disabled}
        className="bg-card w-full rounded-lg p-2 text-sm disabled:opacity-60"
      >
        <option value="">不指定，由 AI 判断</option>
        {freeformValue && !customMode && (
          <option value={freeformValue}>其它：{freeformValue}</option>
        )}
        {GENRE_TIER_GROUPS.map((group) => (
          <optgroup
            key={group.meta.tier}
            label={`${group.meta.stars} ${group.meta.label} — ${group.meta.summary}`}
          >
            {group.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_OPTION}>自定义题材…</option>
      </select>

      {/* 自定义题材输入：矩阵只有 15 档，覆盖不了跨类型创作（如「赛博悬疑」）。
          题材矩阵的职责是**给数据参考**而非**限制选择**，因此保留自由输入入口
          （与项目「不硬阻断」的一贯取舍一致）。矩阵外题材只把题材名注入 prompt，
          不编造创作要点——我们没有该题材的数据结论。 */}
      {customMode && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus
          maxLength={64}
          placeholder="如：赛博悬疑（无平台数据参考，仅作创作方向）"
          className="bg-card focus:ring-primary mt-2 w-full rounded-lg p-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
        />
      )}

      {/* 数据依据：选中即展示，让用户知道这一档是怎么来的 */}
      {selected && tierMeta && (
        <div
          className={`mt-2 rounded-lg border p-2 text-xs leading-relaxed ${
            SEVERITY_STYLES[tierMeta.severity] ?? SEVERITY_STYLES.neutral
          }`}
        >
          <p className="flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">
                {tierMeta.stars} {tierMeta.label}
              </span>
              ：{selected.rationale}
            </span>
          </p>
          <p className="mt-1 opacity-70">
            依据：{selected.source}
            {selected.confidence !== "high" && "（置信度中等，供参考）"}
          </p>
        </div>
      )}

      {/* 矩阵外题材：如实说明没有对应数据结论（不编造依据） */}
      {freeformValue && (
        <p className="border-border bg-card/60 text-muted-foreground mt-2 rounded-lg border p-2 text-xs leading-relaxed">
          「{freeformValue}」不在平台数据矩阵内，没有对应的蓝海/红海结论，
          仅作为题材名注入创作提示。想要数据参考可从上方列表里选一档。
        </p>
      )}

      {/* 风险提示：命中带 caution 的题材时同屏展示理由，但不阻断提交 */}
      {advisory && (
        <div
          className={`mt-2 rounded-lg border p-2 text-xs leading-relaxed ${
            SEVERITY_STYLES[advisory.severity] ?? SEVERITY_STYLES.warn
          }`}
        >
          <p className="flex items-start gap-1.5">
            {advisory.severity === "danger" ? (
              <Ban size={13} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            )}
            <span>
              <span className="font-medium">{advisory.tierLabel}</span>：
              {advisory.caution}
            </span>
          </p>
          <p className="mt-1 opacity-70">
            仍可继续 —— 这只是数据参考，最终由你决定。
          </p>
        </div>
      )}
    </div>
  );
}
