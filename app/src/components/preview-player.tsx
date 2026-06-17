"use client";

import { useState, useRef, useEffect } from "react";
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
  Watermark,
  Sticker,
  Transition,
  TransitionType,
  SceneEffect,
  SceneEffectId,
} from "@/types/export-style";
import { SceneFilterDefs, sceneFilterCss } from "./scene-filters";

interface PreviewPlayerProps {
  scenes: ScenePreview[];
  aspectRatio: string;
  onSceneChange?: (sceneId: string) => void;
  currentSceneId?: string;
  /** 全片字幕样式（与导出保持一致的预览） */
  subtitleStyle?: SubtitleStyle;
  /** 全片商标水印（预览叠加 logo） */
  watermark?: Watermark;
  /** 贴图列表（预览时按当前分镜叠加） */
  stickers?: Sticker[];
  /** 分镜间转场（第 k 项 = 第 k 与 k+1 分镜之间），双层叠化预览 */
  transitions?: Transition[];
  /** 分镜滤镜 / 变速（按 sceneId），预览用 SVG filter 精确复现 */
  sceneEffects?: SceneEffect[];
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
  watermark,
  stickers,
  transitions,
  sceneEffects,
}: PreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  // 转场进度 0-1：>0 表示正在向下一镜叠化（驱动双层透明度/位移）
  const [transitionT, setTransitionT] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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

  // 有效时长 = 原始时长 / 变速（与导出侧成片时间轴一致）
  const effDur = (s: ScenePreview) =>
    s.duration / resolveEffect(s.id, sceneEffects).speed;
  const totalDuration = scenes.reduce((sum, s) => sum + effDur(s), 0);

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

  // 静音控制
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
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
    let elapsed = 0;
    for (let i = 0; i < currentIndex; i++) {
      elapsed += effDur(scenes[i]);
    }
    elapsed += currentScene ? effDur(currentScene) * progress : 0;
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
      {/* Video/Image Display — flex-1 占据除控制条外的剩余高度，min-h-0 允许收缩；
          视频/图片用 object-contain 在其中按比例内缩居中，竖屏也完整可见。
          aspectRatio 用于无媒体时的占位提示。 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
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

        {/* Subtitles — 应用全片字幕样式，与导出保持一致预览 */}
        {showSubtitles &&
          (currentScene?.dialogue || currentScene?.narration) && (
            <div
              className={`absolute right-4 left-4 flex ${
                subtitleStyle?.position === "top"
                  ? "top-12 items-start"
                  : subtitleStyle?.position === "middle"
                    ? "inset-y-0 items-center"
                    : "bottom-12 items-end"
              } justify-center`}
            >
              <p
                className="inline-block rounded-lg px-4 py-2 text-center leading-snug"
                style={{
                  fontSize: `${subtitleStyle?.fontSize ?? 16}px`,
                  color: subtitleStyle?.fontColor ?? "#FFFFFF",
                  fontWeight: subtitleStyle?.bold ? 700 : 400,
                  background: subtitleStyle?.backgroundBox
                    ? "rgba(0,0,0,0.7)"
                    : "transparent",
                  textShadow: subtitleStyle
                    ? `${subtitleStyle.outlineColor} 1px 1px 0, ${subtitleStyle.outlineColor} -1px -1px 0, ${subtitleStyle.outlineColor} 1px -1px 0, ${subtitleStyle.outlineColor} -1px 1px 0`
                    : "rgba(0,0,0,0.8) 0 1px 2px",
                  WebkitTextStroke:
                    subtitleStyle && subtitleStyle.outlineWidth > 0
                      ? `${Math.min(subtitleStyle.outlineWidth, 2) * 0.5}px ${subtitleStyle.outlineColor}`
                      : undefined,
                }}
              >
                {currentScene.dialogue || currentScene.narration}
              </p>
            </div>
          )}

        {/* Scene indicator */}
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
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={togglePlay}
            className="bg-primary hover:bg-primary/90 rounded-full p-3"
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          <button
            onClick={goToNext}
            disabled={currentIndex === scenes.length - 1}
            className="hover:bg-secondary rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SkipForward size={20} />
          </button>

          <div className="flex-1" />

          <button
            onClick={() => setIsMuted(!isMuted)}
            className="hover:bg-secondary rounded-lg p-2"
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button
            onClick={() => setShowSubtitles(!showSubtitles)}
            className={`rounded px-2 py-1 text-xs ${
              showSubtitles ? "bg-primary" : "bg-secondary"
            }`}
          >
            字幕
          </button>
        </div>
      </div>
    </div>
  );
}
