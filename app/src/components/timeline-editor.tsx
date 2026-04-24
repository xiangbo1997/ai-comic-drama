"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
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

export function TimelineEditor({
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
  const sceneStartTimes = scenes.reduce<Record<string, number>>((acc, scene, index) => {
    const prevScene = scenes[index - 1];
    acc[scene.id] = index === 0 ? 0 : acc[prevScene?.id ?? ""] + (prevScene?.duration ?? 0);
    return acc;
  }, {});

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
  const handleDragStart = (e: React.MouseEvent, sceneId: string, currentDuration: number) => {
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
  }, [draggingScene, dragStartX, dragStartDuration, pixelsPerSecond, onSceneDurationChange]);

  // 生成时间刻度
  const generateTimeMarkers = () => {
    const markers = [];
    const interval = zoom >= 1 ? 1 : zoom >= 0.5 ? 2 : 5;
    for (let i = 0; i <= Math.ceil(totalDuration); i += interval) {
      markers.push(
        <div
          key={i}
          className="absolute top-0 h-full border-l border-gray-700"
          style={{ left: i * pixelsPerSecond }}
        >
          <span className="absolute -top-5 left-1 text-xs text-gray-500">
            {formatTime(i)}
          </span>
        </div>
      );
    }
    return markers;
  };

  return (
    <div className="bg-gray-900 border-t border-gray-700">
      {/* 控制栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTime(0)}
            className="p-1.5 hover:bg-gray-700 rounded"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            onClick={() => setCurrentTime(totalDuration)}
            className="p-1.5 hover:bg-gray-700 rounded"
          >
            <SkipForward size={18} />
          </button>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1.5 hover:bg-gray-700 rounded"
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-mono">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">缩放</span>
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.25"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-20"
            />
            <span className="text-xs text-gray-400">{zoom}x</span>
          </div>
        </div>
      </div>

      {/* 轨道区域 */}
      <div className="flex">
        {/* 轨道标签 */}
        <div className="w-24 shrink-0 border-r border-gray-700">
          <div className="h-6 border-b border-gray-700" />
          <div
            className="flex items-center gap-2 px-2 border-b border-gray-800"
            style={{ height: TRACK_HEIGHT }}
          >
            <Video size={14} className="text-purple-400" />
            <span className="text-xs">视频</span>
          </div>
          <div
            className="flex items-center gap-2 px-2 border-b border-gray-800"
            style={{ height: TRACK_HEIGHT }}
          >
            <ImageIcon size={14} className="text-blue-400" />
            <span className="text-xs">图片</span>
          </div>
          <div
            className="flex items-center gap-2 px-2 border-b border-gray-800"
            style={{ height: TRACK_HEIGHT }}
          >
            <Music size={14} className="text-green-400" />
            <span className="text-xs">音频</span>
          </div>
          <div
            className="flex items-center gap-2 px-2"
            style={{ height: TRACK_HEIGHT }}
          >
            <Type size={14} className="text-yellow-400" />
            <span className="text-xs">字幕</span>
          </div>
        </div>

        {/* 时间轴内容 */}
        <div
          ref={timelineRef}
          className="flex-1 overflow-x-auto relative"
          onClick={handleTimelineClick}
        >
          {/* 时间标尺 */}
          <div className="h-6 relative border-b border-gray-700 bg-gray-800/50">
            {generateTimeMarkers()}
          </div>

          {/* 轨道内容 */}
          <div
            className="relative"
            style={{ width: totalDuration * pixelsPerSecond + 100 }}
          >
            {/* 视频轨道 */}
            <div
              className="relative border-b border-gray-800"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`video-${scene.id}`}
                  className={`absolute top-1 bottom-1 rounded cursor-pointer transition-all ${
                    selectedSceneId === scene.id
                      ? "ring-2 ring-blue-500"
                      : "hover:ring-1 hover:ring-gray-500"
                  } ${scene.videoUrl ? "bg-purple-600/50" : "bg-gray-700/50"}`}
                  style={{
                    left: sceneStartTimes[scene.id] * pixelsPerSecond,
                    width: scene.duration * pixelsPerSecond - 2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSceneSelect(scene.id);
                  }}
                >
                  <div className="px-2 py-1 text-xs truncate">
                    #{scene.order + 1}
                  </div>
                  {/* 拖拽调整手柄 */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/20 hover:bg-white/40"
                    onMouseDown={(e) => handleDragStart(e, scene.id, scene.duration)}
                  />
                </div>
              ))}
            </div>

            {/* 图片轨道 */}
            <div
              className="relative border-b border-gray-800"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`image-${scene.id}`}
                  className={`absolute top-1 bottom-1 rounded ${
                    scene.imageUrl ? "bg-blue-600/50" : "bg-gray-700/30"
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
                      className="h-full w-auto object-cover rounded opacity-60"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* 音频轨道 */}
            <div
              className="relative border-b border-gray-800"
              style={{ height: TRACK_HEIGHT }}
            >
              {scenes.map((scene) => (
                <div
                  key={`audio-${scene.id}`}
                  className={`absolute top-1 bottom-1 rounded ${
                    scene.audioUrl ? "bg-green-600/50" : "bg-gray-700/30"
                  }`}
                  style={{
                    left: sceneStartTimes[scene.id] * pixelsPerSecond,
                    width: scene.duration * pixelsPerSecond - 2,
                  }}
                >
                  {scene.audioUrl && (
                    <div className="flex items-center h-full px-2">
                      <div className="flex-1 h-4 bg-green-500/30 rounded overflow-hidden">
                        {/* 简化的波形图 */}
                        <div className="flex items-center h-full gap-px">
                          {Array.from({ length: 20 }).map((_, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-green-400"
                              style={{
                                height: `${30 + Math.random() * 70}%`,
                              }}
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
                      text ? "bg-yellow-600/50" : "bg-gray-700/30"
                    }`}
                    style={{
                      left: sceneStartTimes[scene.id] * pixelsPerSecond,
                      width: scene.duration * pixelsPerSecond - 2,
                    }}
                  >
                    {text && (
                      <div className="px-2 py-1 text-xs truncate">{text}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 播放头 */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
              style={{ left: currentTime * pixelsPerSecond }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* 当前场景信息 */}
      {currentScene && (
        <div className="px-4 py-2 border-t border-gray-700 text-sm text-gray-400">
          当前: 分镜 #{currentScene.order + 1} | 时长: {currentScene.duration}s
          {currentScene.dialogue && ` | 对话: "${currentScene.dialogue.slice(0, 30)}..."`}
        </div>
      )}
    </div>
  );
}
