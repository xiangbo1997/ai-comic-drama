"use client";

/**
 * 每日积分收支柱状图
 *
 * 用纯 div 高度实现，不引图表库：整个后台只有这一处图表，为它拉进
 * recharts/d3 会给首屏包体加上百 KB，而这里要表达的只是「哪天量特别大」。
 *
 * 发放（绿）与扣减（红）共用同一归一化基准（见 normalizeCreditSeries），
 * 两侧各自归一化会让「发 10 分」和「扣 10000 分」画得一样高。
 *
 * 数据源是订单模块的 `/api/admin/credit-transactions/summary`。该端点可能
 * 尚未上线，故取数失败一律**静默降级成空态**而不是把仪表盘整页标红——它是
 * 锦上添花的信息，不该拖垮主指标的可用性。
 */

import {
  formatPercent,
  normalizeCreditSeries,
  type DailyCreditPoint,
} from "@/lib/admin-dashboard";

export interface CreditsChartProps {
  points: DailyCreditPoint[];
  isLoading?: boolean;
  /** 取数失败时的提示；不影响其余区块 */
  error?: string | null;
}

/** 柱体区域高度（px）：够看出差异，又不占满首屏 */
const CHART_HEIGHT = 96;

export function CreditsChart({
  points,
  isLoading = false,
  error = null,
}: CreditsChartProps) {
  if (isLoading) {
    return (
      <div
        className="bg-secondary animate-pulse rounded-lg"
        style={{ height: CHART_HEIGHT + 32 }}
      />
    );
  }

  if (error || points.length === 0) {
    return (
      <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-8 text-center text-xs">
        {error ?? "暂无积分流水数据"}
      </p>
    );
  }

  const series = normalizeCreditSeries(points);
  const totalGranted = points.reduce((sum, p) => sum + p.granted, 0);
  const totalCharged = points.reduce((sum, p) => sum + Math.abs(p.charged), 0);

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-green-500" />
          发放 {totalGranted.toLocaleString()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-destructive h-2 w-2 rounded-sm" />
          消耗 {totalCharged.toLocaleString()}
        </span>
        {totalGranted > 0 && (
          <span>消耗/发放 {formatPercent(totalCharged / totalGranted, 0)}</span>
        )}
      </div>

      <div
        className="flex items-end gap-[2px]"
        style={{ height: CHART_HEIGHT }}
      >
        {series.map((point) => (
          <div
            key={point.date}
            className="group relative flex h-full flex-1 items-end justify-center gap-[1px]"
            // title 承担 tooltip：原生提示零成本，且移动端长按也能触发
            title={`${point.date}　发放 ${point.granted}　消耗 ${Math.abs(point.charged)}`}
          >
            <div
              className="w-1/2 rounded-t-sm bg-green-500/80"
              style={{
                // 有量但比例极小时给 2px 底高，否则视觉上等同于「没有数据」
                height: barHeight(point.grantedRatio, point.granted),
              }}
            />
            <div
              className="bg-destructive/70 w-1/2 rounded-t-sm"
              style={{ height: barHeight(point.chargedRatio, point.charged) }}
            />
          </div>
        ))}
      </div>

      <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/** 比率换算成像素高度；有量必给下限，无量则为 0 */
function barHeight(ratio: number, rawValue: number): number {
  if (rawValue === 0) return 0;
  return Math.max(2, Math.round(ratio * CHART_HEIGHT));
}
