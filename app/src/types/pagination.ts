/**
 * 列表游标分页的共享契约与纯解析助手。
 *
 * 契约对齐 `GET /api/user/credit-transactions`：`?cursor=<id>&limit=<n>`
 * → `{ items, nextCursor }`，`nextCursor` 为 null 表示没有下一页。
 *
 * 向后兼容（重要）：`/api/projects` 与 `/api/characters` 早于分页存在，
 * 站内外仍有直接消费「裸数组」的调用方。故约定：
 *  - **不带 `limit` 查询参数** → 返回旧版全量裸数组（形状完全不变，零回归）；
 *  - **带 `limit` 查询参数** → 返回 `{ items, nextCursor }` 分页对象。
 * 新代码一律显式传 `limit`；老调用方不改也不会坏。
 */

/** 游标分页响应（带 `limit` 时的形状） */
export interface CursorPage<T> {
  items: T[];
  /** 下一页游标（末条记录 id）；null = 已到末页 */
  nextCursor: string | null;
}

/** 单页默认条数（`limit` 存在但非法时的回落值） */
export const DEFAULT_PAGE_SIZE = 50;

/** 单页上限：防止调用方用超大 limit 把全表一次性拖出来 */
export const MAX_PAGE_SIZE = 100;

/**
 * 解析并夹紧 `limit` 查询参数。
 *
 * @param raw `searchParams.get("limit")`，未传为 null
 * @returns null 表示调用方未请求分页（走旧版全量数组）；
 *          否则返回 1..MAX_PAGE_SIZE 之间的整数。
 *          存在但非法（非数字 / ≤0 / 小数）时回落 DEFAULT_PAGE_SIZE。
 */
export function parsePageLimit(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_PAGE_SIZE;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

/**
 * 归一化游标：空串 / 纯空白视为无游标（首页）。
 * 避免 `?cursor=` 这种空值被当成真实 id 传进 Prisma 导致查询报错。
 */
export function parseCursor(raw: string | null): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 从「多取一条」的结果切出当前页 + 下一页游标。
 *
 * @param rows 用 `take: limit + 1` 查出的行（多出的那条仅用于探测是否还有下一页）
 * @param limit 当前页请求条数
 */
export function sliceCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}
