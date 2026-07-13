/**
 * SettingsPanel — 编辑器顶部设置条（Stage 3.8 抽出）
 *
 * 从 page.tsx 的 inline JSX 抽出，保持同目录同风格（类似 EditorHeader / WorkflowPanel）。
 * 仅负责"风格 + 画面比例"两项项目级设置；真正的字段读写 / mutation 由父组件决定。
 */

"use client";

import { STYLE_PACK_OPTIONS } from "@/lib/prompts/style-packs";

/** 画风选项：从画风包注册表派生（单一真源），与新建系列弹窗一致 */
const STYLES = STYLE_PACK_OPTIONS;

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
    <div className="border-border bg-card/50 flex items-center gap-6 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <label className="text-muted-foreground text-sm">风格:</label>
        <select
          value={style}
          onChange={(e) => onStyleChange(e.target.value)}
          className="bg-secondary rounded px-2 py-1 text-sm"
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value} title={s.description}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-muted-foreground text-sm">比例:</label>
        <select
          value={aspectRatio}
          onChange={(e) => onAspectRatioChange(e.target.value)}
          className="bg-secondary rounded px-2 py-1 text-sm"
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
