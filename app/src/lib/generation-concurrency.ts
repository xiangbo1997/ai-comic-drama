/**
 * 生成任务进程级并发闸（2026-07-04）
 *
 * 背景：所有 AI 生成走「POST 建 task → void run() 后台执行」，run() 挂在
 * 单个 systemd node 进程里。此前没有任何跨请求的全局并发上限——唯一的门
 * 是 per-user 限流（且无 Redis 时是每进程内存、重启清零）。N 个用户同时
 * 批量生成 → 数百个并发 run() 各持一条 DB 连接 + 一路外部 AI fetch → 连接
 * 池耗尽 → 正常请求（登录/查询）一起超时 → 单机雪崩。
 *
 * 本模块提供一个零依赖的加权信号量：run() 在进入生成主体前 acquire，
 * 超出上限的任务排队等待（FIFO），完成后 release 唤醒下一个。上限由
 * GENERATION_MAX_CONCURRENCY 控制（默认 8，可用 env 覆盖）。
 *
 * 注意：这是「单进程」闸——多实例部署需换 Redis 分布式信号量。当前部署
 * 是单 node 进程（见项目记忆），单进程闸即可挡住雪崩。
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("lib:generation-concurrency");

const MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.GENERATION_MAX_CONCURRENCY ?? 8)
);

let active = 0;
const waiters: Array<() => void> = [];

/** 等待一个空位（FIFO）。返回后调用方独占一个并发额度，必须最终 release。 */
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

/** 释放一个并发额度并唤醒队首等待者。 */
function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/**
 * 在并发闸内执行生成任务。超出上限时排队等待空位。
 * 无论 fn 成功或抛错都保证 release，不会泄漏额度。
 */
export async function runWithGenerationSlot<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    log.info(
      `生成并发已满（${active}/${MAX_CONCURRENCY}），${label} 进入排队（当前 ${waiters.length} 等待）`
    );
  }
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** 当前并发状态（供 admin/metrics 或调试观测） */
export function getConcurrencyStats() {
  return { active, waiting: waiters.length, max: MAX_CONCURRENCY };
}
