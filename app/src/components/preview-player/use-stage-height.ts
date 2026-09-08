"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * 跟踪画面框实际像素高 → 驱动字号等比缩放（响应式布局/拖窗都实时更新）。
 * ResizeObserver 比 window.resize 更准：框高随容器内缩规则变化，非仅窗口尺寸。
 */
export function useStageHeight(stageRef: RefObject<HTMLDivElement | null>) {
  // 画面框实际像素高：用于把字号从 1080 基准缩放到当前预览尺寸，
  // 使「预览字号 ≈ 成片字号」。由 ResizeObserver 实时跟踪（响应式/拖窗）。
  const [stageHeight, setStageHeight] = useState(0);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // stageRef 为恒定 ref 容器，与组件内原实现保持同一空依赖数组（仅挂载时接管）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return stageHeight;
}
