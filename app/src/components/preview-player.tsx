"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ScenePreview } from "@/types";
import type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  TransitionType,
  SceneEffect,
  SceneEffectId,
  BackgroundMusic,
} from "@/types/export-style";
import {
  resolveSubtitleXY,
  resolveSubtitleFontPx,
  SUBTITLE_FONT_BASE_HEIGHT,
  SUBTITLE_QUICK_POSITIONS,
} from "@/types/export-style";
// 逐句字幕切分 + 时间窗分配（与导出端 video-synthesis 共用同一权威实现，
// 保证「逐句显示 + 淡入」在预览与成片两端时轴一致——预览=导出调试窗口）。
import {
  splitSubtitleSegments,
  allocateSubtitleWindows,
  typewriterDelays,
} from "@/lib/subtitle-segments";
import type { SubtitleAnimation } from "@/types/export-style";
// 字幕动效关键帧 + CSS 简写（与字幕样式面板共用同一实现，时序读 SUBTITLE_ANIM，
// 与导出端 ASS 标签对齐——预览=成片）。
import {
  SUBTITLE_KEYFRAMES_CSS,
  getSubtitleAnimationCss,
} from "@/lib/subtitle-css";
// 剪映式拖角改字号的纯函数（与时间轴字幕样式面板共用同一实现，保证两处手感一致）
import { resizeFontFromDistance } from "@/lib/subtitle-resize";
import { SceneFilterDefs, sceneFilterCss } from "./scene-filters";

interface PreviewPlayerProps {
  scenes: ScenePreview[];
  aspectRatio: string;
  onSceneChange?: (sceneId: string) => void;
  currentSceneId?: string;
  /** 全片字幕样式（与导出保持一致的预览） */
  subtitleStyle?: SubtitleStyle;
  /**
   * 各分镜字幕位置覆盖（按 sceneId）。未含某分镜时回退 subtitleStyle.position。
   * 由编辑器从 generationParams.subtitlePositions 注入。
   */
  subtitlePositions?: SubtitlePosition[];
  /**
   * 用户拖拽 / 快捷选择字幕位置时回调（归一化中心点坐标）。
   * 上层负责落库到 generationParams.subtitlePositions（按 sceneId upsert）。
   * 缺省时字幕不可拖拽（纯预览只读，如导出弹窗内的预览）。
   */
  onSubtitlePositionChange?: (sceneId: string, x: number, y: number) => void;
  /**
   * 用户在预览里拖字幕四角改字号时回调（全片统一样式）。
   * 上层负责落库到 generationParams.subtitleStyle。与时间轴字幕样式弹窗同一数据源，
   * 保证两处一致。缺省时不显示角控点（纯预览只读）。
   */
  onSubtitleStyleChange?: (style: SubtitleStyle) => void;
  /** 全片商标水印（预览叠加 logo） */
  watermark?: Watermark;
  /** 贴图列表（预览时按当前分镜叠加） */
  stickers?: Sticker[];
  /** 分镜间转场（第 k 项 = 第 k 与 k+1 分镜之间），双层叠化预览 */
  transitions?: Transition[];
  /** 分镜滤镜 / 变速（按 sceneId），预览用 SVG filter 精确复现 */
  sceneEffects?: SceneEffect[];
  /** 背景音乐（预览时循环播放，让用户听到导出后的 BGM 效果） */
  backgroundMusic?: BackgroundMusic;
}

/**
 * 把 aspectRatio 字符串（"9:16" / "1:1" / "16:9"）转成 CSS aspect-ratio 值。
 * 用于「画面框」声明式锁定成片比例——框即成片画布，字幕拖拽以此为坐标基准，
 * 与导出 ASS \pos(x*W,y*H) 像素级对齐（W/H 同比例，归一化坐标落点一致）。
 * 非法值回退 16/9。
 */
function aspectRatioToCss(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map((n) => Number(n));
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return "16 / 9";
}

/** 解析某分镜的滤镜 id 与变速（与导出侧 resolveSceneEffect 等价） */
function resolveEffect(
  sceneId: string,
  effects?: SceneEffect[]
): { effect: SceneEffectId | null; speed: number } {
  const found = effects?.find((e) => e.sceneId === sceneId);
  const speed =
    found?.speed != null && !isNaN(Number(found.speed))
      ? Math.min(4, Math.max(0.25, Number(found.speed)))
      : 1;
  return { effect: found?.effect ?? null, speed };
}

/** 解析某衔接的转场类型与时长（缺省 fade 0.3s；"none" 视为无转场） */
function resolveTransition(
  index: number,
  transitions?: Transition[]
): { type: TransitionType; duration: number } {
  const t = transitions?.[index];
  const type = t?.type ?? "fade";
  const duration =
    type === "none"
      ? 0
      : Math.min(2, Math.max(0.1, Number(t?.duration ?? 0.3)));
  return { type, duration };
}

export function PreviewPlayer({
  scenes,
  aspectRatio,
  onSceneChange,
  currentSceneId,
  subtitleStyle,
  subtitlePositions,
  onSubtitlePositionChange,
  onSubtitleStyleChange,
  watermark,
  stickers,
  transitions,
  sceneEffects,
  backgroundMusic,
}: PreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  // 转场进度 0-1：>0 表示正在向下一镜叠化（驱动双层透明度/位移）
  const [transitionT, setTransitionT] = useState(0);
  // 字幕拖拽态：拖拽中实时落点（归一化），用于无延迟跟手；松手时回调落库
  const [dragXY, setDragXY] = useState<{ x: number; y: number } | null>(null);
  // 快捷位置浮层开关
  const [showQuickPos, setShowQuickPos] = useState(false);
  // 画面框实际像素高：用于把字号从 1080 基准缩放到当前预览尺寸，
  // 使「预览字号 ≈ 成片字号」。由 ResizeObserver 实时跟踪（响应式/拖窗）。
  const [stageHeight, setStageHeight] = useState(0);
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
  // 各视频分镜的「真实时长」（sceneId → 秒），由 <video> 的 onLoadedMetadata 填充。
  // provider 常忽略请求时长返回 ~8s 片段，DB 的 scene.duration（LLM 估算，默认 3s）
  // 与真实长度不符——用真实值驱动计时器，避免播放到一半跳镜/循环。
  const [measuredDurs, setMeasuredDurs] = useState<Record<string, number>>({});

  // 按 sceneId 缓存已挂载的 <video> DOM 节点。两层媒体从「单一 keyed 数组」
  // 渲染，key=scene.id：currentIndex 前进时，原「下一镜」节点被 React 依 key
  // 复用为「当前镜」，同一 DOM 节点播放不中断（消除切镜 remount 卡顿）。
  // 所有播放/暂停/静音都据此表按 scene.id 直接取节点（不再用角色 ref，
  // 避免角色互换后 ref 指向失效 + effect 时序竞态）。
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // 画面框（成片比例画布）：字幕拖拽以此为坐标基准（归一化换算用其 rect），
  // 与导出端画面分辨率同坐标系，确保「拖到哪 = 导出到哪」。
  const stageRef = useRef<HTMLDivElement>(null);

  const currentScene = scenes[currentIndex];
  const nextScene =
    currentIndex < scenes.length - 1 ? scenes[currentIndex + 1] : null;

  // 当前镜与下一镜的滤镜/变速
  const curFx = currentScene
    ? resolveEffect(currentScene.id, sceneEffects)
    : { effect: null, speed: 1 };
  const nextFx = nextScene
    ? resolveEffect(nextScene.id, sceneEffects)
    : { effect: null, speed: 1 };
  // 当前镜右侧转场（与下一镜之间）
  const curTransition = resolveTransition(currentIndex, transitions);

  // 是否预热下一镜视频（带宽敏感）：仅在「播放中 且 当前镜已播过 60%」时为真。
  // 此时才把下一镜 preload 升到 auto 提前拉取，覆盖切镜黑屏空档；其余时间
  // 下一镜只 preload=metadata，不与当前镜争抢有限带宽（服务器出口 ~650KB/s）。
  // 已在转场中（transitionT>0）也预热，保证叠化时下一镜有画面。
  const shouldPreheatNext = isPlaying && (progress >= 0.6 || transitionT > 0);

  // 双层媒体的「单一渲染源」：始终 [当前镜, 下一镜] 顺序，各带角色与滤镜。
  // React 按 key(scene.id) 匹配子节点：currentIndex 前进后原「下一镜」的 key
  // 出现在数组首位，其 DOM 节点被复用为新「当前镜」，播放无缝延续。
  // 末镜无 nextScene → 只渲当前镜一层。
  const mediaLayers: Array<{
    scene: ScenePreview;
    role: "current" | "next";
    effect: SceneEffectId | null;
  }> = [];
  if (currentScene) {
    mediaLayers.push({
      scene: currentScene,
      role: "current",
      effect: curFx.effect,
    });
  }
  if (nextScene) {
    mediaLayers.push({ scene: nextScene, role: "next", effect: nextFx.effect });
  }

  // 有效时长查表化（perf a2 P1-1）：播放时 setState(~30ms) 触发全量重渲，
  // 原 effDur/totalDuration/calculateOverallProgress 每次各自 O(n×m) 遍历
  // sceneEffects.find，33fps 下每秒上千次 find。改为 useMemo 一次性算好
  // 每镜有效时长 + 前缀和，渲染期只做 O(1) 数组下标查。
  const { effDurs, prefixDurations, totalDuration } = useMemo(() => {
    // sceneId → speed 查表，消除逐镜 find
    const speedById = new Map<string, number>();
    for (const e of sceneEffects ?? []) {
      const raw = Number(e.speed);
      speedById.set(
        e.sceneId,
        raw && raw > 0 ? Math.min(4, Math.max(0.25, raw)) : 1
      );
    }
    const durs = scenes.map((s) => {
      const speed = speedById.get(s.id) ?? 1;
      // 有视频的分镜用「真实时长」（onLoadedMetadata 实测），回退 DB 声明值；
      // 图片分镜无真实媒体长度，仍用 s.duration。真实时长同样受变速影响。
      const base = s.videoUrl ? (measuredDurs[s.id] ?? s.duration) : s.duration;
      return base / speed;
    });
    // 前缀和：prefix[i] = 前 i 个镜的有效时长之和（用于整体进度，去掉内层循环）
    const prefix: number[] = [0];
    for (let i = 0; i < durs.length; i++) prefix.push(prefix[i] + durs[i]);
    return {
      effDurs: durs,
      prefixDurations: prefix,
      totalDuration: prefix[prefix.length - 1] ?? 0,
    };
  }, [scenes, sceneEffects, measuredDurs]);
  // 单镜有效时长按索引 O(1) 查（保留旧 effDur 签名的调用点用）
  const effDur = (s: ScenePreview) => {
    const idx = scenes.indexOf(s);
    return idx >= 0 ? effDurs[idx] : s.duration;
  };

  // 同步外部选中的场景
  const sceneIndex = currentSceneId
    ? scenes.findIndex((s) => s.id === currentSceneId)
    : -1;
  useEffect(() => {
    if (sceneIndex !== -1 && sceneIndex !== currentIndex) {
      setCurrentIndex(sceneIndex);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIndex]);

  // 播放控制：进度按「有效时长」计时；进入末尾转场窗口后驱动双层叠化
  useEffect(() => {
    if (isPlaying && currentScene) {
      const durationMs = effDur(currentScene) * 1000;
      // 该镜右侧转场时长（末镜无转场）
      const hasNext = currentIndex < scenes.length - 1;
      const tdMs = hasNext ? curTransition.duration * 1000 : 0;
      const startTime = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const sceneProgress = Math.min(elapsed / durationMs, 1);
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
            onSceneChange?.(scenes[currentIndex + 1].id);
          } else {
            // 播放结束
            setIsPlaying(false);
            setProgress(0);
            setTransitionT(0);
            setCurrentIndex(0);
          }
        }
      }, 30);

      // 播放当前镜视频：从 videoElsRef 表按 scene.id 直接取节点，不依赖
      // videoRef.current（角色 ref 由另一 effect 同步，运行时机晚于本 effect，
      // 此处直接查表避免时序竞态）。切镜后原「下一镜」节点经 keyed 复用为当前镜，
      // 已在播；对已在播元素再调 play() 无副作用（不重置进度）。
      if (currentScene.videoUrl) {
        const el = videoElsRef.current.get(currentScene.id);
        el?.play().catch(() => {});
      }

      // 播放音频
      if (audioRef.current && currentScene.audioUrl) {
        audioRef.current.play().catch(() => {});
      }

      // 播放背景音乐（循环，让用户在预览里听到导出后的 BGM）
      if (bgmRef.current && backgroundMusic?.enabled && backgroundMusic.url) {
        bgmRef.current.volume = backgroundMusic.volume ?? 0.25;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentIndex, currentScene, scenes, onSceneChange]);

  // 手动切换分镜时重置转场进度
  useEffect(() => {
    setTransitionT(0);
  }, [currentIndex]);

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
  }, [transitionT, isPlaying, nextScene]);

  // 跟踪画面框实际像素高 → 驱动字号等比缩放（响应式布局/拖窗都实时更新）。
  // ResizeObserver 比 window.resize 更准：框高随容器内缩规则变化，非仅窗口尺寸。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切换分镜时无条件清乐观值——dragXY 只属于上一个分镜，不能带到新分镜。
  useEffect(() => {
    setDragXY(null);
  }, [currentScene?.id]);

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
    if (settled) setDragXY(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlePositions]);

  // 拖角改字号乐观值收尾：松手后 dragFontSize「钉」住松手字号；当 subtitleStyle
  // 回流确认（fontSize 已等于该值）→ 清空，把控制权交还 props，避免乐观值滞留。
  useEffect(() => {
    if (dragFontSize !== null && subtitleStyle?.fontSize === dragFontSize) {
      setDragFontSize(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleStyle?.fontSize]);

  // 静音命令式管理（据 videoElsRef 表按角色取节点）。
  //
  // 必须命令式设置 muted：React 的 muted JSX 属性对「已挂载 <video>」更新不
  // 可靠，且双层媒体经 keyed 复用后同一 <video> 节点会在「当前镜 / 下一镜」
  // 两角色间流转，JSX 属性无法跟随角色互换。
  // - 当前镜视频：muted = isMuted（跟随用户静音开关）
  // - 下一镜视频：恒 muted（转场预播时不能出声，避免双声）
  useEffect(() => {
    const curEl = currentScene?.videoUrl
      ? videoElsRef.current.get(currentScene.id)
      : undefined;
    const nextEl = nextScene?.videoUrl
      ? videoElsRef.current.get(nextScene.id)
      : undefined;
    if (curEl) curEl.muted = isMuted;
    if (nextEl) nextEl.muted = true;
    if (audioRef.current) audioRef.current.muted = isMuted;
    if (bgmRef.current) bgmRef.current.muted = isMuted;
  }, [currentIndex, isMuted, currentScene, nextScene]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setProgress(0);
      onSceneChange?.(scenes[currentIndex - 1].id);
    }
  };

  const goToNext = () => {
    if (currentIndex < scenes.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setProgress(0);
      onSceneChange?.(scenes[currentIndex + 1].id);
    }
  };

  const calculateOverallProgress = () => {
    // 已完成镜的累计时长直接读前缀和（O(1)），不再内层循环累加
    const elapsedBefore = prefixDurations[currentIndex] ?? 0;
    const elapsed =
      elapsedBefore +
      (currentScene ? (effDurs[currentIndex] ?? 0) * progress : 0);
    return totalDuration > 0 ? elapsed / totalDuration : 0;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  /**
   * 计算转场叠化时「当前镜（上层）」的视觉样式。
   * transitionT: 0→1 表示叠化进度。按转场类型映射为透明度/位移/裁切。
   */
  const transitionLayerStyle = (): React.CSSProperties => {
    const t = transitionT;
    if (t <= 0) return {};
    const type = curTransition.type;
    // fade 系：当前镜淡出
    if (
      type === "fade" ||
      type === "dissolve" ||
      type === "fadeblack" ||
      type === "fadewhite"
    ) {
      return { opacity: 1 - t };
    }
    // slide 系：当前镜被推走
    if (type === "slideleft") return { transform: `translateX(-${t * 100}%)` };
    if (type === "slideright") return { transform: `translateX(${t * 100}%)` };
    if (type === "slideup") return { transform: `translateY(-${t * 100}%)` };
    if (type === "slidedown") return { transform: `translateY(${t * 100}%)` };
    // wipe 系：当前镜逐渐被裁掉
    if (type === "wipeleft") return { clipPath: `inset(0 ${t * 100}% 0 0)` };
    if (type === "wiperight") return { clipPath: `inset(0 0 0 ${t * 100}%)` };
    if (type === "wipeup") return { clipPath: `inset(0 0 ${t * 100}% 0)` };
    if (type === "wipedown") return { clipPath: `inset(${t * 100}% 0 0 0)` };
    // 圆形/径向/平滑：用透明度近似（双层叠化）
    return { opacity: 1 - t };
  };

  // ── 字幕位置：拖拽与快捷选择 ──────────────────────────────────────────
  // 是否允许编辑字幕位置（提供回调才开放；只读预览不可拖）
  const subtitleEditable = !!onSubtitlePositionChange;
  // 是否允许拖角改字号（提供回调才开放；与时间轴字幕样式弹窗同一数据源）
  const subtitleResizable = !!onSubtitleStyleChange;
  // 字号 UI 范围（与字幕样式面板的滑块/拖角一致；服务端另有 8-96 安全外壳）
  const SUBTITLE_FONT_MIN = 12;
  const SUBTITLE_FONT_MAX = 48;

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
    // 待 subtitleStyle 回流确认后再由下方 effect 清空，避免闪回旧值。
    if (dragFontSize !== null && subtitleStyle) {
      onSubtitleStyleChange?.({ ...subtitleStyle, fontSize: dragFontSize });
    }
  };

  // 当前分镜字幕的「生效坐标」：拖拽中用实时 dragXY，否则解析覆盖/全局默认
  const currentSubtitleXY = currentScene
    ? (dragXY ??
      resolveSubtitleXY(currentScene.id, subtitleStyle, subtitlePositions))
    : { x: 0.5, y: 0.88 };

  // 字幕预览字号：把 fontSize(1080 基准) 按画面框实际高等比缩放，与导出端
  // ASS Fontsize 共用 resolveSubtitleFontPx → 预览所见字号 ≈ 成片字号。
  // stageHeight 未测得(初始 0)时函数内部回退基准高，避免首帧字号异常。
  // 拖角改字号时优先用本地乐观值 dragFontSize（即时跟手，不被 refetch 刷回）。
  const effectiveFontSize = dragFontSize ?? subtitleStyle?.fontSize;
  const subtitleFontPx = resolveSubtitleFontPx(effectiveFontSize, stageHeight);

  // 逐句字幕：把当前镜的对白/旁白切成短句 + 按视觉宽度分配时间窗，与导出端
  // （video-synthesis.generateSubtitleFile）共用 splitSubtitleSegments /
  // allocateSubtitleWindows，保证「逐句显示 + 淡入」的切句与时轴两端一致。
  // 时长用实测有效时长 effDurs[currentIndex]（与画面/配音同源），非 DB 声明值。
  const subtitleWindows = useMemo(() => {
    const text = currentScene?.dialogue || currentScene?.narration || "";
    if (!text) return [];
    const segments = splitSubtitleSegments(text);
    const dur = effDurs[currentIndex] ?? currentScene?.duration ?? 0;
    return allocateSubtitleWindows(segments, dur);
  }, [
    currentScene?.dialogue,
    currentScene?.narration,
    currentScene?.duration,
    effDurs,
    currentIndex,
  ]);

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

  // 入场动效：缺省 fade（与旧行为、导出端解析规则一致）。
  const subtitleAnimation: SubtitleAnimation =
    subtitleStyle?.animation ?? "fade";

  // 非 typewriter 动效映射为 <p> 的 CSS animation 简写（时序读共享常量，
  // 与导出端 libass 标签对齐）。typewriter 返回 undefined——它由逐字符 span
  // 各自带 subtitleCharReveal 动画驱动，<p> 本身不加整体动画。
  // 逻辑抽到 lib/subtitle-css 与字幕样式面板共用。
  const subtitleAnimationCss = getSubtitleAnimationCss(subtitleAnimation);

  // typewriter：把当前句拆成逐字符 + 各自显现延迟（与导出端 typewriterDelays 同源，
  // 换行规则一致：换行也占一个延迟槽）。仅 typewriter 动效时计算，避免无谓开销。
  const typewriterChars =
    subtitleAnimation === "typewriter" ? Array.from(activeSubtitleText) : null;
  const typewriterCharDelays =
    subtitleAnimation === "typewriter"
      ? typewriterDelays(activeSubtitleText, activeSubtitleDuration)
      : null;

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
      // 改为：保留 dragXY 作为乐观值“钉”住松手落点，待下方 effect 检测到
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

  /**
   * 渲染一镜的媒体（video / image / 占位），应用其滤镜。
   * video 用「按 sceneId 记忆的稳定 ref 回调」把 DOM 节点登记进 videoElsRef，
   * 供 muted 命令式管理与播放控制；不再用 muted JSX 属性
   * （已挂载 <video> 的 muted 属性更新不可靠，角色互换后会失灵）。
   *
   * preload 策略（带宽敏感，2026-07-08）：
   * 服务器出口带宽有限（~650KB/s）而分镜视频常达 9MB+，若两层都 preload=auto，
   * 当前镜与下一镜会同时全量下载互抢带宽 → 当前镜卡顿。改为：
   *   - 当前镜：preload=auto（积极加载，优先保证正在看的这镜流畅）；
   *   - 下一镜：仅在「临近转场」（shouldPreheatNext）时升级 auto 预热，
   *     其余时间用 metadata（只拉几十 KB 头信息，不占带宽）。
   * 这样切镜预热窗口很短、不与当前镜长期争抢，黑屏空档仍被覆盖。
   */
  const renderMedia = (
    scene: ScenePreview,
    effect: SceneEffectId | null,
    role: "current" | "next"
  ) => {
    const filterCss = sceneFilterCss(effect);
    if (scene.videoUrl) {
      // 下一镜默认 metadata（省带宽），仅在临近转场预热窗口内才 auto；
      // 当前镜恒 auto。
      const preload =
        role === "current" || shouldPreheatNext ? "auto" : "metadata";
      return (
        <video
          ref={getVideoRefCb(scene.id)}
          src={scene.videoUrl}
          // object-contain 精确复刻导出端 scale(decrease)+pad(black)：图片比例≠成片比例时
          // 完整缩入并补黑边，预览构图=成片构图（黑边由画面框黑底承接）。
          className="h-full w-full object-contain"
          style={{ filter: filterCss }}
          loop
          playsInline
          preload={preload}
          onLoadedMetadata={(e) =>
            handleLoadedMetadata(scene.id, e.currentTarget)
          }
        />
      );
    }
    if (scene.imageUrl) {
      return (
        <img
          src={scene.imageUrl}
          alt=""
          className="h-full w-full object-contain"
          style={{ filter: filterCss }}
        />
      );
    }
    return <div className="text-muted-foreground">无内容</div>;
  };

  if (scenes.length === 0) {
    const emptyAspect =
      aspectRatio === "9:16"
        ? "aspect-[9/16]"
        : aspectRatio === "1:1"
          ? "aspect-square"
          : "aspect-video";
    return (
      <div
        className={`bg-card flex ${emptyAspect} items-center justify-center rounded-xl`}
      >
        <p className="text-muted-foreground">暂无可预览的内容</p>
      </div>
    );
  }

  return (
    <div className="bg-card flex h-full w-full flex-col overflow-hidden rounded-xl">
      {/* Video/Image Display — 外层黑色容器：flex-1 占据除控制条外的剩余高度，
          min-h-0 允许收缩，居中承载「画面框」。仅放与画面无关的 UI 角标。 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {/* 画面框（stage）—— 按 aspectRatio 声明式锁定成片比例并自适应内缩。
            框 = 成片画布：媒体/水印/贴图/字幕全部以此为坐标基准，
            字幕拖拽的归一化坐标与导出 ASS \pos 像素级一致（所见即所得）。
            maxH/maxW 二选一受限，保证框完整落在黑色容器内（多余处留黑边）。 */}
        <div
          ref={stageRef}
          className="relative max-h-full max-w-full overflow-hidden bg-black"
          style={{
            aspectRatio: aspectRatioToCss(aspectRatio),
            height: "100%",
            // aspect-ratio + height:100% 会让宽度按比例算；若算出的宽超过容器，
            // max-w-full 收回宽度、高度随之按比例缩（横屏在窄容器里也完整可见）。
          }}
        >
          {/* SVG 滤镜定义（精确复现 FFmpeg FX_FILTERS），仅注入一次 */}
          <SceneFilterDefs />

          {/* 逐句字幕入场动效关键帧（与导出端 libass 标签时序一一对齐），仅注入一次。
              关键帧定义抽到 lib/subtitle-css，与字幕样式面板共用同一份。 */}
          <style>{SUBTITLE_KEYFRAMES_CSS}</style>

          {/* 双层媒体从「单一 keyed 数组」渲染（key=scene.id）——
              currentIndex 前进时，原「下一镜」层的 DOM 节点被 React 依 key 复用
              为「当前镜」，同一 <video> 播放不中断（消除切镜 remount 的黑屏/卡顿）。
              栈序用显式 zIndex（当前镜在上，下一镜在下）而非 DOM 顺序——因为
              keyed 复用会打乱 DOM 顺序，只有 zIndex 能稳定控制叠放。
              - 下一镜层：仅转场中（transitionT>0）可见，否则透明且不吃指针（保留预取）；
              - 当前镜层：套 transitionLayerStyle() 做叠化（fade/slide/wipe）。 */}
          {mediaLayers.map(({ scene, role, effect }) => {
            const isCurrent = role === "current";
            const layerStyle: React.CSSProperties = isCurrent
              ? {
                  zIndex: 2,
                  // 短 opacity 过渡平滑 JS 30ms 步进的叠化（仅 opacity，不含
                  // transform/clipPath，避免 slide/wipe 与 JS 进度相互拖拽）。
                  transition: "opacity 50ms linear",
                  ...transitionLayerStyle(),
                }
              : {
                  zIndex: 1,
                  opacity: transitionT > 0 ? 1 : 0,
                  pointerEvents: "none",
                };
            return (
              <div
                key={scene.id}
                className="absolute inset-0 flex items-center justify-center"
                style={layerStyle}
              >
                {renderMedia(scene, effect, role)}
              </div>
            );
          })}

          {/* Audio */}
          {currentScene?.audioUrl && (
            <audio ref={audioRef} src={currentScene.audioUrl} />
          )}

          {/* 背景音乐（循环，预览反映导出后的 BGM） */}
          {backgroundMusic?.enabled && backgroundMusic.url && (
            <audio ref={bgmRef} src={backgroundMusic.url} loop />
          )}

          {/* Watermark — 全片商标水印预览（与导出 overlay 一致位置）。
              z-10：媒体层带显式 zIndex(1/2) 形成层叠序，所有覆盖元素必须
              显式高于它，否则会被画面盖住（DOM 顺序不再决定叠放）。 */}
          {watermark?.enabled && watermark.imageUrl && (
            <img
              src={watermark.imageUrl}
              alt=""
              className={`pointer-events-none absolute z-10 ${
                watermark.position === "tl"
                  ? "top-3 left-3"
                  : watermark.position === "tr"
                    ? "top-3 right-3"
                    : watermark.position === "bl"
                      ? "bottom-3 left-3"
                      : watermark.position === "center"
                        ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                        : "right-3 bottom-3"
              }`}
              style={{
                width: `${(watermark.scale ?? 0.12) * 100}%`,
                opacity: watermark.opacity ?? 0.8,
              }}
            />
          )}

          {/* 防呆：水印开关已开启但未上传 Logo —— 显式提示，
            避免“静默不渲染”被误判为功能失效（此前空 imageUrl 时整块短路不显示）。 */}
          {watermark?.enabled && !watermark.imageUrl && (
            <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border border-amber-400/60 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 backdrop-blur-sm">
              水印已开启，但未上传 Logo
            </div>
          )}

          {/* Stickers — 当前分镜的贴图预览（与导出 overlay 位置一致） */}
          {currentScene &&
            stickers
              ?.filter((st) => st.sceneId === currentScene.id && st.imageUrl)
              .map((st) => (
                <img
                  key={st.id}
                  src={st.imageUrl}
                  alt=""
                  className="pointer-events-none absolute z-10"
                  style={{
                    width: `${st.scale * 100}%`,
                    left: `${st.x * 100}%`,
                    top: `${st.y * 100}%`,
                    transform: `translate(-${st.x * 100}%, -${st.y * 100}%)`,
                  }}
                />
              ))}

          {/* Subtitles — 绝对定位到归一化坐标（中心点），支持逐分镜拖拽。
            与导出 ASS \pos(x*W,y*H) 用同一坐标系，确保预览=成片。 */}
          {showSubtitles &&
            (currentScene?.dialogue || currentScene?.narration) && (
              <div
                className="absolute z-10"
                style={{
                  left: `${currentSubtitleXY.x * 100}%`,
                  top: `${currentSubtitleXY.y * 100}%`,
                  // 以中心点定位：自身偏移 -50% 让坐标对准字幕块中心
                  transform: "translate(-50%, -50%)",
                  // 字幕块用 nowrap 单行不换行（见下方 <p>），故不限 maxWidth——
                  // 与时间轴字幕样式面板一致。不越界由拖拽落点的 clamp 保证。
                }}
              >
                {/* 逐句入场动效：key=分镜id+句索引，切句时 <p> 重挂载触发所选动效
                    （fade/slideup/pop 由 <p> 整体动画驱动；typewriter 由逐字符 span
                    各自动画驱动，<p> 不加整体动画）。节奏对齐导出端 libass 标签。
                    slideup 的位移动画放在 <p>（内层）而非外层 wrapper——wrapper 带
                    translate(-50%,-50%)，若在其上叠加 transform 会互相冲突。 */}
                <p
                  key={`${currentScene.id}-${activeSubtitleIndex}`}
                  ref={subtitleBoxRef}
                  onMouseDown={
                    subtitleEditable ? handleSubtitleDragStart : undefined
                  }
                  onTouchStart={
                    subtitleEditable ? handleSubtitleDragStart : undefined
                  }
                  className={`inline-block rounded-lg px-4 py-2 text-center leading-snug ${
                    subtitleEditable
                      ? "hover:ring-primary/70 cursor-move ring-1 ring-white/20 transition-shadow hover:ring-2"
                      : ""
                  } ${dragXY ? "ring-primary shadow-lg ring-2" : ""}`}
                  style={{
                    // 字号按画面框高等比缩放（与导出 ASS Fontsize 同源），预览=成片
                    fontSize: `${subtitleFontPx}px`,
                    color: subtitleStyle?.fontColor ?? "#FFFFFF",
                    fontWeight: subtitleStyle?.bold ? 700 : 400,
                    background: subtitleStyle?.backgroundBox
                      ? "rgba(0,0,0,0.7)"
                      : "transparent",
                    textShadow: subtitleStyle
                      ? `${subtitleStyle.outlineColor} 1px 1px 0, ${subtitleStyle.outlineColor} -1px -1px 0, ${subtitleStyle.outlineColor} 1px -1px 0, ${subtitleStyle.outlineColor} -1px 1px 0`
                      : "rgba(0,0,0,0.8) 0 1px 2px",
                    // 描边宽度随画面高等比缩放（对齐导出端 ScaledBorderAndShadow:yes），
                    // 系数 = 画面框高 / 1080 基准；字越大描边越粗，两端比例一致。
                    WebkitTextStroke:
                      subtitleStyle && subtitleStyle.outlineWidth > 0
                        ? `${(subtitleStyle.outlineWidth * (stageHeight > 0 ? stageHeight : SUBTITLE_FONT_BASE_HEIGHT)) / SUBTITLE_FONT_BASE_HEIGHT}px ${subtitleStyle.outlineColor}`
                        : undefined,
                    // 拖拽期间禁用文本选中，避免选中文字干扰拖动
                    userSelect: subtitleEditable ? "none" : undefined,
                    touchAction: subtitleEditable ? "none" : undefined,
                    // 入场动效（时序读共享常量，与导出端标签对齐）；typewriter 时为
                    // undefined，动画落到逐字符 span 上。
                    animation: subtitleAnimationCss,
                    // 单句不换行（与时间轴字幕样式面板一致）——逐句字幕本就是短句，
                    // nowrap 保证一句一行，不再被宽度挤成竖排一列。
                    whiteSpace: "nowrap",
                  }}
                >
                  {typewriterChars && typewriterCharDelays
                    ? // 打字机：逐字符 span，各自延迟显现（80ms 硬揭示）。
                      // 暂停时 animationPlayState:paused 冻结揭示进度。
                      // 换行符渲染为 <br>（不占 span，与导出端 \N 分隔对齐）。
                      // pointer-events 默认穿透，不影响 <p> 上的拖拽手柄。
                      typewriterChars.map((ch, i) =>
                        ch === "\n" || ch === "\r" ? (
                          <br key={i} />
                        ) : (
                          <span
                            key={i}
                            style={{
                              opacity: 0,
                              animation: `subtitleCharReveal 80ms linear forwards`,
                              animationDelay: `${typewriterCharDelays[i]}s`,
                              animationPlayState: isPlaying
                                ? "running"
                                : "paused",
                            }}
                          >
                            {ch}
                          </span>
                        )
                      )
                    : activeSubtitleText}
                </p>

                {/* 四角控点：拖角改字号（剪映式，仅提供 onSubtitleStyleChange 时显示）。
                    绝对定位到 wrapper 四角（wrapper 尺寸=字幕块），pointer 事件
                    move/up 就近绑在控点上（setPointerCapture 保证拖出控点也跟手）。 */}
                {subtitleResizable && (
                  <>
                    {[
                      { pos: "-top-1 -left-1", cur: "nwse-resize" },
                      { pos: "-top-1 -right-1", cur: "nesw-resize" },
                      { pos: "-bottom-1 -left-1", cur: "nesw-resize" },
                      { pos: "-right-1 -bottom-1", cur: "nwse-resize" },
                    ].map((h) => (
                      <span
                        key={h.pos}
                        className={`border-primary absolute z-20 h-2.5 w-2.5 rounded-sm border bg-white ${h.pos}`}
                        style={{ cursor: h.cur }}
                        onPointerDown={handleSubtitleResizeStart}
                        onPointerMove={handleSubtitleResizeMove}
                        onPointerUp={handleSubtitleResizeEnd}
                        onPointerCancel={handleSubtitleResizeEnd}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

          {/* 字幕位置工具条 —— 仅可编辑时显示：快捷九宫格 + 拖拽提示 */}
          {subtitleEditable &&
            showSubtitles &&
            (currentScene?.dialogue || currentScene?.narration) && (
              <div className="absolute top-4 right-4 z-10">
                <button
                  type="button"
                  onClick={() => setShowQuickPos((v) => !v)}
                  className="rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm transition hover:bg-black/80"
                  title="拖动字幕可自由定位；点此快捷选择九宫格位置"
                >
                  字幕位置
                </button>
                {showQuickPos && (
                  <div className="mt-2 rounded-lg border border-white/15 bg-black/80 p-2 backdrop-blur-sm">
                    <div className="grid grid-cols-3 gap-1">
                      {SUBTITLE_QUICK_POSITIONS.map((pos) => (
                        <button
                          key={pos.label}
                          type="button"
                          onClick={() => applyQuickPosition(pos.x, pos.y)}
                          className="hover:bg-primary rounded px-2 py-1.5 text-[11px] text-white/80 transition hover:text-white"
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-center text-[10px] text-white/40">
                      或直接拖动字幕
                    </p>
                  </div>
                )}
              </div>
            )}
        </div>
        {/* ── 画面框（stage）结束 ── */}

        {/* Scene indicator —— 播放器角标，定位于外层黑色容器（不属于画面，不参与导出） */}
        <div className="absolute top-4 left-4 rounded bg-black/50 px-2 py-1 text-xs">
          {currentIndex + 1} / {scenes.length}
        </div>
      </div>

      {/* Controls — shrink-0 确保控制条永不被媒体区挤出可视区 */}
      <div className="shrink-0 space-y-3 p-4">
        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-10 text-xs">
            {formatTime(calculateOverallProgress() * totalDuration)}
          </span>
          <div className="bg-secondary h-1 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all duration-100"
              style={{ width: `${calculateOverallProgress() * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground w-10 text-xs">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="hover:bg-secondary rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="上一个分镜"
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={togglePlay}
            className="bg-primary hover:bg-primary/90 rounded-full p-3"
            aria-label={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          <button
            onClick={goToNext}
            disabled={currentIndex === scenes.length - 1}
            className="hover:bg-secondary rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="下一个分镜"
          >
            <SkipForward size={20} />
          </button>

          <div className="flex-1" />

          <button
            onClick={() => setIsMuted(!isMuted)}
            className="hover:bg-secondary rounded-lg p-2"
            aria-label={isMuted ? "取消静音" : "静音"}
            aria-pressed={isMuted}
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button
            onClick={() => setShowSubtitles(!showSubtitles)}
            className={`rounded px-2 py-1 text-xs ${
              showSubtitles ? "bg-primary" : "bg-secondary"
            }`}
            aria-label="切换字幕显示"
            aria-pressed={showSubtitles}
          >
            字幕
          </button>
        </div>
      </div>
    </div>
  );
}
