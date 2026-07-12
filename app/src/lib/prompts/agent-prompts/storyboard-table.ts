/**
 * StoryboardTableAgent Prompt 模板
 *
 * 对应创作者手动流程第 6 步：把结构化脚本落成「九宫格分镜表」
 * （场景01-09，每格含 镜头/对白/特写/转场）。强约束输出恰好 9 格。
 */

import type { DramaScriptArtifact } from "@/types/drama";

export const STORYBOARD_TABLE_SYSTEM = `你是一位专业的院线分镜师，擅长把短剧脚本浓缩为「九宫格分镜表」。

九宫格分镜表是一张 3×3 的分镜表，恰好 9 格，每格代表一个关键镜头节点，串起来构成完整短片节奏。

输出要求（严格遵守）：
- 输出纯 JSON，不要 markdown 代码块，不要额外文字
- 顶层字段：cells（数组，长度必须恰好为 9）
- 每格含：index(1-9)、sceneTitle、shot(镜头语言：景别+运镜)、dialogue(对白或null)、closeup(特写要点)、transition(转场效果)
- 9 格要覆盖完整故事弧线：第 1 格 = 本片冲突最高点 / 悬念最强的画面（严禁风景空镜或日常铺垫开场）→ 中段（2-7 格）逐格升级冲突、堆叠爽点 → 第 9 格 = 停在未解决张力的悬念钩子（悬念/反转/情绪/信息/危机 任一），绝不完整收尾
- 景别以近景/特写为主（竖屏），反转/揭秘瞬间用急推特写；shot 要具体（如「大特写·急推」「近景·横移」），便于后续生成`;

export function buildStoryboardTableUserPrompt(
  script: DramaScriptArtifact
): string {
  const scenesBrief = script.scenes
    .map((s) => `场景${s.index}「${s.title}」：${s.description}`)
    .join("\n");

  return `请把以下短剧脚本浓缩为恰好 9 格的九宫格分镜表：

片名：《${script.filmTitle}》
梗概：${script.logline}
风格：${script.style} ｜ 画幅：${script.aspectRatio}

脚本场景：
${scenesBrief}

要求：
1. cells 数组长度必须恰好为 9（不多不少）
2. 节奏完整且钩子分明：第 1 格是冲突最高点/悬念最强画面（钩住观众），中段逐格升级冲突堆爽点，第 9 格停在未解决的悬念钩子上（绝不完整收尾）
3. 每格 shot 写明景别与运镜（以近景/特写为主，反转瞬间用急推特写），closeup 写明该镜头的视觉重点，transition 写转场
4. 有对白则填 dialogue，无则置 null

输出格式：
{
  "cells": [
    {
      "index": 1,
      "sceneTitle": "苍潮界开场",
      "shot": "大全景·缓推",
      "dialogue": null,
      "closeup": "群岛与高空洋流的壮阔全景",
      "transition": "淡入"
    }
  ]
}`;
}

/** 自修复 prompt */
export function buildStoryboardTableRepairPrompt(
  previousOutput: string,
  validationErrors: string
): string {
  return `你之前的输出有格式错误，请修正后重新输出完整 JSON。

特别注意：cells 数组长度必须恰好为 9 格。

你之前的输出（截取）：
${previousOutput.slice(0, 2000)}

验证错误：
${validationErrors}

请修正上述错误，输出完整的正确 JSON。输出纯 JSON，不要 markdown 代码块。`;
}
