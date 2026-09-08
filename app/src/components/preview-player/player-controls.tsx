"use client";

import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime } from "./helpers";

interface PlayerControlsProps {
  /** 整体进度 0-1（前缀和 / 总时长，与 BGM、SFX 同一时钟） */
  overallProgress: number;
  totalDuration: number;
  isPlaying: boolean;
  isMuted: boolean;
  showSubtitles: boolean;
  /** 首镜禁用「上一个」、末镜禁用「下一个」 */
  atFirst: boolean;
  atLast: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onToggleMuted: () => void;
  onToggleSubtitles: () => void;
}

/**
 * Controls — shrink-0 确保控制条永不被媒体区挤出可视区。
 *
 * 本组件不含任何 hook：纯展示 + 事件透传，故不影响 PreviewPlayer 的 effect 顺序。
 */
export function PlayerControls({
  overallProgress,
  totalDuration,
  isPlaying,
  isMuted,
  showSubtitles,
  atFirst,
  atLast,
  onPrevious,
  onTogglePlay,
  onNext,
  onToggleMuted,
  onToggleSubtitles,
}: PlayerControlsProps) {
  return (
    <div className="shrink-0 space-y-3 p-4">
      {/* Progress Bar */}
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground w-10 text-xs">
          {formatTime(overallProgress * totalDuration)}
        </span>
        <div className="bg-secondary h-1 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all duration-100"
            style={{ width: `${overallProgress * 100}%` }}
          />
        </div>
        <span className="text-muted-foreground w-10 text-xs">
          {formatTime(totalDuration)}
        </span>
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onPrevious}
          disabled={atFirst}
          className="hover:bg-secondary rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="上一个分镜"
        >
          <SkipBack size={20} />
        </button>

        <button
          onClick={onTogglePlay}
          className="bg-primary hover:bg-primary/90 rounded-full p-3"
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>

        <button
          onClick={onNext}
          disabled={atLast}
          className="hover:bg-secondary rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="下一个分镜"
        >
          <SkipForward size={20} />
        </button>

        <div className="flex-1" />

        <button
          onClick={onToggleMuted}
          className="hover:bg-secondary rounded-lg p-2"
          aria-label={isMuted ? "取消静音" : "静音"}
          aria-pressed={isMuted}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>

        <button
          onClick={onToggleSubtitles}
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
  );
}
