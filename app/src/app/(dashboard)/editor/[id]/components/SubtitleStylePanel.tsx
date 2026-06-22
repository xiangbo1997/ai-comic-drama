"use client";

import type { SubtitleStyle } from "@/types/export-style";

interface SubtitleStylePanelProps {
  /** 当前字幕样式值 */
  value: SubtitleStyle;
  /** 样式变更回调，始终传入新对象（不可变） */
  onChange: (s: SubtitleStyle) => void;
}

/** 位置选项配置 */
const POSITION_OPTIONS: Array<{
  value: SubtitleStyle["position"];
  label: string;
}> = [
  { value: "top", label: "顶部" },
  { value: "middle", label: "居中" },
  { value: "bottom", label: "底部" },
];

/**
 * 字幕样式面板
 * 提供字号、颜色、描边、位置、加粗、底框等设置，
 * 顶部带实时预览条（CSS 模拟最终渲染效果）。
 */
export function SubtitleStylePanel({
  value,
  onChange,
}: SubtitleStylePanelProps) {
  /** 构建预览字幕的内联样式 */
  const buildPreviewStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {
      fontSize: value.fontSize,
      color: value.fontColor,
      fontWeight: value.bold ? "bold" : "normal",
      // CSS text-stroke 模拟描边
      WebkitTextStroke: `${value.outlineWidth}px ${value.outlineColor}`,
      // 兼容性 text-shadow 描边（四方向叠加）
      textShadow:
        value.outlineWidth > 0
          ? [
              `${value.outlineWidth}px ${value.outlineWidth}px 0 ${value.outlineColor}`,
              `-${value.outlineWidth}px ${value.outlineWidth}px 0 ${value.outlineColor}`,
              `${value.outlineWidth}px -${value.outlineWidth}px 0 ${value.outlineColor}`,
              `-${value.outlineWidth}px -${value.outlineWidth}px 0 ${value.outlineColor}`,
            ].join(", ")
          : undefined,
      padding: value.backgroundBox ? "2px 8px" : undefined,
      backgroundColor: value.backgroundBox ? "rgba(0,0,0,0.55)" : undefined,
      borderRadius: value.backgroundBox ? "4px" : undefined,
      display: "inline-block",
      maxWidth: "100%",
      textAlign: "center",
      lineHeight: 1.4,
    };
    return style;
  };

  /** 预览区对齐方式（模拟 top/middle/bottom） */
  const previewAlign =
    value.position === "top"
      ? "items-start pt-2"
      : value.position === "middle"
        ? "items-center"
        : "items-end pb-2";

  return (
    <div className="space-y-4">
      {/* 实时预览条 */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">字幕预览</p>
        <div
          className={`bg-secondary flex h-20 w-full justify-center overflow-hidden rounded-lg ${previewAlign}`}
        >
          <span style={buildPreviewStyle()}>示例字幕 Sample</span>
        </div>
        <p className="text-muted-foreground text-[10px]">
          * 导出效果以最终视频为准
        </p>
      </div>

      {/* 字体大小 */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-muted-foreground text-sm">字号</label>
          <span className="text-sm">{value.fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={48}
          step={1}
          value={value.fontSize}
          onChange={(e) =>
            onChange({ ...value, fontSize: Number(e.target.value) })
          }
          className="accent-primary w-full"
        />
        <p className="text-muted-foreground mt-1 text-[10px]">
          * 基于 1080p 画面的字号；预览与成片按画面比例自动缩放，所见即所得
        </p>
      </div>

      {/* 颜色设置 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 字体颜色 */}
        <div>
          <label className="text-muted-foreground mb-1 block text-sm">
            字体颜色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.fontColor}
              onChange={(e) =>
                onChange({ ...value, fontColor: e.target.value })
              }
              className="bg-secondary h-8 w-10 cursor-pointer rounded border-0 p-0.5"
              title="选择字体颜色"
            />
            <span className="text-muted-foreground font-mono text-xs">
              {value.fontColor.toUpperCase()}
            </span>
          </div>
        </div>

        {/* 描边颜色 */}
        <div>
          <label className="text-muted-foreground mb-1 block text-sm">
            描边颜色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.outlineColor}
              onChange={(e) =>
                onChange({ ...value, outlineColor: e.target.value })
              }
              className="bg-secondary h-8 w-10 cursor-pointer rounded border-0 p-0.5"
              title="选择描边颜色"
            />
            <span className="text-muted-foreground font-mono text-xs">
              {value.outlineColor.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* 描边宽度 */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-muted-foreground text-sm">描边宽度</label>
          <span className="text-sm">{value.outlineWidth}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={value.outlineWidth}
          onChange={(e) =>
            onChange({ ...value, outlineWidth: Number(e.target.value) })
          }
          className="accent-primary w-full"
        />
      </div>

      {/* 字幕位置 — segmented control（全局默认；单分镜可在预览中拖拽覆盖） */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          默认位置
        </label>
        <div className="bg-secondary flex rounded-lg p-1">
          {POSITION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...value, position: opt.value })}
              className={`flex-1 rounded-md py-1 text-sm transition-colors ${
                value.position === opt.value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          * 这是所有字幕的默认位置；在预览中可单独拖动某条字幕到任意位置
        </p>
      </div>

      {/* 开关行：加粗 + 底框 */}
      <div className="space-y-2">
        {/* 加粗 */}
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-sm">文字加粗</span>
          <button
            type="button"
            role="switch"
            aria-checked={value.bold}
            onClick={() => onChange({ ...value, bold: !value.bold })}
            className={`focus:ring-primary relative h-5 w-9 rounded-full transition-colors focus:ring-2 focus:outline-none ${
              value.bold ? "bg-primary" : "bg-secondary border-border border"
            }`}
          >
            <span
              className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                value.bold ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>

        {/* 底框 */}
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-sm">显示底框（提升可读性）</span>
          <button
            type="button"
            role="switch"
            aria-checked={value.backgroundBox}
            onClick={() =>
              onChange({ ...value, backgroundBox: !value.backgroundBox })
            }
            className={`focus:ring-primary relative h-5 w-9 rounded-full transition-colors focus:ring-2 focus:outline-none ${
              value.backgroundBox
                ? "bg-primary"
                : "bg-secondary border-border border"
            }`}
          >
            <span
              className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                value.backgroundBox ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  );
}
