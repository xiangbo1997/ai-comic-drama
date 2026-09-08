"use client";

import { LUT_PRESETS, type ColorGrade } from "@/lib/color-grade";
import { ToggleRow } from "./CollapsibleSection";

/**
 * 成片包装面板（批6）：片头标题卡 / 片尾钩子卡开关 + 全片调色（启用 + 三预设）。
 * 变更即时经上层持久化到 generationParams，主编辑器预览同步反映（预览=成片）。
 */
export function FinishingPackagePanel({
  titleCard,
  endCard,
  colorGrade,
  onTitleCardsChange,
  onColorGradeChange,
}: {
  titleCard: boolean;
  endCard: boolean;
  colorGrade: ColorGrade;
  onTitleCardsChange: (title: boolean, end: boolean) => void;
  onColorGradeChange: (next: ColorGrade) => void;
}) {
  return (
    <div className="space-y-4">
      {/* 片头 / 片尾卡开关 */}
      <div className="space-y-2">
        <ToggleRow
          label="片头标题卡（剧名 + 集数）"
          checked={titleCard}
          onChange={(v) => onTitleCardsChange(v, endCard)}
        />
        <ToggleRow
          label="片尾钩子卡（下集悬念 + 追更）"
          checked={endCard}
          onChange={(v) => onTitleCardsChange(titleCard, v)}
        />
      </div>

      {/* 全片调色 */}
      <div className="border-border space-y-2 border-t pt-3">
        <ToggleRow
          label="全片调色（统一色调）"
          checked={colorGrade.enabled}
          onChange={(v) => onColorGradeChange({ ...colorGrade, enabled: v })}
        />
        {colorGrade.enabled && (
          <div className="space-y-1.5 pl-1">
            {LUT_PRESETS.map((preset) => {
              const active = colorGrade.lutId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    onColorGradeChange({ ...colorGrade, lutId: preset.id })
                  }
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <p className="text-sm font-medium">{preset.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {preset.description}
                  </p>
                </button>
              );
            })}
            <p className="text-muted-foreground pt-1 text-[10px]">
              * 预览为近似效果，成片以导出为准
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
