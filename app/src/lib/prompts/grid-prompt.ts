/**
 * 九宫格合成图 Prompt 构建
 *
 * 对应创作者手动流程第 4 步：把九宫格分镜表渲成一张含 9 格连续动作的合成图。
 */

import { getSimpleStylePrefix } from "@/lib/prompts";
import type { StoryboardCell } from "@/types/drama";

/**
 * 把九宫格分镜表拼成一张 3×3 合成图的 prompt。
 * 每格描述其镜头 + 特写要点，强调九格连续、风格统一。
 */
export function buildGridImagePrompt(
  cells: StoryboardCell[],
  style: string = "anime"
): string {
  const stylePrefix = getSimpleStylePrefix(style);

  const panels = cells
    .slice(0, 9)
    .map((c) => `panel ${c.index}: ${c.sceneTitle}, ${c.shot}, ${c.closeup}`)
    .join("; ");

  return [
    stylePrefix,
    "a 3x3 storyboard grid of 9 sequential panels, consistent character and art style across all panels, clear panel borders",
    panels,
    "cinematic, highly detailed, masterpiece, best quality",
  ]
    .filter(Boolean)
    .join(", ");
}
