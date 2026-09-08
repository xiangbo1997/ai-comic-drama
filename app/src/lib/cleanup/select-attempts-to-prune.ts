/**
 * GenerationAttempt 裁剪的纯选择逻辑（无 DB / 存储依赖）
 *
 * 单独成文件是为了可单测：同目录的 attempt-retention.ts 在模块顶层 import
 * prisma（构造时即要求 DATABASE_URL），测试进程里没有真库，导入即炸。
 * 规则本身是纯函数，与 IO 分离后既好测也好复用。
 */

/** 供 selectAttemptsToPrune 判断的最小 attempt 形状 */
export interface PrunableAttempt {
  id: string;
  createdAt: Date;
  isCurrent: boolean;
  outputUrl: string | null;
}

/**
 * 给定某分镜的全部 attempt，算出应删除哪些。
 *
 * 规则：isCurrent=true 的版本无论多老都进保留集（删掉会让分镜「当前版本」
 * 从历史列表消失），再按 createdAt 降序补足到 keepPerScene 条，其余全删。
 * 返回按 createdAt 升序（从旧到新）的待删列表，便于日志与分批。
 */
export function selectAttemptsToPrune(
  attempts: PrunableAttempt[],
  keepPerScene: number
): PrunableAttempt[] {
  if (keepPerScene < 0) return [];

  // 最新在前排序（createdAt 相同则按 id 升序，保证结果确定可复现）
  const sorted = [...attempts].sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const keep = new Set<string>();
  for (const a of sorted) {
    if (a.isCurrent) keep.add(a.id);
  }
  for (const a of sorted) {
    if (keep.size >= keepPerScene && !keep.has(a.id)) break;
    keep.add(a.id);
  }

  return sorted.filter((a) => !keep.has(a.id)).reverse();
}
