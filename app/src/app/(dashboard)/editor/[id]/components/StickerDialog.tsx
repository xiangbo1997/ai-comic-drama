"use client";

import { useState } from "react";
import { X, Upload, Trash2, Loader2 } from "lucide-react";
import type { Sticker } from "@/types/export-style";
import { uploadFileViaApi } from "@/lib/upload-client";

interface SceneOption {
  id: string;
  order: number;
  description: string;
}

/**
 * 贴图管理弹窗（多贴图 + 时间窗）。
 * 本地 draft state，点「完成」一次性保存——避免每次改动 PATCH 导致刷回。
 */
export function StickerDialog({
  initialStickers,
  scenes,
  onSave,
  onClose,
}: {
  initialStickers?: Sticker[];
  scenes: SceneOption[];
  onSave: (stickers: Sticker[]) => void;
  onClose: () => void;
}) {
  const [stickers, setStickers] = useState<Sticker[]>(initialStickers ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSticker = (id: string, patch: Partial<Sticker>) => {
    setStickers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const removeSticker = (id: string) => {
    setStickers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // 通过 uploadFileViaApi 上传（自动适配 R2 / 本地存储两种后端）
      const fileUrl = await uploadFileViaApi({ file, fileType: "image" });
      // 新贴图默认绑定第一个分镜，居中
      const newSticker: Sticker = {
        id: `stk_${Date.now()}`,
        imageUrl: fileUrl,
        sceneId: scenes[0]?.id ?? "",
        x: 0.5,
        y: 0.5,
        scale: 0.2,
      };
      setStickers((prev) => [...prev, newSticker]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传出错");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">贴图 / 表情（按分镜叠加）</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg p-1.5 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {/* 上传新贴图 */}
          <label className="border-border hover:bg-secondary/50 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition">
            {uploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            {uploading ? "上传中..." : "上传贴图（PNG 透明底最佳）"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          {error && <p className="text-destructive text-xs">{error}</p>}

          {stickers.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              暂无贴图，上传后可绑定到分镜并调整位置
            </p>
          )}

          {/* 贴图列表 */}
          {stickers.map((st) => (
            <div
              key={st.id}
              className="bg-secondary/40 space-y-2 rounded-lg p-3"
            >
              <div className="flex items-center gap-3">
                <img
                  src={st.imageUrl}
                  alt=""
                  className="bg-background h-12 w-12 shrink-0 rounded object-contain"
                />
                <select
                  value={st.sceneId}
                  onChange={(e) =>
                    updateSticker(st.id, { sceneId: e.target.value })
                  }
                  className="bg-card focus:ring-primary min-w-0 flex-1 rounded px-2 py-1.5 text-xs focus:ring-2 focus:outline-none"
                >
                  {scenes.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      #{sc.order + 1} {sc.description.slice(0, 16)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeSticker(st.id)}
                  className="text-destructive hover:bg-destructive/10 rounded p-1.5"
                  title="删除贴图"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 位置九宫格 */}
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-10 text-xs">位置</span>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 0.5, 1].map((py) =>
                    [0, 0.5, 1].map((px) => {
                      const active =
                        Math.abs(st.x - px) < 0.01 &&
                        Math.abs(st.y - py) < 0.01;
                      return (
                        <button
                          key={`${px}-${py}`}
                          onClick={() => updateSticker(st.id, { x: px, y: py })}
                          className={`h-5 w-5 rounded border transition ${
                            active
                              ? "border-primary bg-primary"
                              : "border-border hover:bg-secondary"
                          }`}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {/* 大小 */}
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-10 text-xs">大小</span>
                <input
                  type="range"
                  min="0.05"
                  max="0.6"
                  step="0.01"
                  value={st.scale}
                  onChange={(e) =>
                    updateSticker(st.id, { scale: Number(e.target.value) })
                  }
                  className="flex-1"
                />
                <span className="text-muted-foreground w-10 text-right text-xs">
                  {Math.round(st.scale * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="border-border flex shrink-0 justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(stickers);
              onClose();
            }}
            className="bg-primary hover:bg-primary/90 rounded-lg px-4 py-2 text-sm"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
