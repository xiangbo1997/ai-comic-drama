/**
 * 导出任务进度写入的纯逻辑。
 *
 * 单独成文件而非留在 route 里：route 会连带加载 next-auth / Prisma，
 * node 环境的单测 import 不进来（实测报 Cannot find module 'next/server'）。
 * 这条合并语义是「导出显示成功却拿不到视频」竞态的修复核心，必须可测。
 */

import type { Prisma } from "@prisma/client";

// 1080p 多镜头实测可超过 12 分钟；前端等待窗口必须覆盖分层合成和上传。
export const EXPORT_POLL_TIMEOUT_MS = 30 * 60 * 1000;

export function hasExportPollTimedOut(
  startedAt: number,
  now = Date.now()
): boolean {
  return now - startedAt >= EXPORT_POLL_TIMEOUT_MS;
}

/**
 * 把 progress 合并进已有的 task.output，保留其余所有键（尤其 videoUrl/size）。
 *
 * output 是 Json 列，Prisma 的写是整值覆盖而非字段级合并——直接写 { progress }
 * 会把已落库的 videoUrl 抹成不存在。非对象/数组/null 的历史值一律当空对象起步
 * （数组展开会得到 { "0": ... } 这种脏结构，不如丢弃）。
 */
export function mergeProgressIntoOutput(
  prevOutput: unknown,
  progress: number
): Prisma.InputJsonObject {
  const base =
    prevOutput && typeof prevOutput === "object" && !Array.isArray(prevOutput)
      ? (prevOutput as Prisma.InputJsonObject)
      : {};
  return { ...base, progress };
}
