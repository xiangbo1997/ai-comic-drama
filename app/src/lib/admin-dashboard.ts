/**
 * 后台仪表盘 / 运维页的纯函数助手
 *
 * 这里只放**不碰 IO** 的计算与格式化：成功率折叠、字节/时长人类化、僵尸判定
 * 阈值。放在 lib 而非各自 route 里，是因为同一套口径要同时被
 * `/api/admin/dashboard`（服务端聚合）与 `/admin` 页面（前端展示）使用——
 * 成功率若两端各算一遍，迟早在「PENDING 算不算分母」上漂移。
 */

/** 僵尸阈值：15 分钟无更新仍 PROCESSING/RUNNING 视为已死 */
export const ZOMBIE_THRESHOLD_MS = 15 * 60 * 1000;

/** 运维页僵尸列表单次返回上限（页面是排查入口，不是全量导出） */
export const ZOMBIE_LIST_LIMIT = 50;

/**
 * 僵尸判定的时间切点：早于此刻仍在处理中的任务算僵尸。
 *
 * 抽成函数而非在调用点写 `new Date(Date.now() - X)`，是为了让阈值可测——
 * 传入固定 now 即可断言切点，不必 mock 全局时钟。
 */
export function zombieCutoff(
  now: Date = new Date(),
  thresholdMs: number = ZOMBIE_THRESHOLD_MS
): Date {
  return new Date(now.getTime() - thresholdMs);
}

/** 按天数回溯的时间切点（近 7 天 / 近 30 天统计的起点） */
export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** groupBy(type, status) 的原始行——只取本模块关心的两个维度 */
export interface TaskStatusCount {
  type: string;
  status: string;
  count: number;
}

/** 按任务类型折叠后的成功率统计 */
export interface GenerationTypeStat {
  type: string;
  total: number;
  success: number;
  failed: number;
  /** 成功率，0~1，保留四位小数；total 为 0 时为 0 */
  successRate: number;
}

/**
 * 把 `groupBy(type, status)` 的行折叠成每种类型一行的成功率。
 *
 * 口径：分母是**该类型全部任务**（含 PENDING/PROCESSING），不是「成功+失败」。
 * 理由是这张表要回答「现在有没有在大面积失败」——把在途任务排除出分母会让
 * 刚开始堆积的失败被稀释得看不出来。分子只认 COMPLETED。
 */
export function summarizeGenerationStats(
  rows: TaskStatusCount[]
): GenerationTypeStat[] {
  const byType = new Map<string, GenerationTypeStat>();

  for (const row of rows) {
    const stat = byType.get(row.type) ?? {
      type: row.type,
      total: 0,
      success: 0,
      failed: 0,
      successRate: 0,
    };
    // 不可变更新：Map 里存的对象每轮替换，避免共享引用被后续行意外改写
    const next: GenerationTypeStat = {
      ...stat,
      total: stat.total + row.count,
      success: stat.success + (row.status === "COMPLETED" ? row.count : 0),
      failed: stat.failed + (row.status === "FAILED" ? row.count : 0),
    };
    byType.set(row.type, next);
  }

  return Array.from(byType.values())
    .map((stat) => ({
      ...stat,
      successRate: computeSuccessRate(stat.success, stat.total),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 成功率：success / total，保留四位小数。
 *
 * total 为 0 时返回 0 而非 NaN——「没有任务」在面板上应显示 0%，NaN 会一路
 * 渗到 `toFixed` 变成字面量 "NaN%"。
 */
export function computeSuccessRate(success: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((success / total) * 10000) / 10000;
}

/** 汇总所有类型的整体成功率（仪表盘顶部卡片用） */
export function overallSuccessRate(stats: GenerationTypeStat[]): number {
  const total = stats.reduce((sum, s) => sum + s.total, 0);
  const success = stats.reduce((sum, s) => sum + s.success, 0);
  return computeSuccessRate(success, total);
}

/** 0~1 的比率格式化成百分比文案（默认一位小数） */
export function formatPercent(rate: number, fractionDigits = 1): string {
  return `${(rate * 100).toFixed(fractionDigits)}%`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * 字节数人类化（1024 进制）。
 *
 * null/负数/NaN 一律返回 "-"：调用点的 localUploadsBytes、磁盘容量都可能
 * 因为目录不存在或 statfs 不可用而缺失，让格式化函数吃掉这个分支，页面上
 * 就不必到处写 `?? "-"`。
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // 整数字节不显示小数；进位后保留一位便于比较量级
  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * 进程运行秒数人类化：`3天 4小时 5分钟` / `5分钟 12秒`。
 *
 * 只显示最高的两个量级——运维关心的是「刚重启过吗」，秒级精度在天级 uptime
 * 下毫无信息量，全列反而更难扫读。
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const total = Math.floor(seconds);
  const parts: Array<{ value: number; unit: string }> = [
    { value: Math.floor(total / 86400), unit: "天" },
    { value: Math.floor((total % 86400) / 3600), unit: "小时" },
    { value: Math.floor((total % 3600) / 60), unit: "分钟" },
    { value: total % 60, unit: "秒" },
  ];

  const significant = parts.filter((p) => p.value > 0).slice(0, 2);
  if (significant.length === 0) return "0秒";
  return significant.map((p) => `${p.value}${p.unit}`).join(" ");
}

/**
 * 长文本截断（最近失败的 error 字段）。
 *
 * 服务端就截，不留给前端 CSS 省略：workflow 的 error 是 `@db.Text`，堆栈动辄
 * 数 KB，整条塞进 JSON 响应会把仪表盘的载荷撑大一个量级。
 */
export function truncateText(
  text: string | null | undefined,
  maxLength = 200
): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/** 单日积分流水（订单代理提供的 summary 端点返回项） */
export interface DailyCreditPoint {
  date: string;
  granted: number;
  charged: number;
}

/**
 * 把日流水折算成图表用的相对高度（0~1）。
 *
 * 发放与扣减共用同一基准（两者的最大绝对值），否则两根柱子各自归一化后，
 * 视觉上「发放 10 分」会和「扣减 10000 分」一样高，完全误导。
 */
export function normalizeCreditSeries(
  points: DailyCreditPoint[]
): Array<DailyCreditPoint & { grantedRatio: number; chargedRatio: number }> {
  const peak = points.reduce(
    (max, p) => Math.max(max, Math.abs(p.granted), Math.abs(p.charged)),
    0
  );

  return points.map((p) => ({
    ...p,
    grantedRatio: peak > 0 ? Math.abs(p.granted) / peak : 0,
    chargedRatio: peak > 0 ? Math.abs(p.charged) / peak : 0,
  }));
}
