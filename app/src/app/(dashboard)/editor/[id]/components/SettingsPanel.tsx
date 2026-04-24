/**
 * SettingsPanel — 编辑器顶部设置条（Stage 3.8 抽出）
 *
 * 从 page.tsx 的 inline JSX 抽出，保持同目录同风格（类似 EditorHeader / WorkflowPanel）。
 * 仅负责"风格 + 画面比例"两项项目级设置；真正的字段读写 / mutation 由父组件决定。
 */

"use client";

const STYLES: Array<{ value: string; label: string }> = [
  { value: "anime", label: "日漫风格" },
  { value: "realistic", label: "写实风格" },
  { value: "comic", label: "漫画风格" },
  { value: "watercolor", label: "水彩风格" },
];

const ASPECT_RATIOS: Array<{ value: string; label: string }> = [
  { value: "9:16", label: "9:16 (竖屏)" },
  { value: "16:9", label: "16:9 (横屏)" },
  { value: "1:1", label: "1:1 (方形)" },
];

export interface SettingsPanelProps {
  style: string;
  aspectRatio: string;
  onStyleChange: (style: string) => void;
  onAspectRatioChange: (aspectRatio: string) => void;
}

export function SettingsPanel({
  style,
  aspectRatio,
  onStyleChange,
  onAspectRatioChange,
}: SettingsPanelProps) {
  return (
    <div className="flex items-center gap-6 border-b border-gray-800 bg-gray-800/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-400">风格:</label>
        <select
          value={style}
          onChange={(e) => onStyleChange(e.target.value)}
          className="rounded bg-gray-700 px-2 py-1 text-sm"
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-400">比例:</label>
        <select
          value={aspectRatio}
          onChange={(e) => onAspectRatioChange(e.target.value)}
          className="rounded bg-gray-700 px-2 py-1 text-sm"
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
