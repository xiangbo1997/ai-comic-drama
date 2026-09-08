"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 媒体元素登记表 + 实测时长收集（无 effect，纯状态/ref/回调容器）。
 *
 * 本 hook 刻意不含任何 useEffect：组件内 effect 的相对顺序是时序契约的一部分，
 * 放在这里会改变顺序。命令式的 muted 管理仍留在组件内原位置。
 */
export function useMediaRegistry() {
  // 各视频分镜的「真实时长」（sceneId → 秒），由 <video> 的 onLoadedMetadata 填充。
  // provider 常忽略请求时长返回 ~8s 片段，DB 的 scene.duration（LLM 估算，默认 3s）
  // 与真实长度不符——用真实值驱动计时器，避免播放到一半跳镜/循环。
  const [measuredDurs, setMeasuredDurs] = useState<Record<string, number>>({});
  // 各分镜配音的「真实音频时长」（sceneId → 秒），由 <audio> 的 onLoadedMetadata
  // 填充。字幕逐句节奏据此对齐（跟着语音走完 + 末句停驻到镜末），与导出端
  // generateSubtitleFile 探测 audioUrl 时长的语义一致（预览必须反映导出效果）。
  const [measuredAudioDurs, setMeasuredAudioDurs] = useState<
    Record<string, number>
  >({});

  // 按 sceneId 缓存已挂载的 <video> DOM 节点。两层媒体从「单一 keyed 数组」
  // 渲染，key=scene.id：currentIndex 前进时，原「下一镜」节点被 React 依 key
  // 复用为「当前镜」，同一 DOM 节点播放不中断（消除切镜 remount 卡顿）。
  // 所有播放/暂停/静音都据此表按 scene.id 直接取节点（不再用角色 ref，
  // 避免角色互换后 ref 指向失效 + effect 时序竞态）。
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);

  // 记录视频真实时长（onLoadedMetadata 触发）：仅接受有限正数，且与已存值相同时
  // 不重复 setState（避免无谓重渲）。当前镜与下一镜的 <video> 都会回调，越早读到
  // 下一镜真实时长，effDurs/计时器越早对齐。
  const handleLoadedMetadata = (
    sceneId: string,
    el: HTMLVideoElement | null
  ) => {
    if (!el) return;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    setMeasuredDurs((prev) => {
      if (prev[sceneId] === d) return prev;
      return { ...prev, [sceneId]: d };
    });
  };

  // 记录配音真实音频时长（<audio> onLoadedMetadata 触发）：供字幕逐句节奏对齐
  // （与导出端探测 audioUrl 时长同语义）。仅接受有限正数，与已存值相同则不重渲。
  const handleAudioLoadedMetadata = (
    sceneId: string,
    el: HTMLAudioElement | null
  ) => {
    if (!el) return;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    setMeasuredAudioDurs((prev) => {
      if (prev[sceneId] === d) return prev;
      return { ...prev, [sceneId]: d };
    });
  };

  // 按 sceneId 缓存「稳定的 ref 回调」——关键修复：
  // 若在 JSX 里写内联 `ref={(el)=>...}`，该函数每次渲染 identity 都变，
  // React 每次 commit 都会先以 null 卸载旧 ref 再挂新 ref。播放中每 30ms
  // setState 触发全量重渲 → <video> 被反复 detach/attach → 浏览器丢失
  // src 绑定，最终判定「无可用源」（NotSupportedError / networkState=3），
  // 视频既不加载也不播放（黑屏「看不了」）。
  // 用 useCallback 记忆每个 sceneId 的回调，identity 恒定 → React 不再
  // 每帧重挂 ref，<video> 稳定持有 src，正常加载播放。
  const videoRefCbCache = useRef<
    Map<string, (el: HTMLVideoElement | null) => void>
  >(new Map());
  const getVideoRefCb = useCallback((sceneId: string) => {
    const cache = videoRefCbCache.current;
    let cb = cache.get(sceneId);
    if (!cb) {
      cb = (el: HTMLVideoElement | null) => {
        if (el) videoElsRef.current.set(sceneId, el);
        else videoElsRef.current.delete(sceneId);
      };
      cache.set(sceneId, cb);
    }
    return cb;
  }, []);

  return {
    measuredDurs,
    measuredAudioDurs,
    videoElsRef,
    audioRef,
    bgmRef,
    handleLoadedMetadata,
    handleAudioLoadedMetadata,
    getVideoRefCb,
  };
}
