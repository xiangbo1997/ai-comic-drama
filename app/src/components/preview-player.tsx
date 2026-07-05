"use client";

import { useState, useRef, useEffect, useMemo } from "react";
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

  const videoRef = useRef<HTMLVideoElement>(null);
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
    const durs = scenes.map((s) => s.duration / (speedById.get(s.id) ?? 1));
    // 前缀和：prefix[i] = 前 i 个镜的有效时长之和（用于整体进度，去掉内层循环）
    const prefix: number[] = [0];
    for (let i = 0; i < durs.length; i++) prefix.push(prefix[i] + durs[i]);
    return {
      effDurs: durs,
      prefixDurations: prefix,
      totalDuration: prefix[prefix.length - 1] ?? 0,
    };
  }, [scenes, sceneEffects]);
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

      // 播放视频
      if (videoRef.current && currentScene.videoUrl) {
        videoRef.current.play().catch(() => {});
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
      if (videoRef.current) {
        videoRef.current.pause();
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

  // 静音控制
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
    if (bgmRef.current) {
      bgmRef.current.muted = isMuted;
    }
  }, [isMuted]);

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

  // 当前分镜字幕的「生效坐标」：拖拽中用实时 dragXY，否则解析覆盖/全局默认
  const currentSubtitleXY = currentScene
    ? (dragXY ??
      resolveSubtitleXY(currentScene.id, subtitleStyle, subtitlePositions))
    : { x: 0.5, y: 0.88 };

  // 字幕预览字号：把 fontSize(1080 基准) 按画面框实际高等比缩放，与导出端
  // ASS Fontsize 共用 resolveSubtitleFontPx → 预览所见字号 ≈ 成片字号。
  // stageHeight 未测得(初始 0)时函数内部回退基准高，避免首帧字号异常。
  const subtitleFontPx = resolveSubtitleFontPx(
    subtitleStyle?.fontSize,
    stageHeight
  );

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

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const { cx, cy } = getPoint(ev);
      setDragXY(clientToNormalized(cx, cy));
    };

    const onUp = (ev: MouseEvent | TouchEvent) => {
      const { cx, cy } = getPoint(ev);
      const final = clientToNormalized(cx, cy);
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

    // 立即把字幕中心移到按下点（点哪去哪，手感直接）
    const start = getPoint(e.nativeEvent as MouseEvent | TouchEvent);
    setDragXY(clientToNormalized(start.cx, start.cy));

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

  /** 渲染一镜的媒体（video / image / 占位），应用其滤镜。withRef 仅当前镜用 */
  const renderMedia = (
    scene: ScenePreview | null,
    effect: SceneEffectId | null,
    withRef: boolean
  ) => {
    const filterCss = sceneFilterCss(effect);
    if (scene?.videoUrl) {
      return (
        <video
          ref={withRef ? videoRef : undefined}
          src={scene.videoUrl}
          // object-contain 精确复刻导出端 scale(decrease)+pad(black)：图片比例≠成片比例时
          // 完整缩入并补黑边，预览构图=成片构图（黑边由画面框黑底承接）。
          className="h-full w-full object-contain"
          style={{ filter: filterCss }}
          loop
          playsInline
          muted={!withRef}
        />
      );
    }
    if (scene?.imageUrl) {
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

          {/* 底层：下一镜——仅转场进行中（transitionT>0）显现，应用下一镜滤镜 */}
          {nextScene && transitionT > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              {renderMedia(nextScene, nextFx.effect, false)}
            </div>
          )}

          {/* 上层：当前镜——应用当前镜滤镜 + 转场叠化动画（fade/slide/wipe） */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={transitionLayerStyle()}
          >
            {renderMedia(currentScene, curFx.effect, true)}
          </div>

          {/* Audio */}
          {currentScene?.audioUrl && (
            <audio ref={audioRef} src={currentScene.audioUrl} />
          )}

          {/* 背景音乐（循环，预览反映导出后的 BGM） */}
          {backgroundMusic?.enabled && backgroundMusic.url && (
            <audio ref={bgmRef} src={backgroundMusic.url} loop />
          )}

          {/* Watermark — 全片商标水印预览（与导出 overlay 一致位置） */}
          {watermark?.enabled && watermark.imageUrl && (
            <img
              src={watermark.imageUrl}
              alt=""
              className={`pointer-events-none absolute ${
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
            <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-amber-400/60 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 backdrop-blur-sm">
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
                  className="pointer-events-none absolute"
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
                className="absolute"
                style={{
                  left: `${currentSubtitleXY.x * 100}%`,
                  top: `${currentSubtitleXY.y * 100}%`,
                  // 以中心点定位：自身偏移 -50% 让坐标对准字幕块中心
                  transform: "translate(-50%, -50%)",
                  // 不超出画面两侧（最宽 90% 画面框宽，长字幕自动换行）
                  maxWidth: "90%",
                }}
              >
                <p
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
                  }}
                >
                  {currentScene.dialogue || currentScene.narration}
                </p>
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
