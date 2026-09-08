"use client";

import { useEffect, type RefObject } from "react";
import type { ScenePreview } from "@/types";
import type { BackgroundMusic } from "@/types/export-style";
// BGM 音量包络（纯函数，近似导出端 buildBgmFilter 的 fadeIn/fadeOut/ducking）
import { bgmVolumeAt } from "../preview-bgm-envelope";

interface BgmArgs {
  backgroundMusic: BackgroundMusic | undefined;
  bgmRef: RefObject<HTMLAudioElement | null>;
  prefixDurations: number[];
  effDurs: number[];
  currentIndex: number;
  progress: number;
  totalDuration: number;
  currentScene: ScenePreview | undefined;
  isPlaying: boolean;
}

/**
 * BGM 音量包络：按整片已播时刻做 fadeIn / fadeOut / ducking（近似导出端
 * buildBgmFilter）。progress 每 30ms 更新驱动本 effect 平滑 ramp <audio>.volume。
 * 静音由组件内 muted effect 独立管理（bgmRef.muted），此处只算 .volume，两者正交。
 * 整片已播时刻 = 前缀和(已完成镜) + 当前镜有效时长 × progress，与整体进度条同源。
 */
export function useBgm({
  backgroundMusic,
  bgmRef,
  prefixDurations,
  effDurs,
  currentIndex,
  progress,
  totalDuration,
  currentScene,
  isPlaying,
}: BgmArgs): void {
  useEffect(() => {
    const bgm = backgroundMusic;
    if (!bgmRef.current || !bgm?.enabled || !bgm.url) return;
    const elapsedBefore = prefixDurations[currentIndex] ?? 0;
    const elapsed = elapsedBefore + (effDurs[currentIndex] ?? 0) * progress;
    // 对白/旁白配音正在播 → ducking 压低（当前镜有配音音轨且正在播放）
    const voiceActive = !!currentScene?.audioUrl && isPlaying;
    bgmRef.current.volume = bgmVolumeAt(
      {
        volume: bgm.volume ?? 0.25,
        fadeIn: bgm.fadeIn ?? 0,
        fadeOut: bgm.fadeOut ?? 0,
        ducking: bgm.ducking ?? false,
      },
      elapsed,
      totalDuration,
      voiceActive
    );
    // bgmRef 为恒定 ref 容器，与组件内原实现保持同一依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backgroundMusic,
    progress,
    currentIndex,
    isPlaying,
    currentScene,
    prefixDurations,
    effDurs,
    totalDuration,
  ]);
}
