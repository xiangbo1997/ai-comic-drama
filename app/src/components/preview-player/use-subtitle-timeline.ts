"use client";

import { useMemo } from "react";
import type { ScenePreview } from "@/types";
// 逐句字幕切分 + 时间窗分配（与导出端 video-synthesis 共用同一权威实现，
// 保证「逐句显示 + 淡入」在预览与成片两端时轴一致——预览=导出调试窗口）。
import {
  splitSubtitleSegments,
  allocateSubtitleWindows,
} from "@/lib/subtitle-segments";

interface SubtitleTimelineArgs {
  currentScene: ScenePreview | undefined;
  measuredAudioDurs: Record<string, number>;
  effDurs: number[];
  currentIndex: number;
  progress: number;
}

interface SubtitleTimelineResult {
  subtitleWindows: ReturnType<typeof allocateSubtitleWindows>;
  activeSubtitleIndex: number;
  activeSubtitleText: string;
  activeSubtitleDuration: number;
}

/**
 * 逐句字幕时间窗 + 当前生效句的选择（纯 memo 逻辑，无副作用）。
 *
 * 时长用实测有效时长 effDurs[currentIndex]（与画面/配音同源），非 DB 声明值。
 */
export function useSubtitleTimeline({
  currentScene,
  measuredAudioDurs,
  effDurs,
  currentIndex,
  progress,
}: SubtitleTimelineArgs): SubtitleTimelineResult {
  // 逐句字幕：把当前镜的对白/旁白切成短句 + 按视觉宽度分配时间窗，与导出端
  // （video-synthesis.generateSubtitleFile）共用 splitSubtitleSegments /
  // allocateSubtitleWindows，保证「逐句显示 + 淡入」的切句与时轴两端一致。
  // 时长用实测有效时长 effDurs[currentIndex]（与画面/配音同源），非 DB 声明值。
  const subtitleWindows = useMemo(() => {
    const text = currentScene?.dialogue || currentScene?.narration || "";
    if (!text) return [];
    const segments = splitSubtitleSegments(text);
    const dur = effDurs[currentIndex] ?? currentScene?.duration ?? 0;
    // 配音真实音频时长（有则字幕逐句节奏按它走完 + 末句停驻到镜末，与导出端同源）
    const voiceDur = currentScene
      ? measuredAudioDurs[currentScene.id]
      : undefined;
    return allocateSubtitleWindows(segments, dur, voiceDur);
  }, [currentScene, measuredAudioDurs, effDurs, currentIndex]);

  // 当前生效的字幕句：progress×有效时长落在哪个时间窗即显示该句。
  // 播放中随 progress 逐句切换；暂停/拖动时显示 progress 位置对应句；
  // progress=0 显示首句（让用户始终有一句可拖拽定位）。
  const activeSubtitleIndex = useMemo(() => {
    if (subtitleWindows.length === 0) return -1;
    const dur = effDurs[currentIndex] ?? currentScene?.duration ?? 0;
    const t = progress * dur;
    const idx = subtitleWindows.findIndex((w) => t >= w.start && t < w.end);
    // 落在末窗右边界（t === dur）或未命中时兜底末句；progress=0 命中首句
    return idx >= 0 ? idx : subtitleWindows.length - 1;
  }, [
    subtitleWindows,
    progress,
    effDurs,
    currentIndex,
    currentScene?.duration,
  ]);

  // 当前要渲染的字幕文本（无逐句结果时回退整段，兜底极端情况）
  const activeSubtitleText =
    activeSubtitleIndex >= 0
      ? subtitleWindows[activeSubtitleIndex].text
      : currentScene?.dialogue || currentScene?.narration || "";

  // 当前句时间窗时长（秒）：typewriter 逐字延迟的压缩上限用（与导出端同源）。
  const activeSubtitleDuration =
    activeSubtitleIndex >= 0
      ? subtitleWindows[activeSubtitleIndex].end -
        subtitleWindows[activeSubtitleIndex].start
      : 0;

  return {
    subtitleWindows,
    activeSubtitleIndex,
    activeSubtitleText,
    activeSubtitleDuration,
  };
}
