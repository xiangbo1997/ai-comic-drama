"use client";

import { useState } from "react";
import type {
  SceneEffect,
  SceneEffectId,
  SceneSfx,
} from "@/types/export-style";
import { SFX_CATEGORIES, SFX_LIBRARY } from "@/lib/sfx-library";
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

/** 每镜音效上限（与解析层克制规则、scenes 聚合端一致） */
const MAX_SFX_PER_SCENE = 2;

/**
 * 分镜滤镜 / 变速 / 音效配置弹窗。
 * 按 sceneId 关联；滤镜+变速沿用原有 draft 模式，音效（批1）每镜最多 2 条
 * （分类分组下拉 + 镜内偏移秒）。点「完成」一次性保存——与字幕/水印/贴图弹窗同模式。
 *
 * 只持久化「非默认」的分镜（有滤镜或变速≠1）；音效仅持久化已选条目。
 */
export function SceneEffectDialog({
  initialEffects,
  initialSfx,
  scenes,
  onSave,
  onClose,
}: {
  initialEffects?: SceneEffect[];
  initialSfx?: SceneSfx[];
  scenes: SceneOption[];
  onSave: (effects: SceneEffect[], sfx: SceneSfx[]) => void;
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

  // 音效 draft：sceneId → 该镜音效行（≤2）。解析层自动填充的配置也在此可见可改。
  const [sfxDraft, setSfxDraft] = useState<Record<string, SceneSfx[]>>(() => {
    const map: Record<string, SceneSfx[]> = {};
    for (const sc of scenes) {
      map[sc.id] = (initialSfx ?? [])
        .filter((s) => s.sceneId === sc.id)
        .slice(0, MAX_SFX_PER_SCENE);
    }
    return map;
  });

  const updateScene = (sceneId: string, patch: Partial<SceneEffect>) => {
    setDraft((prev) => ({
      ...prev,
      [sceneId]: { ...prev[sceneId], ...patch },
    }));
  };

  const updateSfxRow = (
    sceneId: string,
    index: number,
    patch: Partial<SceneSfx>
  ) => {
    setSfxDraft((prev) => ({
      ...prev,
      [sceneId]: prev[sceneId].map((row, i) =>
        i === index ? { ...row, ...patch } : row
      ),
    }));
  };

  const addSfxRow = (sceneId: string) => {
    setSfxDraft((prev) => ({
      ...prev,
      [sceneId]: [
        ...prev[sceneId],
        { sceneId, sfxId: SFX_LIBRARY[0]?.id ?? "", offsetSec: 0 },
      ],
    }));
  };

  const removeSfxRow = (sceneId: string, index: number) => {
    setSfxDraft((prev) => ({
      ...prev,
      [sceneId]: prev[sceneId].filter((_, i) => i !== index),
    }));
  };

  const handleSave = () => {
    // 仅保留有实际效果的分镜（有滤镜 或 变速≠1）
    const effects = Object.values(draft).filter(
      (e) => (e.effect != null && e.effect !== undefined) || e.speed !== 1
    );
    // 音效按分镜顺序拍平，丢弃未选 id 的空行
    const sfx = scenes.flatMap((sc) =>
      (sfxDraft[sc.id] ?? []).filter((row) => row.sfxId)
    );
    onSave(effects, sfx);
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
          <DialogTitle>滤镜 / 变速 / 音效（按分镜）</DialogTitle>
          <DialogDescription className="sr-only">
            为每个分镜选择滤镜预设、调整播放速度并配置音效
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
              const sfxRows = sfxDraft[sc.id] ?? [];
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

                  {/* 音效（批1）：每镜 ≤2 条，分类分组下拉 + 镜内偏移秒 */}
                  {sfxRows.map((row, ri) => (
                    <div key={ri} className="flex items-center gap-3">
                      <span className="text-muted-foreground w-10 text-xs">
                        音效
                      </span>
                      <select
                        value={row.sfxId}
                        onChange={(e) =>
                          updateSfxRow(sc.id, ri, { sfxId: e.target.value })
                        }
                        className="bg-card focus:ring-primary min-w-0 flex-1 rounded px-2 py-1.5 text-xs focus:ring-2 focus:outline-none"
                      >
                        {SFX_CATEGORIES.map((cat) => (
                          <optgroup key={cat.id} label={cat.label}>
                            {SFX_LIBRARY.filter(
                              (s) => s.category === cat.id
                            ).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}（{s.durationSec.toFixed(1)}s）
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={row.offsetSec}
                        onChange={(e) =>
                          updateSfxRow(sc.id, ri, {
                            offsetSec: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="bg-card focus:ring-primary w-16 rounded px-2 py-1.5 text-xs focus:ring-2 focus:outline-none"
                        title="镜内触发秒（0=镜头开始）"
                      />
                      <button
                        onClick={() => removeSfxRow(sc.id, ri)}
                        className="text-muted-foreground hover:text-destructive text-xs"
                        title="删除该音效"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {sfxRows.length < MAX_SFX_PER_SCENE && (
                    <button
                      onClick={() => addSfxRow(sc.id)}
                      className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                    >
                      + 添加音效
                    </button>
                  )}
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
