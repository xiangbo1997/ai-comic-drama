"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ScenePreview } from "@/types";
import type { BackgroundMusic } from "@/types/export-style";

interface PlaybackClockArgs {
  scenes: ScenePreview[];
  currentScene: ScenePreview | undefined;
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  progress: number;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  transitionT: number;
  setTransitionT: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  /** 外部选中分镜在有效数组中的下标（-1 = 无外部选中） */
  sceneIndex: number;
  /** 当前镜有效时长（受变速与实测时长影响），用于计时器 ref 镜像 */
  curEffDuration: number;
  /** 当前镜右侧转场时长（秒） */
  curTransitionDuration: number;
  /** 当前镜变速倍率（视频 playbackRate 对齐） */
  curSpeed: number;
  emitSceneChange: (sceneId: string) => void;
  videoElsRef: RefObject<Map<string, HTMLVideoElement>>;
  audioRef: RefObject<HTMLAudioElement | null>;
  bgmRef: RefObject<HTMLAudioElement | null>;
  backgroundMusic: BackgroundMusic | undefined;
  /** 播完归零时清空 SFX 已触发集合（由 useSfxScheduler 提供） */
  resetSfxProgress: () => void;
}

/**
 * 播放时钟：30ms 计时器驱动 progress / 转场进度 / 切镜 / 播完归零，
 * 以及外部选中同步、当前镜时长镜像 ref、手动切镜时的转场进度重置。
 *
 * 时序铁律（原样保留自 preview-player.tsx）：
 * - 计时器 effect 刻意不依赖 measuredDurs / transitions（依赖变了会重启定时器，
 *   进度跳回起点），改由 curDurationMsRef / curTransitionMsRef 在 tick 内现取。
 * - 播放/暂停都据 videoElsRef 表按 scene.id 直接取节点，不依赖角色 ref（避免
 *   keyed 复用后 ref 指向失效 + effect 时序竞态）。
 */
export function usePlaybackClock({
  scenes,
  currentScene,
  currentIndex,
  setCurrentIndex,
  setProgress,
  setTransitionT,
  isPlaying,
  setIsPlaying,
  sceneIndex,
  curEffDuration,
  curTransitionDuration,
  curSpeed,
  emitSceneChange,
  videoElsRef,
  audioRef,
  bgmRef,
  backgroundMusic,
  resetSfxProgress,
}: PlaybackClockArgs): void {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 同步外部选中的场景
  useEffect(() => {
    if (sceneIndex !== -1 && sceneIndex !== currentIndex) {
      setCurrentIndex(sceneIndex);
      setProgress(0);
    }
    // 仅当外部选中项变化时才跟随跳镜；把 currentIndex 列进依赖会让内部
    // 自然播放推进的切镜被这里立刻拽回外部选中的那一镜。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIndex]);

  // 当前镜「有效时长 / 转场时长」的最新值镜像（毫秒）。
  // 计时器 effect 刻意不依赖 measuredDurs / transitions（依赖变了会重启定时器，
  // 进度跳回起点），故把最新值经这个廉价 effect 写进 ref，供 30ms tick 现取，
  // 使「预览必须反映导出效果」在实测时长回填/转场时长编辑时也成立。
  const curDurationMsRef = useRef(0);
  const curTransitionMsRef = useRef(0);
  useEffect(() => {
    curDurationMsRef.current = curEffDuration * 1000;
    curTransitionMsRef.current = curTransitionDuration * 1000;
  }, [curEffDuration, curTransitionDuration]);

  // 播放控制：进度按「有效时长」计时；进入末尾转场窗口后驱动双层叠化
  useEffect(() => {
    if (isPlaying && currentScene) {
      // 该镜右侧转场时长（末镜无转场）
      const hasNext = currentIndex < scenes.length - 1;
      const startTime = Date.now();

      timerRef.current = setInterval(() => {
        // 时长与转场时长每 tick 从 ref 现取（而非闭包快照）：视频
        // onLoadedMetadata 回填实测时长、或用户在播放中改转场时长时，当前这一镜
        // 立刻按新值计时，无需重启定时器（重启会让进度跳回起点）。
        const durationMs = curDurationMsRef.current;
        const tdMs = hasNext ? curTransitionMsRef.current : 0;
        const elapsed = Date.now() - startTime;
        const sceneProgress =
          durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
        setProgress(sceneProgress);

        // 转场叠化：进入 [durationMs - tdMs, durationMs] 窗口时，
        // transitionT 从 0 线性升到 1（驱动下一镜淡入/当前镜淡出）
        if (tdMs > 0) {
          const remain = durationMs - elapsed;
          if (remain <= tdMs) {
            setTransitionT(Math.min(1, (tdMs - remain) / tdMs));
          }
        }

        if (sceneProgress >= 1) {
          if (hasNext) {
            setCurrentIndex((prev) => prev + 1);
            setProgress(0);
            setTransitionT(0);
            emitSceneChange(scenes[currentIndex + 1].id);
          } else {
            // 播放结束，回到片头：清空音效已触发集合，否则下一轮播放
            // sfxFiredRef 仍是满的，整片一个音效都不响。
            setIsPlaying(false);
            setProgress(0);
            setTransitionT(0);
            setCurrentIndex(0);
            resetSfxProgress();
          }
        }
      }, 30);

      // 播放当前镜视频：从 videoElsRef 表按 scene.id 直接取节点，不依赖
      // videoRef.current（角色 ref 由另一 effect 同步，运行时机晚于本 effect，
      // 此处直接查表避免时序竞态）。切镜后原「下一镜」节点经 keyed 复用为当前镜，
      // 已在播；对已在播元素再调 play() 无副作用（不重置进度）。
      if (currentScene.videoUrl) {
        const el = videoElsRef.current.get(currentScene.id);
        if (el) {
          // 预览必须反映导出效果（铁律）：分镜变速在导出端由 atempo+setpts 实现，
          // 预览端此前从不设 playbackRate → 视频恒 1x 播放，但计时器按「有效时长
          // (真实时长/speed)」提前切镜，导致 speed>1 时预览被提前切走、speed<1 时
          // 没播完就切 = 预览节奏≠成片。这里把视频播放速率对齐变速倍率。
          // TTS 配音（audioRef）保持 1x：导出端配音不变速（atempo 仅作用于视频自带音轨）。
          el.playbackRate = curSpeed;
          el.play().catch(() => {});
        }
      }

      // 播放音频
      if (audioRef.current && currentScene.audioUrl) {
        audioRef.current.play().catch(() => {});
      }

      // 播放背景音乐（循环，让用户在预览里听到导出后的 BGM）。
      // 音量不在此写死——由下方「BGM 包络」effect 按整片进度做 fadeIn/fadeOut/
      // ducking，起播瞬时音量也由该 effect 立即算好（避免首帧突然满音量）。
      if (bgmRef.current && backgroundMusic?.enabled && backgroundMusic.url) {
        bgmRef.current.play().catch(() => {});
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      // 暂停当前镜视频（同样查表，避免依赖角色 ref 时序）
      if (currentScene?.videoUrl) {
        videoElsRef.current.get(currentScene.id)?.pause();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (bgmRef.current) {
        bgmRef.current.pause();
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    // 时长/转场时长刻意不入依赖（改则重启定时器、进度跳回起点），
    // 改由上方 curDurationMsRef / curTransitionMsRef 在 tick 内现取最新值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentIndex, currentScene, scenes, emitSceneChange]);

  // 手动切换分镜时重置转场进度
  useEffect(() => {
    setTransitionT(0);
    // setTransitionT 为 useState setter（identity 恒定），依赖数组与组件内原实现
    // 保持一致，只以 currentIndex 为触发源。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);
}
