/**
 * 生成任务客户端助手（图 / 视频 / TTS 异步化配套，2026-07-04）
 *
 * 服务端生成路由已 task 化：POST 立即返回 { taskId }，工作在后台执行。
 * 本模块提供「发起 + 轮询直至终态」的统一封装，返回值与原同步响应同形
 * （{ imageUrl... } / { videoUrl... } / { audioUrl... }），因此上层的
 * mutation / 批量 runBatch / 多版本弹窗调用方式零改动。
 *
 * 好处：等待期间请求断开 / 页面刷新不再丢任务（状态在 DB，分镜条件轮询
 * 会接管展示）；不再受平台请求超时约束。
 */

import { formatApiError } from "@/lib/error-copy";

const POLL_INTERVAL_MS = 3000;

/** 各类生成的轮询超时上限（毫秒） */
export const GENERATION_TIMEOUTS = {
  image: 5 * 60 * 1000,
  video: 12 * 60 * 1000,
  tts: 3 * 60 * 1000,
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 连续轮询失败的容忍上限：超过才放弃（网络抖动 / 部署瞬断不应中断轮询） */
export const MAX_POLL_FAILURES = 5;

/** 轮询失败的处置结论：继续等 / 放弃并报 message */
export type PollFailureVerdict =
  | { action: "continue" }
  | { action: "abort"; message: string };

/**
 * 轮询失败容忍策略（生成任务与导出进度共用单一真源）。
 *
 * 判据：网络异常与 5xx 视为瞬时故障，连续 MAX_POLL_FAILURES 次才放弃；
 * 4xx（鉴权失败 / 任务不存在）无重试价值，立即放弃。
 *
 * 之所以必须容忍：后端仍在跑长任务时，前端因一次 fetch 抖动就报错，用户会
 * 以为任务已死而重新发起（导出会二次扣费）。
 *
 * @param consecutiveFailures 计入本次失败后的连续失败次数
 * @param status HTTP 状态码；网络异常（fetch 抛错）传 undefined
 */
export function classifyPollFailure(
  consecutiveFailures: number,
  status?: number
): PollFailureVerdict {
  const isTransient = status === undefined || status >= 500;
  if (!isTransient) {
    return { action: "abort", message: "" };
  }
  if (consecutiveFailures >= MAX_POLL_FAILURES) {
    return {
      action: "abort",
      message:
        status === undefined
          ? "网络异常，无法获取进度，请稍后刷新查看结果"
          : "服务异常，无法获取进度，请稍后刷新查看结果",
    };
  }
  return { action: "continue" };
}

/**
 * 发起生成任务并轮询到终态。
 * COMPLETED → 返回 result（与原同步响应同形）；FAILED / 超时 → 抛中文 Error。
 */
export async function runGenerationTask<T>(
  startUrl: string,
  body: Record<string, unknown>,
  opts: { timeoutMs: number; fallbackError: string }
): Promise<T> {
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) {
    const data = await startRes.json().catch(() => null);
    throw new Error(formatApiError(data, opts.fallbackError));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  const deadline = Date.now() + opts.timeoutMs;
  // 连续轮询请求失败容忍（网络抖动 / 部署瞬断），策略见 classifyPollFailure
  let consecutivePollFailures = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let res: Response;
    try {
      res = await fetch(`/api/generate/tasks/${taskId}`);
    } catch {
      const verdict = classifyPollFailure(++consecutivePollFailures);
      if (verdict.action === "abort") throw new Error(verdict.message);
      continue;
    }

    if (!res.ok) {
      // 5xx 视为瞬时故障继续轮询；4xx（鉴权/任务不存在）立即失败
      const verdict = classifyPollFailure(
        ++consecutivePollFailures,
        res.status
      );
      if (verdict.action === "continue") continue;
      if (verdict.message) throw new Error(verdict.message);
      const data = await res.json().catch(() => null);
      throw new Error(formatApiError(data, opts.fallbackError));
    }
    consecutivePollFailures = 0;

    const data = (await res.json()) as {
      status: string;
      result?: T;
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) return data.result;
    if (data.status === "FAILED") {
      throw new Error(data.error || opts.fallbackError);
    }
    // PENDING / PROCESSING → 继续等
  }
  throw new Error("生成超时，任务可能仍在后台执行，请稍后刷新查看结果");
}
