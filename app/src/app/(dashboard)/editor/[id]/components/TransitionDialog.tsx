"use client";

import { useState } from "react";
import {
  DEFAULT_TRANSITION,
  type Transition,
  type TransitionType,
} from "@/types/export-style";
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
 * 转场类型选项（与 video-synthesis 的 XFADE_TYPES 白名单一致）。
 * "none" 为硬切（导出侧用极短淡化近似）。
 */
const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: "none", label: "硬切（无转场）" },
  { value: "fade", label: "淡入淡出" },
  { value: "fadeblack", label: "黑场过渡" },
  { value: "fadewhite", label: "白场过渡" },
  { value: "dissolve", label: "溶解" },
  { value: "wipeleft", label: "擦除 ←" },
  { value: "wiperight", label: "擦除 →" },
  { value: "wipeup", label: "擦除 ↑" },
  { value: "wipedown", label: "擦除 ↓" },
  { value: "slideleft", label: "滑动 ←" },
  { value: "slideright", label: "滑动 →" },
  { value: "slideup", label: "滑动 ↑" },
  { value: "slidedown", label: "滑动 ↓" },
  { value: "circleopen", label: "圆形展开" },
  { value: "circleclose", label: "圆形收拢" },
  { value: "radial", label: "径向" },
  { value: "smoothleft", label: "平滑 ←" },
  { value: "smoothright", label: "平滑 →" },
];

/**
 * 分镜间转场配置弹窗。
 * transitions[k] 描述第 k 与第 k+1 分镜之间的转场，因此项数 = scenes.length - 1。
 * 本地 draft state，点「完成」一次性保存——与字幕/水印/贴图弹窗同模式。
 */
export function TransitionDialog({
  initialTransitions,
  scenes,
  onSave,
  onClose,
}: {
  initialTransitions?: Transition[];
  scenes: SceneOption[];
  onSave: (transitions: Transition[]) => void;
  onClose: () => void;
}) {
  // 衔接数量 = 分镜数 - 1；缺省项用默认转场补齐，保证每个衔接都有可编辑项
  const gapCount = Math.max(0, scenes.length - 1);
  const [transitions, setTransitions] = useState<Transition[]>(() =>
    Array.from(
      { length: gapCount },
      (_, k) => initialTransitions?.[k] ?? { ...DEFAULT_TRANSITION }
    )
  );

  const updateGap = (index: number, patch: Partial<Transition>) => {
    setTransitions((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
    );
  };

  // 一键应用到全部衔接（取第一项作为模板）
  const applyToAll = () => {
    if (transitions.length === 0) return;
    const tpl = transitions[0];
    setTransitions((prev) => prev.map(() => ({ ...tpl })));
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
          <DialogTitle>转场设置（分镜之间）</DialogTitle>
          <DialogDescription className="sr-only">
            为相邻分镜之间设置转场类型与时长
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {gapCount === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              至少需要 2 个分镜才能设置转场
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">
                  共 {gapCount} 个衔接，可逐个或一键统一设置
                </p>
                <button
                  onClick={applyToAll}
                  className="text-primary hover:bg-secondary rounded px-2 py-1 text-xs transition"
                >
                  应用首项到全部
                </button>
              </div>

              {transitions.map((t, k) => (
                <div
                  key={k}
                  className="bg-secondary/40 space-y-2 rounded-lg p-3"
                >
                  <p className="text-xs font-medium">
                    镜 #{scenes[k].order + 1} → 镜 #{scenes[k + 1].order + 1}
                  </p>

                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground w-10 text-xs">
                      类型
                    </span>
                    <select
                      value={t.type}
                      onChange={(e) =>
                        updateGap(k, {
                          type: e.target.value as TransitionType,
                        })
                      }
                      className="bg-card focus:ring-primary min-w-0 flex-1 rounded px-2 py-1.5 text-xs focus:ring-2 focus:outline-none"
                    >
                      {TRANSITION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 硬切无时长 */}
                  {t.type !== "none" && (
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground w-10 text-xs">
                        时长
                      </span>
                      <input
                        type="range"
                        min="0.1"
                        max="2"
                        step="0.1"
                        value={t.duration}
                        onChange={(e) =>
                          updateGap(k, { duration: Number(e.target.value) })
                        }
                        className="flex-1"
                      />
                      <span className="text-muted-foreground w-10 text-right text-xs">
                        {t.duration.toFixed(1)}s
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </>
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
            onClick={() => {
              onSave(transitions);
              onClose();
            }}
            className="bg-primary hover:bg-primary/90 rounded-lg px-4 py-2 text-sm"
          >
            完成
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
