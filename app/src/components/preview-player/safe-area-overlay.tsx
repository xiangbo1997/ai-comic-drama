"use client";

import { VERTICAL_SAFE, VERTICAL_SAFE_LEFT } from "@/lib/safe-area";

/**
 * 平台 UI 安全区参考层 —— 把「抖音/快手会盖住哪块画面」画在预览里。
 *
 * 预览是导出的调试窗口：字幕/水印/AI 标识落在遮挡区，网页预览里一切正常，
 * 只有真机发布后才发现被平台 UI 盖掉半截。本层用虚线框 + 半透明红斑标出
 * lib/safe-area 的 VERTICAL_SAFE 边界，让用户在摆位置时就能看见风险。
 *
 * 纯装饰层：pointer-events-none 不吃指针（不挡字幕拖拽），
 * z-10 遵循本项目约定（媒体层带显式 zIndex 1/2，stage 内覆盖元素必须显式高于它）。
 * 默认关闭，由调用方通过 visible 控制。
 */
export function SafeAreaOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  const topPct = VERTICAL_SAFE.top * 100;
  const bottomPct = (1 - VERTICAL_SAFE.bottom) * 100;
  const rightPct = (1 - VERTICAL_SAFE.right) * 100;
  const leftPct = VERTICAL_SAFE_LEFT * 100;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* 顶部遮挡带：状态栏 + 平台顶部 Tab */}
      <div
        className="absolute inset-x-0 top-0 bg-red-500/10"
        style={{ height: `${topPct}%` }}
      />
      {/* 底部遮挡带：作者昵称 / 文案 / 话题 / 进度条 */}
      <div
        className="absolute inset-x-0 bottom-0 bg-red-500/10"
        style={{ height: `${bottomPct}%` }}
      />
      {/* 右侧遮挡带：竖排互动按钮（仅在上下遮挡带之间画，避免四角叠色） */}
      <div
        className="absolute right-0 bg-red-500/10"
        style={{
          top: `${topPct}%`,
          bottom: `${bottomPct}%`,
          width: `${rightPct}%`,
        }}
      />
      {/* 内容可用区虚线框 */}
      <div
        className="absolute rounded-sm border border-dashed border-red-400/70"
        style={{
          top: `${topPct}%`,
          bottom: `${bottomPct}%`,
          left: `${leftPct}%`,
          right: `${rightPct}%`,
        }}
      />
      <span
        className="absolute left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-red-200"
        style={{ top: `calc(${topPct}% + 4px)` }}
      >
        平台安全区（红色区域会被抖音/快手 UI 遮挡）
      </span>
    </div>
  );
}
