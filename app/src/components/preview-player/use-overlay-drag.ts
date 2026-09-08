"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { ScenePreview } from "@/types";
import type {
  SubtitleStyle,
  SubtitlePosition,
  Sticker,
} from "@/types/export-style";
import { resolveSubtitleXY } from "@/types/export-style";
// 剪映式拖角改字号的纯函数（与时间轴字幕样式面板共用同一实现，保证两处手感一致）
import { resizeFontFromDistance } from "@/lib/subtitle-resize";

// 字号 UI 范围（与字幕样式面板的滑块/拖角一致；服务端另有 8-96 安全外壳）
const SUBTITLE_FONT_MIN = 12;
const SUBTITLE_FONT_MAX = 48;

interface OverlayDragArgs {
  currentScene: ScenePreview | undefined;
  subtitleStyle: SubtitleStyle | undefined;
  subtitlePositions: SubtitlePosition[] | undefined;
  stickers: Sticker[] | undefined;
  onSubtitlePositionChange?: (sceneId: string, x: number, y: number) => void;
  onSubtitleStyleChange?: (style: SubtitleStyle) => void;
  onStickerPositionChange?: (stickerId: string, x: number, y: number) => void;
  stageRef: RefObject<HTMLDivElement | null>;
  setShowQuickPos: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * 预览覆盖层的拖拽交互：字幕位置拖拽 / 字幕拖角与滚轮改字号 / 贴图位置拖拽，
 * 以及三者的「乐观值收尾」effect（落库往返期间钉住落点，回流确认后清空）。
 *
 * 三个乐观值 effect 的依赖数组与 eslint-disable 说明原样保留：只在 props 回流时
 * 比对，把乐观值自身列进依赖会在拖拽每帧重复比对，与未回流的旧 props 相较必然
 * 不 settled。
 */
export function useOverlayDrag({
  currentScene,
  subtitleStyle,
  subtitlePositions,
  stickers,
  onSubtitlePositionChange,
  onSubtitleStyleChange,
  onStickerPositionChange,
  stageRef,
  setShowQuickPos,
}: OverlayDragArgs) {
  // 字幕拖拽态：拖拽中实时落点（归一化），用于无延迟跟手；松手时回调落库
  const [dragXY, setDragXY] = useState<{ x: number; y: number } | null>(null);
  // 贴图拖拽态：拖拽中实时落点（归一化锚点 x/y），跟手渲染；松手落库后由
  // effect 等 stickers prop 回流再清（同字幕 dragXY 防闪回模式）。
  const [dragSticker, setDragSticker] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  // 字幕拖角改字号：字幕块 ref（算中心像素）+ 交互态（按下时到中心的距离与起始字号）。
  // 与时间轴字幕样式面板同一套逻辑，字号写回全片 subtitleStyle（两处一致）。
  const subtitleBoxRef = useRef<HTMLParagraphElement>(null);
  const resizeRef = useRef<{ startDist: number; startFont: number } | null>(
    null
  );
  // 拖角改字号的「本地乐观字号」：updateProject 无 optimistic 且 onSuccess 会
  // invalidate→refetch，高频拖动时字号会被服务器旧值刷回（看似放不大/闪回）。
  // 故拖动中用此本地值即时渲染，松手才落库一次；落库回流后清空（同位置拖拽 dragXY）。
  const [dragFontSize, setDragFontSize] = useState<number | null>(null);
  // 滚轮缩放字号的防抖落库计时器：滚动中只更新本地乐观值，停止 400ms 后落库一次
  // （避免每滚一格发一个 PATCH）。
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 切换分镜时无条件清乐观值——dragXY 只属于上一个分镜，不能带到新分镜。
  // 用 React 官方「渲染期间调整 state」写法替代 effect 内 setState：切镜的同一次
  // 渲染就清掉旧落点，比 effect 更早（effect 要等提交后），杜绝新分镜首帧沿用
  // 上一镜坐标的闪现。
  const [dragSceneId, setDragSceneId] = useState(currentScene?.id);
  if (dragSceneId !== currentScene?.id) {
    setDragSceneId(currentScene?.id);
    setDragXY(null);
  }

  // 贴图拖拽乐观值收尾：松手后 dragSticker「钉」住落点（防落库往返期间闪回）。
  // 当 props.stickers 里该贴图坐标已回流确认（浮点容差）→ 清空，交还 props。
  useEffect(() => {
    if (!dragSticker) return;
    const confirmed = stickers?.find((s) => s.id === dragSticker.id);
    if (!confirmed) return;
    const settled =
      Math.abs(confirmed.x - dragSticker.x) < 0.001 &&
      Math.abs(confirmed.y - dragSticker.y) < 0.001;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 必须等 stickers prop 回流才清乐观值；改在渲染期比对会在落库往返期间提前清空，贴图闪回旧位
    if (settled) setDragSticker(null);
    // 只在 props 回流（stickers 变化）时比对；把 dragSticker 列进依赖会在拖拽
    // 每帧 setDragSticker 后重复比对，与未回流的旧 props 相较必然不 settled。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickers]);

  // 拖拽乐观值收尾：松手后 dragXY 暂时“钉”住落点（避免落库往返期间字幕闪回）。
  // 当 props.subtitlePositions 已回流确认该坐标（浮点容差比较）→ 清 dragXY，
  // 把控制权交还 props，避免乐观值永久滞留。
  useEffect(() => {
    if (!dragXY || !currentScene) return;
    const resolved = resolveSubtitleXY(
      currentScene.id,
      subtitleStyle,
      subtitlePositions
    );
    const settled =
      Math.abs(resolved.x - dragXY.x) < 0.001 &&
      Math.abs(resolved.y - dragXY.y) < 0.001;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 必须等 subtitlePositions prop 回流才清乐观值；改在渲染期比对会在落库往返期间提前清空，字幕闪回旧位
    if (settled) setDragXY(null);
    // 同上：只在 props 回流（subtitlePositions 变化）时比对，避免拖拽期间
    // dragXY 自身变化反复触发比对；currentScene/subtitleStyle 只作读取来源。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlePositions]);

  // 拖角改字号乐观值收尾：松手后 dragFontSize「钉」住松手字号；当 subtitleStyle
  // 回流确认（fontSize 已等于该值）→ 清空，把控制权交还 props，避免乐观值滞留。
  useEffect(() => {
    if (dragFontSize !== null && subtitleStyle?.fontSize === dragFontSize) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 必须等 subtitleStyle.fontSize 回流确认才清乐观字号；改在渲染期比对会在落库往返期间提前清空，字号闪回旧值
      setDragFontSize(null);
    }
    // 同上：只在 props 回流（subtitleStyle.fontSize 变化）时判定是否已确认；
    // 把 dragFontSize 列进依赖会让拖动中的每次本地改值都跑一遍无意义比对。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleStyle?.fontSize]);

  // 卸载时清滚轮防抖计时器，避免组件已卸载还触发落库。
  useEffect(() => {
    return () => {
      if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
    };
  }, []);

  // ── 字幕位置：拖拽与快捷选择 ──────────────────────────────────────────
  // 是否允许编辑字幕位置（提供回调才开放；只读预览不可拖）
  const subtitleEditable = !!onSubtitlePositionChange;
  // 是否允许拖拽贴图位置（提供回调才开放；只读预览不可拖，保持向后兼容）
  const stickerEditable = !!onStickerPositionChange;
  // 是否允许拖角改字号（提供回调才开放；与时间轴字幕样式弹窗同一数据源）
  const subtitleResizable = !!onSubtitleStyleChange;

  // 拖角改字号：按下记「指针到字幕中心的像素距离 + 起始字号」，
  // move 里按距离比例缩放，写回全片 subtitleStyle（剪映式，与面板同一实现）。
  const subtitleCenterPx = (): { cx: number; cy: number } => {
    const rect = subtitleBoxRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0 };
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  };

  const handleSubtitleResizeStart = (e: React.PointerEvent) => {
    if (!subtitleResizable || !subtitleStyle) return;
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 <p> 的位置拖拽
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { cx, cy } = subtitleCenterPx();
    resizeRef.current = {
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy),
      startFont: subtitleStyle.fontSize,
    };
  };

  const handleSubtitleResizeMove = (e: React.PointerEvent) => {
    const it = resizeRef.current;
    if (!it || !subtitleStyle) return;
    e.preventDefault();
    const { cx, cy } = subtitleCenterPx();
    const curDist = Math.hypot(e.clientX - cx, e.clientY - cy);
    const fontSize = resizeFontFromDistance(
      it.startFont,
      it.startDist,
      curDist,
      SUBTITLE_FONT_MIN,
      SUBTITLE_FONT_MAX
    );
    // 拖动中只更新本地乐观字号，即时渲染、零 HTTP 往返（避免被 refetch 刷回）。
    setDragFontSize(fontSize);
  };

  const handleSubtitleResizeEnd = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    resizeRef.current = null;
    // 松手才落库一次；不清 dragFontSize，留作乐观值「钉住」松手字号，
    // 待 subtitleStyle 回流确认后再由上方 effect 清空，避免闪回旧值。
    if (dragFontSize !== null && subtitleStyle) {
      onSubtitleStyleChange?.({ ...subtitleStyle, fontSize: dragFontSize });
    }
  };

  // 滚轮缩放字号：在字幕块上滚动即缩放（上滚放大 / 下滚缩小），每格 ±1px。
  // 滚动中只更新本地乐观值（即时、平滑，配合 CSS font-size 过渡），停止 400ms
  // 后防抖落库一次。preventDefault 阻止页面/弹窗跟着滚。
  const handleSubtitleWheel = (e: React.WheelEvent) => {
    if (!subtitleResizable || !subtitleStyle) return;
    e.preventDefault();
    e.stopPropagation();
    const base = dragFontSize ?? subtitleStyle.fontSize;
    // deltaY<0（上滚）放大，>0（下滚）缩小；每次 ±1px，clamp 到 UI 范围
    const step = e.deltaY < 0 ? 1 : -1;
    const next = Math.min(
      SUBTITLE_FONT_MAX,
      Math.max(SUBTITLE_FONT_MIN, base + step)
    );
    if (next === base) return;
    setDragFontSize(next);
    // 防抖落库：滚动停止 400ms 后写回一次
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = setTimeout(() => {
      onSubtitleStyleChange?.({ ...subtitleStyle, fontSize: next });
    }, 400);
  };

  // 当前分镜字幕的「生效坐标」：拖拽中用实时 dragXY，否则解析覆盖/全局默认
  const currentSubtitleXY = currentScene
    ? (dragXY ??
      resolveSubtitleXY(currentScene.id, subtitleStyle, subtitlePositions))
    : { x: 0.5, y: 0.88 };

  // 将鼠标/触摸的屏幕坐标换算为相对媒体容器的归一化坐标（clamp 0-1）
  const clientToNormalized = (
    clientX: number,
    clientY: number
  ): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0.5, y: 0.88 };
    }
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  };

  // 把字幕中心归一化坐标夹进「整块不出画面」的安全范围（与时间轴字幕样式面板
  // 的 clampCenterInBounds 同款）：按字幕块半宽/半高相对 stage 的比例内缩。
  // 字幕块比画面还大时退化居中，避免上下界翻转。
  const clampSubtitleCenter = (
    x: number,
    y: number
  ): { x: number; y: number } => {
    const stage = stageRef.current?.getBoundingClientRect();
    const box = subtitleBoxRef.current?.getBoundingClientRect();
    if (!stage || stage.width === 0 || stage.height === 0) {
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }
    const halfW = box ? box.width / 2 / stage.width : 0;
    const halfH = box ? box.height / 2 / stage.height : 0;
    const clampAxis = (v: number, half: number) =>
      half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, v));
    return { x: clampAxis(x, halfW), y: clampAxis(y, halfH) };
  };

  // 开始拖拽字幕：注册全局 move/up 监听，松手时回调落库
  const handleSubtitleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!subtitleEditable || !currentScene) return;
    e.preventDefault();
    e.stopPropagation();
    setShowQuickPos(false);

    const getPoint = (ev: MouseEvent | TouchEvent) => {
      if ("touches" in ev && ev.touches.length > 0) {
        return { cx: ev.touches[0].clientX, cy: ev.touches[0].clientY };
      }
      const me = ev as MouseEvent;
      return { cx: me.clientX, cy: me.clientY };
    };

    // 抓取偏移 = 按下点 - 当前字幕中心（拖动时新中心 = 指针 - 偏移）——
    // 与时间轴面板一致：按在字幕任意位置都跟手，不会把中心瞬移到指针下。
    const startPointer = clientToNormalized(
      getPoint(e.nativeEvent as MouseEvent | TouchEvent).cx,
      getPoint(e.nativeEvent as MouseEvent | TouchEvent).cy
    );
    const grabOffset = {
      x: startPointer.x - currentSubtitleXY.x,
      y: startPointer.y - currentSubtitleXY.y,
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const { cx, cy } = getPoint(ev);
      const p = clientToNormalized(cx, cy);
      // 新中心 = 指针 - 抓取偏移，再按字幕块尺寸夹进边界（整块不出画面）
      setDragXY(clampSubtitleCenter(p.x - grabOffset.x, p.y - grabOffset.y));
    };

    const onUp = (ev: MouseEvent | TouchEvent) => {
      const { cx, cy } = getPoint(ev);
      const p = clientToNormalized(cx, cy);
      const final = clampSubtitleCenter(p.x - grabOffset.x, p.y - grabOffset.y);
      // 关键：不在此清 dragXY。落库是「HTTP 往返 + refetch」的长异步，
      // 若立即清空，这一帧 currentSubtitleXY 会回退到尚未更新的旧 props，
      // 字幕瞬间跳回旧位置 → 等新数据回流再跳到新位 = 肉眼可见的闪烁。
      // 改为：保留 dragXY 作为乐观值“钉”住松手落点，待上方 effect 检测到
      // subtitlePositions 已确认该坐标后再清，全程零跳动。
      setDragXY(final);
      onSubtitlePositionChange?.(currentScene.id, final.x, final.y);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  };

  // 快捷位置选择：直接落库到当前分镜
  const applyQuickPosition = (x: number, y: number) => {
    if (!currentScene) return;
    onSubtitlePositionChange?.(currentScene.id, x, y);
    setShowQuickPos(false);
  };

  // 开始拖拽贴图：pointer capture + 本地乐观 dragSticker 跟手，松手落库一次。
  // 锚点公式与渲染一致：left_px = x*(W-w) → x = (left_px)/(W-w)，故位移换算
  // dx/(W-w)、dy/(H-h)。W===w 或 H===h 时分母护 0，该轴保持原值不动。
  const handleStickerDragStart = (
    e: React.PointerEvent<HTMLImageElement>,
    sticker: Sticker
  ) => {
    if (!stickerEditable) return;
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current?.getBoundingClientRect();
    const el = e.currentTarget;
    const elRect = el.getBoundingClientRect();
    if (!stage || stage.width === 0 || stage.height === 0) return;
    // 起始指针坐标 + 贴图当前锚点 + 可移动像素跨度（stage 尺寸 - 贴图尺寸）
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = sticker.x;
    const origY = sticker.y;
    const spanW = stage.width - elRect.width;
    const spanH = stage.height - elRect.height;
    el.setPointerCapture(e.pointerId);
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // 分母护 0：可移动跨度为 0（贴图与画面同宽/高）时该轴不动，保持原值
      const nx = spanW > 0 ? clamp01(origX + dx / spanW) : origX;
      const ny = spanH > 0 ? clamp01(origY + dy / spanH) : origY;
      setDragSticker({ id: sticker.id, x: nx, y: ny });
    };
    const onUp = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nx = spanW > 0 ? clamp01(origX + dx / spanW) : origX;
      const ny = spanH > 0 ? clamp01(origY + dy / spanH) : origY;
      // 不立即清 dragSticker：落库是 HTTP 往返 + refetch 的长异步，立即清会让
      // 这一帧回退到尚未更新的 props → 贴图闪回旧位。保留乐观值“钉”住落点，
      // 待 effect 检测到 stickers prop 已回流确认该坐标后再清（同字幕 dragXY）。
      setDragSticker({ id: sticker.id, x: nx, y: ny });
      onStickerPositionChange?.(sticker.id, nx, ny);
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return {
    dragXY,
    dragSticker,
    dragFontSize,
    subtitleBoxRef,
    subtitleEditable,
    stickerEditable,
    subtitleResizable,
    currentSubtitleXY,
    handleSubtitleDragStart,
    handleSubtitleResizeStart,
    handleSubtitleResizeMove,
    handleSubtitleResizeEnd,
    handleSubtitleWheel,
    handleStickerDragStart,
    applyQuickPosition,
  };
}
