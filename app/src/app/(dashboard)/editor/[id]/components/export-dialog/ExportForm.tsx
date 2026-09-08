"use client";

import { useState } from "react";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_WATERMARK,
  type SubtitleStyle,
  type Watermark,
} from "@/types/export-style";
import { SUBTITLE_FONTS, DEFAULT_SUBTITLE_FONT_ID } from "@/lib/subtitle-fonts";
import { DEFAULT_COLOR_GRADE, type ColorGrade } from "@/lib/color-grade";
import { resolveTitleCardsEnabled } from "@/lib/title-cards";
import { SubtitleStylePanel } from "../SubtitleStylePanel";
import { WatermarkPanel } from "../WatermarkPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { CoverPanel } from "./CoverPanel";
import { JianyingDraftPanel } from "./JianyingDraftPanel";
import { FinishingPackagePanel } from "./FinishingPackagePanel";
import type { ExportFormProps } from "./types";

export function ExportForm({
  onExport,
  onCancel,
  initialSubtitleStyle,
  initialWatermark,
  initialColorGrade,
  initialTitleCards,
  isSeries,
  onPersist,
  projectId,
  coverSourceCandidates,
  coverDefaultTitle,
  coverDefaultSubtitle,
  coverImageUrl,
}: ExportFormProps) {
  /* ---- 基础导出选项（保持原有字段不破坏） ---- */
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("720p");
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(true);

  /* ---- 字幕样式状态：优先用时间轴入口已存配置，回退默认 ---- */
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(
    initialSubtitleStyle ?? DEFAULT_SUBTITLE_STYLE
  );

  /* ---- 水印状态：优先用时间轴入口已存配置，回退默认（关闭） ---- */
  const [watermark, setWatermark] = useState<Watermark>(
    initialWatermark ?? DEFAULT_WATERMARK
  );

  /* ---- 成片包装：全片调色 ---- */
  const [colorGrade, setColorGrade] = useState<ColorGrade>(
    initialColorGrade ?? DEFAULT_COLOR_GRADE
  );

  /* ---- 成片包装：片头/片尾卡开关（缺省按系列/单片契约解析成显式布尔） ---- */
  const initialCards = resolveTitleCardsEnabled(initialTitleCards, isSeries);
  const [titleCard, setTitleCard] = useState(initialCards.title);
  const [endCard, setEndCard] = useState(initialCards.end);

  // 字幕字体变更：写回 subtitleStyle.fontFamily + 持久化到 generationParams
  // （让主编辑器预览字体同步）。
  const handleFontChange = (fontFamily: string) => {
    const next = { ...subtitleStyle, fontFamily };
    setSubtitleStyle(next);
    onPersist({ subtitleStyle: next });
  };

  // 片头/片尾卡开关：更新本地态 + 持久化到 generationParams.titleCards
  // （主编辑器预览据此注入首尾卡）。
  const handleTitleCardToggle = (title: boolean, end: boolean) => {
    setTitleCard(title);
    setEndCard(end);
    onPersist({ titleCards: { title, end } });
  };

  // 全片调色变更：更新本地态 + 持久化到 generationParams.colorGrade（主编辑器预览近似染色）。
  const handleColorGradeChange = (next: ColorGrade) => {
    setColorGrade(next);
    onPersist({ colorGrade: next });
  };

  const handleExport = () => {
    onExport({
      format,
      quality,
      includeSubtitles,
      includeAudio,
      subtitleStyle,
      watermark,
      colorGrade,
      titleCard,
      endCard,
    });
  };

  return (
    <div className="space-y-4">
      {/* 格式 */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">格式</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
        >
          <option value="mp4">MP4 (推荐)</option>
          <option value="webm">WebM</option>
        </select>
      </div>

      {/* 分辨率 */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          分辨率
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
        >
          <option value="480p">480p (标清)</option>
          <option value="720p">720p (高清)</option>
          <option value="1080p">1080p (全高清)</option>
        </select>
      </div>

      {/* 基础开关 */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeSubtitles}
            onChange={(e) => setIncludeSubtitles(e.target.checked)}
            className="border-border bg-secondary h-4 w-4 rounded"
          />
          <span>包含字幕</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeAudio}
            onChange={(e) => setIncludeAudio(e.target.checked)}
            className="border-border bg-secondary h-4 w-4 rounded"
          />
          <span>包含配音</span>
        </label>
      </div>

      {/* ---- 字幕样式（可折叠分节） ---- */}
      <CollapsibleSection title="字幕样式">
        {includeSubtitles ? (
          <div className="space-y-4">
            {/* 字体选择（批6）：内置白名单两款，落 subtitleStyle.fontFamily */}
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                字体
              </label>
              <select
                value={subtitleStyle.fontFamily ?? DEFAULT_SUBTITLE_FONT_ID}
                onChange={(e) => handleFontChange(e.target.value)}
                className="bg-secondary focus:ring-primary w-full rounded-lg px-3 py-2 focus:ring-2 focus:outline-none"
              >
                {SUBTITLE_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <SubtitleStylePanel
              value={subtitleStyle}
              onChange={setSubtitleStyle}
              // 导出表单里保持只读预览（无底板图 + 不可拖拽），字幕位置/字号在
              // 时间轴字幕样式弹窗里可视化编辑，此处仅确认样式。
              interactive={false}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            请先勾选「包含字幕」以配置字幕样式。
          </p>
        )}
      </CollapsibleSection>

      {/* ---- 专属封面（平台竖屏封面：已有图做底 + 大字剧名，可折叠分节） ---- */}
      <CollapsibleSection title="专属封面">
        <CoverPanel
          projectId={projectId}
          candidates={coverSourceCandidates}
          defaultTitle={coverDefaultTitle}
          defaultSubtitle={coverDefaultSubtitle}
          initialCoverUrl={coverImageUrl}
        />
      </CollapsibleSection>

      {/* ---- 剪映草稿（导出草稿包供二次精修，可折叠分节） ---- */}
      <CollapsibleSection title="剪映草稿">
        <JianyingDraftPanel projectId={projectId} />
      </CollapsibleSection>

      {/* ---- 成片包装（批6：片头尾卡 + 全片调色，可折叠分节） ---- */}
      <CollapsibleSection title="成片包装">
        <FinishingPackagePanel
          titleCard={titleCard}
          endCard={endCard}
          colorGrade={colorGrade}
          onTitleCardsChange={handleTitleCardToggle}
          onColorGradeChange={handleColorGradeChange}
        />
      </CollapsibleSection>

      {/* ---- 品牌水印（可折叠分节） ---- */}
      <CollapsibleSection title="品牌水印">
        <WatermarkPanel value={watermark} onChange={setWatermark} />
      </CollapsibleSection>

      {/* 底部操作按钮 */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-4 py-2"
        >
          取消
        </button>
        <button
          onClick={handleExport}
          className="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-2"
        >
          开始导出
        </button>
      </div>
    </div>
  );
}
