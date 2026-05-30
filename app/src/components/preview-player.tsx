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

interface PreviewPlayerProps {
  scenes: ScenePreview[];
  aspectRatio: string;
  onSceneChange?: (sceneId: string) => void;
  currentSceneId?: string;
}

export function PreviewPlayer({
  scenes,
  aspectRatio,
  onSceneChange,
  currentSceneId,
}: PreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentScene = scenes[currentIndex];
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

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

  // 播放控制
  useEffect(() => {
    if (isPlaying && currentScene) {
      const duration = currentScene.duration * 1000;
      const startTime = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const sceneProgress = Math.min(elapsed / duration, 1);
        setProgress(sceneProgress);

        if (sceneProgress >= 1) {
          // 切换到下一个场景
          if (currentIndex < scenes.length - 1) {
            setCurrentIndex((prev) => prev + 1);
            setProgress(0);
            onSceneChange?.(scenes[currentIndex + 1].id);
          } else {
            // 播放结束
            setIsPlaying(false);
            setProgress(0);
            setCurrentIndex(0);
          }
        }
      }, 50);

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
  }, [isPlaying, currentIndex, currentScene, scenes, onSceneChange]);

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
      elapsed += scenes[i].duration;
    }
    elapsed += currentScene ? currentScene.duration * progress : 0;
    return totalDuration > 0 ? elapsed / totalDuration : 0;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (scenes.length === 0) {
    return (
      <div className="bg-card flex aspect-video items-center justify-center rounded-xl">
        <p className="text-muted-foreground">暂无可预览的内容</p>
      </div>
    );
  }

  // 竖屏(9:16)时限制媒体区最大宽度，避免横向过宽导致视频被高度压得很小
  const mediaMaxWidth =
    aspectRatio === "9:16"
      ? "max-w-[calc(56.25vh)]" // 9/16 ≈ 0.5625，按可用高度反推宽度上限
      : aspectRatio === "1:1"
        ? "max-w-[calc(80vh)]"
        : "max-w-full";

  return (
    <div className="bg-card flex h-full w-full flex-col overflow-hidden rounded-xl">
      {/* Video/Image Display — 填充可用高度，视频按比例 object-contain 内缩，
          竖屏(9:16)也不会撑爆弹窗；控制条始终可见 */}
      <div
        className={`relative mx-auto flex min-h-0 w-full flex-1 items-center justify-center bg-black ${mediaMaxWidth}`}
      >
        {currentScene?.videoUrl ? (
          <video
            ref={videoRef}
            src={currentScene.videoUrl}
            className="h-full w-full object-contain"
            loop
            playsInline
          />
        ) : currentScene?.imageUrl ? (
          <img
            src={currentScene.imageUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="text-muted-foreground">无内容</div>
        )}

        {/* Audio */}
        {currentScene?.audioUrl && (
          <audio ref={audioRef} src={currentScene.audioUrl} />
        )}

        {/* Subtitles */}
        {showSubtitles &&
          (currentScene?.dialogue || currentScene?.narration) && (
            <div className="absolute right-4 bottom-12 left-4 text-center">
              <div className="inline-block rounded-lg bg-black/70 px-4 py-2">
                <p className="text-foreground text-sm">
                  {currentScene.dialogue || currentScene.narration}
                </p>
              </div>
            </div>
          )}

        {/* Scene indicator */}
        <div className="absolute top-4 left-4 rounded bg-black/50 px-2 py-1 text-xs">
          {currentIndex + 1} / {scenes.length}
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-3 p-4">
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
