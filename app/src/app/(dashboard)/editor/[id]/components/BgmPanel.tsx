"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Music, Play, Pause } from "lucide-react";
import type { BackgroundMusic } from "@/types/export-style";
import {
  BGM_CATEGORIES,
  getBgmTracksByCategory,
  type BgmTrack,
} from "@/lib/bgm-library";
import { uploadFileViaApi } from "@/lib/upload-client";

interface BgmPanelProps {
  /** 当前 BGM 配置 */
  value: BackgroundMusic;
  /** 配置变更回调，始终传入新对象（不可变） */
  onChange: (m: BackgroundMusic) => void;
  /** 当前项目 ID（用户上传归档用） */
  projectId: string;
  /**
   * 分段自动配乐开关当前值（缺省即开）。
   * 该字段存在 generationParams.autoBgmSegments，不属于 BackgroundMusic，
   * 故与 value/onChange 分开传。
   */
  autoSegments?: boolean;
  /** 分段开关变更回调 */
  onAutoSegmentsChange?: (enabled: boolean) => void;
}

/**
 * 配乐（背景音乐）配置面板。
 * 包含：启用开关、内置分类曲库 + 试听、用户上传、音量/淡入/淡出滑块、
 * 循环铺满、对白自动压低（ducking）开关。
 */
export function BgmPanel({
  value,
  onChange,
  projectId,
  autoSegments,
  onAutoSegmentsChange,
}: BgmPanelProps) {
  const [activeCategory, setActiveCategory] = useState(BGM_CATEGORIES[0].id);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ducking 缺省即开：与 DEFAULT_BACKGROUND_MUSIC、generation-params-normalize
  // 以及导出端 buildBgmFilter 的 `!== false` 判据同源。老配置缺此字段时开关
  // 必须显示为「开」，否则 UI 说关、导出实际在闪避，两边对不上。
  const duckingOn = value.ducking !== false;

  // 分段自动配乐缺省即开（`!== false`），与导出端 options.autoBgmSegments
  // 及 generation-params-normalize 的判据同源——老配置缺此字段时开关必须
  // 显示为「开」，否则 UI 说关、导出实际在分段，两边对不上。
  const autoSegmentsOn = autoSegments !== false;
  // 用户手动选定内置曲目后，导出端尊重其选曲不再分段——UI 必须如实反映，
  // 否则开关显示「开」而成片仍是一首，用户会认为功能坏了。
  const segmentsOverriddenByTrack = Boolean(value.trackId);

  // 卸载时停止试听，避免音频残留播放
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  /** 试听切换（单例 audio，点同一首暂停，点别的切换） */
  const togglePreview = (track: BgmTrack) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => setPlayingId(null));
    }
    const audio = audioRef.current;
    if (playingId === track.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = track.url;
    audio.play().catch(() => {
      // 文件缺失/格式不支持时静默失败，不阻塞 UI
      setPlayingId(null);
    });
    setPlayingId(track.id);
  };

  /** 选中内置曲目 */
  const selectTrack = (track: BgmTrack) => {
    onChange({
      ...value,
      trackId: track.id,
      url: track.url,
      enabled: true,
    });
  };

  /** 上传自己的音乐（走 audio 类型，R2/本地自动切） */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fileUrl = await uploadFileViaApi({
        file,
        fileType: "audio",
        projectId,
      });
      onChange({ ...value, url: fileUrl, trackId: undefined, enabled: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传出错");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const tracks = getBgmTracksByCategory(activeCategory);
  // 当前选中的是用户上传（有 url 但无 trackId 且非内置）
  const isUploadedSelected = !!value.url && !value.trackId;

  return (
    <div className="space-y-4">
      {/* 启用开关 */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-sm font-medium">启用配乐</span>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`focus:ring-primary relative h-5 w-9 rounded-full transition-colors focus:ring-2 focus:outline-none ${
            value.enabled ? "bg-primary" : "bg-secondary border-border border"
          }`}
        >
          <span
            className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              value.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>

      {value.enabled && (
        <div className="space-y-4">
          {/* 分类 Tab */}
          <div className="flex flex-wrap gap-1.5">
            {BGM_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  activeCategory === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary hover:bg-border text-muted-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* 曲目列表 */}
          <div className="border-border max-h-52 space-y-1 overflow-y-auto rounded-lg border p-1">
            {tracks.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-center text-xs">
                该分类暂无曲目
              </p>
            ) : (
              tracks.map((track) => {
                const selected = value.trackId === track.id;
                const playing = playingId === track.id;
                return (
                  <div
                    key={track.id}
                    onClick={() => selectTrack(track)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors ${
                      selected ? "bg-primary/15" : "hover:bg-secondary"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePreview(track);
                      }}
                      className="bg-secondary hover:bg-border flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                      title={playing ? "暂停试听" : "试听"}
                    >
                      {playing ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <Music
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="flex-1 truncate text-sm">
                      {track.title}
                    </span>
                    {selected && (
                      <span className="text-primary text-xs">已选</span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 上传自己的音乐 */}
          <div className="border-border border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                或上传自己的音乐
              </span>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="bg-secondary hover:bg-secondary/80 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {uploading ? "上传中..." : "选择音频"}
              </button>
            </div>
            {isUploadedSelected && (
              <p className="text-primary mt-1 text-xs">已选用上传的音乐</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/ogg"
              onChange={handleFileChange}
              className="hidden"
            />
            {uploadError && (
              <p className="mt-1 text-xs text-red-400">{uploadError}</p>
            )}
          </div>

          {/* 音量滑块 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground text-sm">音量</label>
              <span className="text-sm">{Math.round(value.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value.volume}
              onChange={(e) =>
                onChange({ ...value, volume: Number(e.target.value) })
              }
              className="accent-primary w-full"
            />
          </div>

          {/* 淡入 / 淡出 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-muted-foreground text-sm">淡入</label>
                <span className="text-sm">{value.fadeIn.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={value.fadeIn}
                onChange={(e) =>
                  onChange({ ...value, fadeIn: Number(e.target.value) })
                }
                className="accent-primary w-full"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-muted-foreground text-sm">淡出</label>
                <span className="text-sm">{value.fadeOut.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={value.fadeOut}
                onChange={(e) =>
                  onChange({ ...value, fadeOut: Number(e.target.value) })
                }
                className="accent-primary w-full"
              />
            </div>
          </div>

          {/* 分段自动配乐（按剧情情绪切换曲目） */}
          {onAutoSegmentsChange && (
            <div>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-sm">分段自动配乐</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSegmentsOn}
                  onClick={() => onAutoSegmentsChange(!autoSegmentsOn)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    autoSegmentsOn
                      ? "bg-primary"
                      : "bg-secondary border-border border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      autoSegmentsOn ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>
              <p className="text-muted-foreground mt-1 text-xs">
                {segmentsOverriddenByTrack
                  ? "已手动选定曲目，全片将统一使用该曲；清除选曲后分段才生效。"
                  : autoSegmentsOn
                    ? "按剧情情绪把全片切成数段，各段自动配不同曲目，段间交叉淡化衔接。"
                    : "全片统一使用一首曲目。"}
              </p>
            </div>
          )}

          {/* 循环铺满 */}
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-sm">循环铺满整片</span>
            <button
              type="button"
              role="switch"
              aria-checked={value.loop}
              onClick={() => onChange({ ...value, loop: !value.loop })}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                value.loop ? "bg-primary" : "bg-secondary border-border border"
              }`}
            >
              <span
                className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  value.loop ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          {/* 对白时自动压低音乐（ducking） */}
          <label className="flex cursor-pointer items-center justify-between">
            <div>
              <span className="text-sm">对白时自动压低音乐</span>
              <p className="text-muted-foreground text-xs">
                有配音时对白更清晰
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={duckingOn}
              onClick={() => onChange({ ...value, ducking: !duckingOn })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                duckingOn ? "bg-primary" : "bg-secondary border-border border"
              }`}
            >
              <span
                className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  duckingOn ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>
      )}
    </div>
  );
}
