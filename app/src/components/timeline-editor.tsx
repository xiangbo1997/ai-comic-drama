"use client";

import { useState, useRef, useEffect, memo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Image as ImageIcon,
  Video,
  Music,
  Type,
} from "lucide-react";
import type { ScenePreview } from "@/types";

interface TimelineEditorProps {
  scenes: ScenePreview[];
  onSceneSelect: (sceneId: string) => void;
  onSceneDurationChange: (sceneId: string, duration: number) => void;
  selectedSceneId: string | null;
}

const TRACK_HEIGHT = 48;
const PIXELS_PER_SECOND = 60;
const MIN_DURATION = 1;
const MAX_DURATION = 30;

// 固定的伪波形高度序列：装饰性音频波形，避免在 render 中调用 Math.random
// 导致每帧（播放头每 100ms 更新）重渲染时波形抖动。所有音频轨共用同一形状。
const WAVEFORM_HEIGHTS = Array.from(
  { length: 20 },
  (_, i) => 35 + ((Math.sin(i * 1.7) + 1) / 2) * 60
);

function TimelineEditorImpl({
  scenes,
  onSceneSelect,
  onSceneDurationChange,
  selectedSceneId,
}: TimelineEditorProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [draggingScene, setDraggingScene] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartDuration, setDragStartDuration] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  const pixelsPerSecond = PIXELS_PER_SECOND * zoom;

  // 计算每个场景的起始时间
  const sceneStartTimes = scenes.reduce<Record<string, number>>(
    (acc, scene, index) => {
      const prevScene = scenes[index - 1];
      acc[scene.id] =
        index === 0 ? 0 : acc[prevScene?.id ?? ""] + (prevScene?.duration ?? 0);
      return acc;
    },
    {}
  );

  // 播放控制
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= totalDuration) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 0.1;
        });
      }, 100);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, totalDuration]);

  // 获取当前播放的场景
  const getCurrentScene = () => {
    let accTime = 0;
    for (const scene of scenes) {
      if (currentTime >= accTime && currentTime < accTime + scene.duration) {
        return scene;
      }
      accTime += scene.duration;
    }
    return scenes[scenes.length - 1];
  };

  const currentScene = getCurrentScene();

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
  };

  // 点击时间轴跳转
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || draggingScene) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = x / pixelsPerSecond;
    setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
  };

  // 开始拖拽调整时长
  const handleDragStart = (
    e: React.MouseEvent,
    sceneId: string,
    currentDuration: number
  ) => {
    e.stopPropagation();
    setDraggingScene(sceneId);
    setDragStartX(e.clientX);
    setDragStartDuration(currentDuration);
  };

  // 拖拽中
  useEffect(() => {
    if (!draggingScene) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX;
      const deltaDuration = deltaX / pixelsPerSecond;
      const newDuration = Math.max(
        MIN_DURATION,
        Math.min(MAX_DURATION, dragStartDuration + deltaDuration)
      );
      onSceneDurationChange(draggingScene, Math.round(newDuration * 10) / 10);
    };

    const handleMouseUp = () => {
      setDraggingScene(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    draggingScene,
    dragStartX,
    dragStartDuration,
    pixelsPerSecond,
    onSceneDurationChange,
  ]);

  // 生成时间刻度
  const generateTimeMarkers = () => {
    const markers = [];
    const interval = zoom >= 1 ? 1 : zoom >= 0.5 ? 2 : 5;
    for (let i = 0; i <= Math.ceil(totalDuration); i += interval) {
      markers.push(
        <div
          key={i}
          className="border-border absolute top-0 h-full border-l"
          style={{ left: i * pixelsPerSecond }}
        >
          <span className="text-muted-foreground absolute -top-5 left-1 text-xs">
            {formatTime(i)}
          </span>
        </div>
      );
    }
    return markers;
  };

  return (
    <div className="border-border bg-background border-t">
      {/* 控制栏 */}
      <div className="border-border flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTime(0)}
            className="hover:bg-secondary rounded p-1.5"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="bg-primary hover:bg-primary/90 rounded-full p-2"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            onClick={() => setCurrentTime(totalDuration)}
            className="hover:bg-secondary rounded p-1.5"
          >
            <SkipForward size={18} />
          </button>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="hover:bg-secondary rounded p-1.5"
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-sm">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">缩放</span>
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.25"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-20"
            />
            <span className="text-muted-foreground text-xs">{zoom}x</span>
          </div>
        </div>
      </div>

      {/* 轨道区域 */}
      <div className="flex">
        {/* 轨道标签 */}
        <div className="border-border w-24 shrink-0 border-r">
          <div className="border-border h-6 border-b" />
          <div
            className="border-border flex items-center gap-2 border-b px-2"
            style={{ height: TRACK_HEIGHT }}
          >
            <Video size={14} className="text-muted-foreground" />
            <span className="text-xs">视频</span>
          </div>
          <div
            className="border-border flex items-center gap-2 border-b px-2"
            style={{ height: TRACK_HEIGHT }}
          >
            <ImageIcon size={14} className="text-primary" />
            <span className="text-xs">图片</span>
          </div>
          <div
            className="border-border flex items-center gap-2 border-b px-2"
            style={{ height: TRACK_HEIGHT }}
          >
            <Music size={14} className="text-muted-foreground" />
            <span className="text-xs">音频</span>
          </div>
          <div
            className="flex items-center gap-2 px-2"
            style={{ height: TRACK_HEIGHT }}
          >
            <Type size={14} className="text-muted-foreground" />
            <span className="text-xs">字幕</span>
          </div>
        </div>

        {/* 时间轴内容 */}
        <div
          ref={timelineRef}
          className="relative flex-1 overflow-x-auto"
          onClick={handleTimelineClick}
        >
          {/* 时间标尺 */}
          <div className="border-border bg-card/50 relative h-6 border-b">
            {generateTimeMarkers()}
          </div>

          {/* 轨道内容 */}
          <div
            className="relative"
            style={{ width: totalDuration * pixelsPerSecond + 100 }}
          >
            {/* 视频轨道 */}
            <div
              className="border-border relative border-b"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`video-${scene.id}`}
                  className={`absolute top-1 bottom-1 cursor-pointer rounded transition-all ${
                    selectedSceneId === scene.id
                      ? "ring-primary ring-2"
                      : "hover:ring-1 hover:ring-gray-500"
                  } ${scene.videoUrl ? "bg-primary/40" : "bg-secondary/50"}`}
                  style={{
                    left: sceneStartTimes[scene.id] * pixelsPerSecond,
                    width: scene.duration * pixelsPerSecond - 2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSceneSelect(scene.id);
                  }}
                >
                  <div className="truncate px-2 py-1 text-xs">
                    #{scene.order + 1}
                  </div>
                  {/* 拖拽调整手柄 */}
                  <div
                    className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize bg-white/20 hover:bg-white/40"
                    onMouseDown={(e) =>
                      handleDragStart(e, scene.id, scene.duration)
                    }
                  />
                </div>
              ))}
            </div>

            {/* 图片轨道 */}
            <div
              className="border-border relative border-b"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`image-${scene.id}`}
                  className={`absolute top-1 bottom-1 rounded ${
                    scene.imageUrl ? "bg-primary/50" : "bg-secondary/30"
                  }`}
                  style={{
                    left: sceneStartTimes[scene.id] * pixelsPerSecond,
                    width: scene.duration * pixelsPerSecond - 2,
                  }}
                >
                  {scene.imageUrl && (
                    <img
                      src={scene.imageUrl}
                      alt=""
                      className="h-full w-auto rounded object-cover opacity-60"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* 音频轨道 */}
            <div
              className="border-border relative border-b"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`audio-${scene.id}`}
                  className={`absolute top-1 bottom-1 rounded ${
                    scene.audioUrl ? "bg-primary/40" : "bg-secondary/30"
                  }`}
                  style={{
                    left: sceneStartTimes[scene.id] * pixelsPerSecond,
                    width: scene.duration * pixelsPerSecond - 2,
                  }}
                >
                  {scene.audioUrl && (
                    <div className="flex h-full items-center px-2">
                      <div className="h-4 flex-1 overflow-hidden rounded bg-green-500/30">
                        {/* 简化的波形图 */}
                        <div className="flex h-full items-center gap-px">
                          {WAVEFORM_HEIGHTS.map((h, i) => (
                            <div
                              key={i}
                              className="bg-primary/70 flex-1"
                              style={{ height: `${h}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 字幕轨道 */}
            <div className="relative" style={{ height: TRACK_HEIGHT }}>
              {scenes.map((scene) => {
                const text = scene.dialogue || scene.narration;
                return (
                  <div
                    key={`subtitle-${scene.id}`}
                    className={`absolute top-1 bottom-1 rounded ${
                      text ? "bg-primary/40" : "bg-secondary/30"
                    }`}
                    style={{
                      left: sceneStartTimes[scene.id] * pixelsPerSecond,
                      width: scene.duration * pixelsPerSecond - 2,
                    }}
                  >
                    {text && (
                      <div className="truncate px-2 py-1 text-xs">{text}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 播放头 */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-red-500"
              style={{ left: currentTime * pixelsPerSecond }}
            >
              <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-red-500" />
            </div>
          </div>
        </div>
      </div>

      {/* 当前场景信息 */}
      {currentScene && (
        <div className="border-border text-muted-foreground border-t px-4 py-2 text-sm">
          当前: 分镜 #{currentScene.order + 1} | 时长: {currentScene.duration}s
          {currentScene.dialogue &&
            ` | 对话: "${currentScene.dialogue.slice(0, 30)}..."`}
        </div>
      )}
    </div>
  );
}

// memo：props 多为稳定引用（setState / useCallback / RQ 缓存），
// 避免编辑器弹窗类 state 变化时重渲染整条时间轴。
export const TimelineEditor = memo(TimelineEditorImpl);
