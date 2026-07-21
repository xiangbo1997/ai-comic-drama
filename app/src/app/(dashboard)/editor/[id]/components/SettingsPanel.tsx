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
  /** 混合出片策略（一键管线读取）；缺省 "full"（全部生成视频） */
  renderStrategy?: "full" | "hybrid";
  /** 切换混合出片开关（持久化到 generationParams.renderStrategy） */
  onRenderStrategyChange: (strategy: "full" | "hybrid") => void;
}

export function SettingsPanel({
  style,
  aspectRatio,
  onStyleChange,
  onAspectRatioChange,
  renderStrategy,
  onRenderStrategyChange,
}: SettingsPanelProps) {
  const hybridOn = renderStrategy === "hybrid";
  return (
    <div className="border-border bg-card/50 flex flex-wrap items-center gap-6 border-b px-4 py-3">
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
      {/* 混合出片（经济模式）：一键全自动管线只对高动态/冲击/高潮镜生成视频，
          其余镜走图片运镜（零视频成本）。默认关，开启后行为改变仅作用于一键管线。 */}
      <label
        className="flex cursor-pointer items-center gap-2 text-sm"
        title="一键全自动时，只对高动态/冲击/高潮镜生成视频，其余镜走图片运镜（省成本，约为纯视频路线的 1/2~1/3）"
      >
        <input
          type="checkbox"
          checked={hybridOn}
          onChange={(e) =>
            onRenderStrategyChange(e.target.checked ? "hybrid" : "full")
          }
          className="accent-primary"
        />
        <span className="text-muted-foreground">混合出片（经济模式）</span>
      </label>
    </div>
  );
}
