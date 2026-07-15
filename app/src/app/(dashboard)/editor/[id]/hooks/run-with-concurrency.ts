/**
 * 有界并发执行池（纯函数，无副作用）
 *
 * 存在原因：多版本生成的 PARALLEL 分支此前用 Promise.allSettled 无界并发，
 * 用户在偏好里设的 maxConcurrent 完全没被遵守——选 10 个配置就并发打 10 个
 * 上游请求，可能触发限流/超额。这里实现「同时最多 limit 个在飞」的调度：
 * 一个任务完成立刻拉起下一个，全部完成后 resolve。
 *
 * 语义对齐 Promise.allSettled：
 *   - 单个任务抛错不中断其余任务（内部 catch 吞掉，池继续排空）；
 *   - 返回 Promise 恒 resolve（无 reject），调用方无需 try/catch 包裹整体。
 */

/**
 * 以最多 `limit` 的并发度执行一组任务工厂。
 *
 * @param tasks 任务工厂数组；每项调用时才启动（惰性），保证不会一次性全部起飞
 * @param limit 最大并发数；<1 时收敛为 1（至少串行执行，避免死锁）
 */
export async function runWithConcurrency(
  tasks: Array<() => Promise<unknown>>,
  limit: number
): Promise<void> {
  if (tasks.length === 0) return;

  // 并发上限至少为 1：非法入参（0/负数/NaN）退化为串行，绝不阻塞
  const safeLimit =
    Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const effectiveLimit = Math.min(safeLimit, tasks.length);

  let nextIndex = 0;

  // 单个 worker：不断领取下一个任务直到取尽；任务异常在此吞掉（不中断池）
  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      try {
        await tasks[current]();
      } catch {
        // 与 Promise.allSettled 一致：单任务失败不影响其余任务继续执行
      }
    }
  };

  // 启动 effectiveLimit 个 worker 并行排空任务队列
  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
}
