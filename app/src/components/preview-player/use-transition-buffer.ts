"use client";

import { useEffect, type RefObject } from "react";
import type { ScenePreview } from "@/types";

interface TransitionBufferArgs {
  currentScene: ScenePreview | undefined;
  nextScene: ScenePreview | null;
  isPlaying: boolean;
  transitionT: number;
  /** 下一镜变速倍率（转场预播时对齐，预览=成片） */
  nextSpeed: number;
  /** 当前镜是否处于镜尾定格窗内 */
  curFreezeActive: boolean;
  videoElsRef: RefObject<Map<string, HTMLVideoElement>>;
}

/**
 * 双缓冲媒体的命令式控制：镜尾定格 + 转场预播下一镜。
 *
 * 两个 effect 相邻且顺序固定（定格在前、转场预播在后），与组件内原实现一致；
 * 都据 videoElsRef 表按 scene.id 直接取节点，不依赖角色 ref（keyed 复用后
 * 角色互换，角色 ref 会指向失效 + 存在 effect 时序竞态）。
 */
export function useTransitionBuffer({
  currentScene,
  nextScene,
  isPlaying,
  transitionT,
  nextSpeed,
  curFreezeActive,
  videoElsRef,
}: TransitionBufferArgs): void {
  // 定格冲击（批4）：镜尾 tailSec 内暂停当前镜视频画面（近似导出端「镜内定格」，
  // 图片镜本就静止天然成立）。离开定格窗（回退/切镜）且仍在播放时恢复。
  // 计时器与音频不动——定格只冻画面，时轴与配音照常走（与导出端 trim+tpad 净时长守恒一致）。
  useEffect(() => {
    if (!currentScene?.videoUrl) return;
    const el = videoElsRef.current.get(currentScene.id);
    if (!el) return;
    if (curFreezeActive && isPlaying) {
      el.pause();
    } else if (isPlaying && el.paused) {
      el.play().catch(() => {});
    }
    // videoElsRef 为恒定 ref 容器，与组件内原实现保持同一依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curFreezeActive, isPlaying, currentScene]);

  // 转场预播：转场窗口开始（transitionT>0）时起播「下一镜」底层视频（静音），
  // 让叠化淡入时看到真实运动画面而非冻结首帧。转场未完成即结束（手动跳镜/暂停
  // 令 transitionT 归 0）时，暂停并把底层视频复位到起点，下次转场从头播。
  // 说明：正常播完切镜时 currentIndex 前进、该底层节点经 keyed 复用变为当前镜，
  // 已在播不需复位；此处的复位只作用于「转场中断」这一路径。
  useEffect(() => {
    // 直接查表取「下一镜」视频节点，不依赖 nextVideoRef 时序（同 play 控制）。
    const nextEl = nextScene?.videoUrl
      ? videoElsRef.current.get(nextScene.id)
      : undefined;
    if (!nextEl) return;
    if (transitionT > 0 && isPlaying) {
      // 转场预播下一镜时同样对齐其变速倍率（预览=成片），与当前镜播放速率同源
      nextEl.playbackRate = nextSpeed;
      // play() 的 promise 拒绝（如自动播放策略）吞掉，不阻断预览
      nextEl.play().catch(() => {});
    } else if (transitionT === 0) {
      // 转场结束/未开始：暂停并复位底层视频，下次转场从头播
      nextEl.pause();
      try {
        nextEl.currentTime = 0;
      } catch {
        // 某些浏览器在 metadata 未就绪时设 currentTime 抛错，忽略即可
      }
    } else {
      // 转场进行中但已暂停（transitionT>0 且 !isPlaying）：暂停底层但不复位，
      // 恢复播放时能接着叠化，避免底层继续无声播放。
      nextEl.pause();
    }
    // videoElsRef 为恒定 ref 容器，与组件内原实现保持同一依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionT, isPlaying, nextScene, nextSpeed]);
}
