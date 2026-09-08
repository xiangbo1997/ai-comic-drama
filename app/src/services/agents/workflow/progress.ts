/**
 * Workflow 进度计算（从 `workflow-engine.ts#getWorkflowStatus` 提取的纯函数）
 *
 * 提取动机：进度百分比是前端进度条的唯一数据源，但此前埋在 DB 查询函数里无法单测。
 * 计算规则与提取前逐字一致（completed 步数 / 固定 7 步，四舍五入取整）。
 */

import type { WorkflowStepInfo } from "../types";

/** 固定步骤数：parse_script → build_character_bible → build_storyboard → generate_images → generate_videos → generate_audios → export */
export const TOTAL_WORKFLOW_STEPS = 7;

/**
 * 按已完成步骤数计算进度百分比（0–100 整数）。
 *
 * 只统计 status === "completed" 的步骤；running / failed / pending 均不计入。
 */
export function computeWorkflowProgress(steps: WorkflowStepInfo[]): number {
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = TOTAL_WORKFLOW_STEPS; // 固定步骤数
  return Math.round((completedSteps / totalSteps) * 100);
}
