"use client";

import { useEffect } from "react";
import type { Scene } from "@/types";

/**
 * 编辑器分镜键盘快捷键（a5 审计 P1-3）
 *
 * 专业创作工具应支持键盘切换分镜，避免 20-40 个分镜纯鼠标逐个点。
 * - ↑ / K：上一个分镜
 * - ↓ / J：下一个分镜
 *
 * 只在焦点不在输入控件（input/textarea/select/contenteditable）时生效，
 * 避免在描述/对话文本框里打字时误触发切换。
 */
export function useSceneKeyboard(
  scenes: Scene[],
  selectedSceneId: string | null,
  onSelect: (id: string) => void
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 焦点在可编辑控件时不拦截（让打字正常）
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (el as HTMLElement).isContentEditable
        ) {
          return;
        }
      }
      // 带修饰键的组合不接管（避免和浏览器/系统快捷键冲突）
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      let delta = 0;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") delta = 1;
      else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K")
        delta = -1;
      else return;

      if (scenes.length === 0) return;
      const idx = scenes.findIndex((s) => s.id === selectedSceneId);
      // 未选中时 ↓ 选第一个、↑ 选最后一个
      const nextIdx =
        idx === -1
          ? delta > 0
            ? 0
            : scenes.length - 1
          : Math.max(0, Math.min(scenes.length - 1, idx + delta));
      if (scenes[nextIdx]) {
        e.preventDefault();
        onSelect(scenes[nextIdx].id);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scenes, selectedSceneId, onSelect]);
}
