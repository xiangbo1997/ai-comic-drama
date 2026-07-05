"use client";

import { useState } from "react";
import type { SceneEffect, SceneEffectId } from "@/types/export-style";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface SceneOption {
  id: string;
  order: number;
  description: string;
}

/**
 * 滤镜预设选项（与 video-synthesis 的 FX_FILTERS 一致）。
 * 空字符串值代表「无滤镜」。
 */
const EFFECT_OPTIONS: { value: SceneEffectId | ""; label: string }[] = [
  { value: "", label: "无滤镜" },
  { value: "vivid", label: "鲜艳" },
  { value: "bw", label: "黑白" },
  { value: "sepia", label: "棕褐（做旧）" },
  { value: "warm", label: "暖色" },
  { value: "cold", label: "冷色" },
  { value: "vignette", label: "暗角" },
  { value: "blur", label: "模糊" },
  { value: "sharpen", label: "锐化" },
  { value: "vintage", label: "复古" },
  { value: "oldfilm", label: "老电影" },
  { value: "tealorange", label: "青橙" },
  { value: "dreampurple", label: "梦幻紫" },
];

/**
 * 分镜滤镜 / 变速配置弹窗。
 * 按 sceneId 关联，每个分镜可选滤镜预设 + 变速倍率。
 * 本地 draft state，点「完成」一次性保存——与字幕/水印/贴图弹窗同模式。
 *
 * 只持久化「非默认」的分镜（有滤镜或变速≠1），避免存一堆空配置。
 */
export function SceneEffectDialog({
  initialEffects,
  scenes,
  onSave,
  onClose,
}: {
  initialEffects?: SceneEffect[];
  scenes: SceneOption[];
  onSave: (effects: SceneEffect[]) => void;
  onClose: () => void;
}) {
  // 以分镜为主键建 draft：每个分镜一份配置（缺省 effect=null, speed=1）
  const [draft, setDraft] = useState<Record<string, SceneEffect>>(() => {
    const map: Record<string, SceneEffect> = {};
    for (const sc of scenes) {
      const found = initialEffects?.find((e) => e.sceneId === sc.id);
      map[sc.id] = {
        sceneId: sc.id,
        effect: found?.effect ?? null,
        speed: found?.speed ?? 1,
      };
    }
    return map;
  });

  const updateScene = (sceneId: string, patch: Partial<SceneEffect>) => {
    setDraft((prev) => ({
      ...prev,
      [sceneId]: { ...prev[sceneId], ...patch },
    }));
  };

  const handleSave = () => {
    // 仅保留有实际效果的分镜（有滤镜 或 变速≠1）
    const effects = Object.values(draft).filter(
      (e) => (e.effect != null && e.effect !== undefined) || e.speed !== 1
    );
    onSave(effects);
    onClose();
  };

  // 组件仅在父级为真时挂载，故恒为打开；关闭统一走 onClose。
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle>滤镜 / 变速（按分镜）</DialogTitle>
          <DialogDescription className="sr-only">
            为每个分镜选择滤镜预设并调整播放速度
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {scenes.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              暂无分镜
            </p>
          ) : (
            scenes.map((sc) => {
              const eff = draft[sc.id];
              return (
                <div
                  key={sc.id}
                  className="bg-secondary/40 space-y-2 rounded-lg p-3"
                >
                  <p className="text-xs font-medium">
                    镜 #{sc.order + 1}{" "}
                    <span className="text-muted-foreground font-normal">
                      {sc.description.slice(0, 20)}
                    </span>
                  </p>

                  {/* 滤镜 */}
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground w-10 text-xs">
                      滤镜
                    </span>
                    <select
                      value={eff.effect ?? ""}
                      onChange={(e) =>
                        updateScene(sc.id, {
                          effect:
                            e.target.value === ""
                              ? null
                              : (e.target.value as SceneEffectId),
                        })
                      }
                      className="bg-card focus:ring-primary min-w-0 flex-1 rounded px-2 py-1.5 text-xs focus:ring-2 focus:outline-none"
                    >
                      {EFFECT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 变速 */}
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground w-10 text-xs">
                      变速
                    </span>
                    <input
                      type="range"
                      min="0.25"
                      max="4"
                      step="0.25"
                      value={eff.speed ?? 1}
                      onChange={(e) =>
                        updateScene(sc.id, { speed: Number(e.target.value) })
                      }
                      className="flex-1"
                    />
                    <span className="text-muted-foreground w-10 text-right text-xs">
                      {(eff.speed ?? 1).toFixed(2)}×
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="border-border shrink-0 justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded-lg px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="bg-primary hover:bg-primary/90 rounded-lg px-4 py-2 text-sm"
          >
            完成
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
