"use client";

import { useEffect, useRef, useState } from "react";
import type { SubtitleStyle, SubtitleAnimation } from "@/types/export-style";
import {
  presetPositionToXY,
  resolveSubtitleFontPx,
  SUBTITLE_FONT_BASE_HEIGHT,
  SUBTITLE_QUICK_POSITIONS,
} from "@/types/export-style";
import {
  SUBTITLE_KEYFRAMES_CSS,
  getSubtitleAnimationCss,
} from "@/lib/subtitle-css";
import { typewriterDelays } from "@/lib/subtitle-segments";

interface SubtitleStylePanelProps {
  /** 当前字幕样式值 */
  value: SubtitleStyle;
  /** 样式变更回调，始终传入新对象（不可变） */
  onChange: (s: SubtitleStyle) => void;
  /** 预览底板图（首个有图分镜的画面）；缺省显示占位 */
  previewImageUrl?: string;
  /** 画面比例（如 "9:16"），驱动预览舞台尺寸；缺省 "16:9" */
  aspectRatio?: string;
  /** 是否允许在预览里拖拽/拖角编辑（缺省 true；导出表单传 false 为只读预览） */
  interactive?: boolean;
}

/** 入场动效选项配置（顺序与 SubtitleAnimation 白名单一致） */
const ANIMATION_OPTIONS: Array<{
  value: SubtitleAnimation;
  label: string;
}> = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入" },
  { value: "slideup", label: "上滑" },
  { value: "pop", label: "弹跳" },
  { value: "typewriter", label: "逐字" },
];

/** 预览示例文案（带标点，供 typewriter 逐字拆分） */
const SAMPLE_TEXT = "示例字幕，所见即所得。";
/** typewriter 预览的固定时间窗（秒）——面板无真实时轴，取一个观感自然的值 */
const SAMPLE_TYPEWRITER_WINDOW = 2.5;
/** 面板字号 UI 范围（与字号滑块一致；服务端另有 8-96 的安全外壳） */
const FONT_MIN = 12;
const FONT_MAX = 48;

/**
 * 把 aspectRatio 字符串（"9:16"/"1:1"/"16:9"）转 CSS aspect-ratio 值，非法回退 16/9。
 * 与 preview-player 的同名纯函数逻辑一致（此处本地复制 4 行，避免 component→component
 * 依赖把整个播放器拉进面板包体）。
 */
function aspectRatioToCss(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map((n) => Number(n));
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return "16 / 9";
}

/**
 * 归一化纵向 y（0-1）就近映射到 top/middle/bottom 三档。
 * 用于把九宫格/自由拖拽的默认位置回写 legacy 的 position 字段（保证只读 position 的
 * 老消费点仍拿到合理纵向）。纯函数，便于单测。
 */
export function nearestBand(y: number): SubtitleStyle["position"] {
  if (y < 0.33) return "top";
  if (y < 0.66) return "middle";
  return "bottom";
}

/**
 * 剪映式拖角改字号：按「指针到字幕中心的像素距离」等比缩放字号。
 * 距中心越远字号越大（拖角外扩=放大）。结果 clamp 到面板 UI 范围。纯函数，便于单测。
 *
 * @param startFont 按下时的字号
 * @param startDist 按下时指针到中心的像素距离
 * @param curDist   当前指针到中心的像素距离
 * @param min/max   字号钳制范围
 */
export function resizeFontFromDistance(
  startFont: number,
  startDist: number,
  curDist: number,
  min: number,
  max: number
): number {
  const ratio = curDist / Math.max(startDist, 1);
  const next = Math.round(startFont * ratio);
  return Math.min(max, Math.max(min, next));
}

/**
 * 字幕样式面板
 * 提供字号、颜色、描边、位置、加粗、底框、入场动效设置；
 * 顶部为「真实迷你舞台」——以首帧分镜图为底板，可拖拽字幕改位置、拖角改字号、
 * 切换动效实时重播，与预览播放器/导出端共用同一坐标与时序（预览=成片）。
 */
export function SubtitleStylePanel({
  value,
  onChange,
  previewImageUrl,
  aspectRatio,
  interactive = true,
}: SubtitleStylePanelProps) {
  // 画面框（舞台）ref + 实际像素高：字号从 1080 基准等比缩放到预览尺寸，
  // 与导出端 resolveSubtitleFontPx 共用，预览字号≈成片字号。
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState(0);
  // 交互态：null=无，move=拖拽移动，resize=拖角改字号（记按下时的距离与字号）。
  const interactionRef = useRef<
    | { mode: "move" }
    | { mode: "resize"; startDist: number; startFont: number }
    | null
  >(null);

  // 当前默认位置的归一化中心点：优先自由坐标 defaultX/defaultY，否则回退三档 position。
  const draftXY =
    typeof value.defaultX === "number" && typeof value.defaultY === "number"
      ? { x: value.defaultX, y: value.defaultY }
      : presetPositionToXY(value.position ?? "bottom");

  // 跟踪舞台像素高 → 驱动字号等比缩放（与 preview-player 同款 ResizeObserver）。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 预览字号：把 fontSize(1080 基准) 按舞台实际高等比缩放（与导出端同源）。
  const subtitleFontPx = resolveSubtitleFontPx(value.fontSize, stageHeight);

  // 入场动效（缺省 fade，与导出/预览端一致）。
  const animation: SubtitleAnimation = value.animation ?? "fade";
  const animationCss = getSubtitleAnimationCss(animation);

  // typewriter：逐字符 + 各自显现延迟（与导出端 typewriterDelays 同源）。
  const typewriterChars =
    animation === "typewriter" ? Array.from(SAMPLE_TEXT) : null;
  const typewriterCharDelays =
    animation === "typewriter"
      ? typewriterDelays(SAMPLE_TEXT, SAMPLE_TYPEWRITER_WINDOW)
      : null;

  // 屏幕坐标 → 相对舞台的归一化坐标（clamp 0-1）。
  const clientToNormalized = (
    clientX: number,
    clientY: number
  ): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0.5, y: 0.88 };
    }
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  // 字幕中心像素坐标（拖角改字号时算距离用）。
  const subtitleCenterPx = (): { cx: number; cy: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0 };
    return {
      cx: rect.left + draftXY.x * rect.width,
      cy: rect.top + draftXY.y * rect.height,
    };
  };

  // 拖拽移动：pointermove 里实时回写 defaultX/defaultY（受控，dialog 内同步 setDraft）。
  const handleMovePointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    interactionRef.current = { mode: "move" };
    const { x, y } = clientToNormalized(e.clientX, e.clientY);
    onChange({ ...value, defaultX: x, defaultY: y, position: nearestBand(y) });
  };

  // 拖角改字号：记按下时到中心的距离 + 起始字号；move 里按距离比例缩放。
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 body 的拖拽移动
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const { cx, cy } = subtitleCenterPx();
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy);
    interactionRef.current = {
      mode: "resize",
      startDist,
      startFont: value.fontSize,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const it = interactionRef.current;
    if (!it) return;
    e.preventDefault();
    if (it.mode === "move") {
      const { x, y } = clientToNormalized(e.clientX, e.clientY);
      onChange({
        ...value,
        defaultX: x,
        defaultY: y,
        position: nearestBand(y),
      });
    } else {
      const { cx, cy } = subtitleCenterPx();
      const curDist = Math.hypot(e.clientX - cx, e.clientY - cy);
      const fontSize = resizeFontFromDistance(
        it.startFont,
        it.startDist,
        curDist,
        FONT_MIN,
        FONT_MAX
      );
      if (fontSize !== value.fontSize) onChange({ ...value, fontSize });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!interactionRef.current) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    interactionRef.current = null;
  };

  // 九宫格「格子 → 是否当前选中」判断（与 draftXY 近似即高亮）。
  const isActiveCell = (cx: number, cy: number): boolean =>
    Math.abs(cx - draftXY.x) < 0.01 && Math.abs(cy - draftXY.y) < 0.01;

  // 字幕块内联样式（逐条对齐 preview-player，保证预览=成片）。
  const subtitleTextStyle: React.CSSProperties = {
    fontSize: `${subtitleFontPx}px`,
    color: value.fontColor,
    fontWeight: value.bold ? 700 : 400,
    background: value.backgroundBox ? "rgba(0,0,0,0.7)" : "transparent",
    textShadow:
      value.outlineWidth > 0
        ? `${value.outlineColor} 1px 1px 0, ${value.outlineColor} -1px -1px 0, ${value.outlineColor} 1px -1px 0, ${value.outlineColor} -1px 1px 0`
        : undefined,
    // 描边宽度随舞台高等比缩放（对齐导出端 ScaledBorderAndShadow:yes）。
    WebkitTextStroke:
      value.outlineWidth > 0
        ? `${(value.outlineWidth * (stageHeight > 0 ? stageHeight : SUBTITLE_FONT_BASE_HEIGHT)) / SUBTITLE_FONT_BASE_HEIGHT}px ${value.outlineColor}`
        : undefined,
    userSelect: "none",
    touchAction: interactive ? "none" : undefined,
    animation: animationCss,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    display: "inline-block",
  };

  // 角控点通用样式（8px 方块，白底蓝边）。
  const handleClass =
    "absolute h-2.5 w-2.5 rounded-sm border border-primary bg-white";

  return (
    <div className="space-y-4">
      {/* ── 真实迷你舞台：首帧图底板 + 可拖字幕 ── */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">字幕预览</p>
        <div className="flex w-full items-center justify-center overflow-hidden rounded-lg bg-black">
          <div
            ref={stageRef}
            className="relative max-h-[46vh] w-full overflow-hidden bg-black"
            style={{ aspectRatio: aspectRatioToCss(aspectRatio ?? "16:9") }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* 动效关键帧（与 preview-player 共用同一份），仅注入一次 */}
            <style>{SUBTITLE_KEYFRAMES_CSS}</style>

            {/* 底板：首帧分镜图（object-contain 黑边），无图则占位 */}
            {previewImageUrl ? (
              <img
                src={previewImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
                暂无分镜图，仅预览字幕样式
              </div>
            )}

            {/* 字幕块：绝对定位到归一化中心点，可拖拽（interactive 时） */}
            <div
              className="absolute z-10"
              style={{
                left: `${draftXY.x * 100}%`,
                top: `${draftXY.y * 100}%`,
                transform: "translate(-50%, -50%)",
                maxWidth: "90%",
              }}
            >
              <div
                className={`relative inline-block ${
                  interactive
                    ? "ring-primary/80 cursor-move rounded ring-1"
                    : ""
                }`}
                onPointerDown={interactive ? handleMovePointerDown : undefined}
              >
                <p
                  // key 绑定 animation：切换动效即重挂载 → 重放入场动画
                  // （与 preview-player 用 key 触发逐句动画同理）。
                  key={animation}
                  className="rounded px-3 py-1 text-center"
                  style={subtitleTextStyle}
                >
                  {typewriterChars && typewriterCharDelays
                    ? typewriterChars.map((ch, i) =>
                        ch === "\n" || ch === "\r" ? (
                          <br key={i} />
                        ) : (
                          <span
                            key={i}
                            style={{
                              opacity: 0,
                              animation: `subtitleCharReveal 80ms linear forwards`,
                              animationDelay: `${typewriterCharDelays[i]}s`,
                            }}
                          >
                            {ch}
                          </span>
                        )
                      )
                    : SAMPLE_TEXT}
                </p>

                {/* 四角控点：拖角改字号（仅 interactive） */}
                {interactive && (
                  <>
                    <span
                      className={`${handleClass} -top-1 -left-1`}
                      style={{ cursor: "nwse-resize" }}
                      onPointerDown={handleResizePointerDown}
                    />
                    <span
                      className={`${handleClass} -top-1 -right-1`}
                      style={{ cursor: "nesw-resize" }}
                      onPointerDown={handleResizePointerDown}
                    />
                    <span
                      className={`${handleClass} -bottom-1 -left-1`}
                      style={{ cursor: "nesw-resize" }}
                      onPointerDown={handleResizePointerDown}
                    />
                    <span
                      className={`${handleClass} -right-1 -bottom-1`}
                      style={{ cursor: "nwse-resize" }}
                      onPointerDown={handleResizePointerDown}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground text-[10px]">
          {interactive
            ? "* 拖动字幕改位置，拖四角改字号；切换动效实时重播。导出效果以最终视频为准"
            : "* 导出效果以最终视频为准"}
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
          min={FONT_MIN}
          max={FONT_MAX}
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

      {/* 默认位置 — 九宫格（全局默认；单分镜可在预览播放器里拖拽覆盖） */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          默认位置
        </label>
        <div className="bg-secondary grid grid-cols-3 gap-1 rounded-lg p-1">
          {SUBTITLE_QUICK_POSITIONS.map((pos) => {
            const active = isActiveCell(pos.x, pos.y);
            return (
              <button
                key={pos.label}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    defaultX: pos.x,
                    defaultY: pos.y,
                    position: nearestBand(pos.y),
                  })
                }
                className={`rounded-md py-1.5 text-xs transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {pos.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          * 这是所有字幕的默认位置；也可直接在上方预览里拖动字幕自由定位
        </p>
      </div>

      {/* 入场动效 — segmented control（逐句字幕的出场方式；预览与成片一致） */}
      <div>
        <label className="text-muted-foreground mb-1 block text-sm">
          入场动效
        </label>
        <div className="bg-secondary flex rounded-lg p-1">
          {ANIMATION_OPTIONS.map((opt) => {
            // 旧配置无 animation 字段时按 fade 解析（与导出/预览端一致）
            const active = (value.animation ?? "fade") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...value, animation: opt.value })}
                className={`flex-1 rounded-md py-1 text-sm transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          * 每句字幕的出场方式；切换后在上方预览里实时重播
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
