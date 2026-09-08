"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ScenePreview } from "@/types";
import type { SceneSfx, Transition } from "@/types/export-style";
// 音效库（纯数据）：预览端按导出同源的触发时刻调度 <audio>（预览必须反映导出效果）
import { getSfxById } from "@/lib/sfx-library";

interface SfxSchedulerArgs {
  sfx: SceneSfx[] | undefined;
  scenes: ScenePreview[];
  prefixDurations: number[];
  effDurs: number[];
  transitions: Transition[] | undefined;
  currentIndex: number;
  progress: number;
  isPlaying: boolean;
  isMuted: boolean;
}

interface SfxSchedulerResult {
  /**
   * 播放结束回到片头时由计时器调用：清空音效已触发集合 + 时刻基准，
   * 否则下一轮播放 sfxFiredRef 仍是满的，整片一个音效都不响。
   */
  resetSfxProgress: () => void;
}

/**
 * ── SFX 音效调度（批1，与导出端 buildSfxSchedule 同源语义）────────────
 *
 * 触发表：显式配置（sceneStart+offsetSec）+ 转场自动 whoosh（携带 sfx 配置且
 * 该衔接为显式非硬切转场时，与导出端 wantAutoTransitionSfx 契约一致）。
 */
export function useSfxScheduler({
  sfx,
  scenes,
  prefixDurations,
  effDurs,
  transitions,
  currentIndex,
  progress,
  isPlaying,
  isMuted,
}: SfxSchedulerArgs): SfxSchedulerResult {
  const sfxSchedule = useMemo(() => {
    if (sfx === undefined) return [];
    const idxById = new Map(scenes.map((s, i) => [s.id, i]));
    const items: { url: string; triggerSec: number; volume: number }[] = [];
    for (const s of sfx) {
      const entry = getSfxById(s.sfxId);
      const idx = idxById.get(s.sceneId);
      if (!entry || idx === undefined) continue;
      const offset = Number.isFinite(s.offsetSec)
        ? Math.max(0, s.offsetSec)
        : 0;
      items.push({
        url: entry.file,
        triggerSec: (prefixDurations[idx] ?? 0) + offset,
        volume:
          typeof s.volume === "number" && Number.isFinite(s.volume)
            ? Math.min(1, Math.max(0, s.volume))
            : entry.defaultVolume,
      });
    }
    // 转场自动 whoosh：显式非硬切转场的衔接点补一记疾风（同导出端默认值 0.5）
    const whoosh = getSfxById("whoosh-fast");
    if (whoosh && Array.isArray(transitions)) {
      for (let k = 0; k < scenes.length - 1; k += 1) {
        const t = transitions[k];
        if (t && t.type && t.type !== "none") {
          items.push({
            url: whoosh.file,
            triggerSec: prefixDurations[k + 1] ?? 0,
            volume: 0.5,
          });
        }
      }
    }
    return items.sort((a, b) => a.triggerSec - b.triggerSec);
  }, [sfx, scenes, prefixDurations, transitions]);

  // 已触发集合 + 活动音频（暂停/回退/卸载时统一停止）。
  // lastElapsed 用于识别「回退/跳转」：时间倒流则重建已触发集合（<= 新时刻的
  // 视为已触发但不补播），避免 seek 后旧音效连环补放。
  const sfxFiredRef = useRef<Set<number>>(new Set());
  const sfxActiveRef = useRef<Set<HTMLAudioElement>>(new Set());
  const sfxLastElapsedRef = useRef(0);
  useEffect(() => {
    if (sfxSchedule.length === 0) return;
    const elapsed =
      (prefixDurations[currentIndex] ?? 0) +
      (effDurs[currentIndex] ?? 0) * progress;

    // 回退/跳转：时间倒流 → 已触发集合重建为「时刻之前的全部」，不补播
    if (elapsed < sfxLastElapsedRef.current - 0.2) {
      const rebuilt = new Set<number>();
      sfxSchedule.forEach((item, i) => {
        if (item.triggerSec <= elapsed) rebuilt.add(i);
      });
      sfxFiredRef.current = rebuilt;
    }
    sfxLastElapsedRef.current = elapsed;

    if (!isPlaying) return;
    sfxSchedule.forEach((item, i) => {
      if (sfxFiredRef.current.has(i) || item.triggerSec > elapsed) return;
      sfxFiredRef.current.add(i);
      // 仅在触发时刻附近 0.6s 内真正发声：跨大步前进（seek）越过的旧触发点只标记不补播
      if (elapsed - item.triggerSec > 0.6 || isMuted) return;
      const audio = new Audio(item.url);
      audio.volume = item.volume;
      sfxActiveRef.current.add(audio);
      // 播完 / 起播失败都要释放：仅从集合里删不够，还需 pause + 清 src 断开
      // 媒体资源，否则每轮播放都在堆积游离 <audio>（长片 + 反复预览会吃满内存）。
      const release = () => {
        audio.pause();
        audio.src = "";
        sfxActiveRef.current.delete(audio);
      };
      audio.addEventListener("ended", release);
      audio.play().catch(release);
    });
  }, [
    sfxSchedule,
    progress,
    currentIndex,
    isPlaying,
    isMuted,
    prefixDurations,
    effDurs,
  ]);

  // 暂停/卸载：停止所有在放音效（环境音长达 15s，必须跟随暂停）。
  // 停止时一并清 src 释放媒体资源，与上方 release 同语义。
  //
  // 只读 sfxActiveRef（恒定 ref 容器）、不闭包任何随渲染变化的值，故用空依赖
  // useCallback 即得恒定 identity——原组件内是「每渲染重建函数 + 写进 ref」，
  // 两者对调用方等价（拿到的永远是这份实现），但无需在渲染期读 ref。
  const stopAllSfx = useCallback(() => {
    const active = sfxActiveRef.current;
    active.forEach((a) => {
      a.pause();
      a.src = "";
    });
    active.clear();
  }, []);
  useEffect(() => {
    if (isPlaying) {
      // 起播（含播完归零后再次播放）：清空已触发集合与上次时刻，否则
      // sfxFiredRef 仍保留上一轮的全部索引，第二遍播放整片无音效。
      // 时刻基准归零同步重置，避免被判成「时间倒流」而重建集合。
      sfxFiredRef.current = new Set();
      sfxLastElapsedRef.current = 0;
      return;
    }
    stopAllSfx();
  }, [isPlaying, stopAllSfx]);
  useEffect(() => () => stopAllSfx(), [stopAllSfx]);

  // 播放结束回到片头时的重置入口：语义与起播重置完全一致（同两行赋值），
  // 供计时器在 wrap-around 分支调用（原为组件内直接改这两个 ref）。
  const resetSfxProgress = useCallback(() => {
    sfxFiredRef.current = new Set();
    sfxLastElapsedRef.current = 0;
  }, []);

  return { resetSfxProgress };
}
