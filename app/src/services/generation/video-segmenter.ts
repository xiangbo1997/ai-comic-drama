/**
 * 视频分段规划器（纯逻辑，全量单测）
 *
 * 把用户设定的分镜时长（1–60s）按模型真实能力拆成 N 段，每段一次视频生成，
 * 再由 orchestrator 链式衔接 + ffmpeg 拼接成单条 videoUrl。
 *
 * 两类模型两套策略：
 * - acceptsDurationParam=false（Veo）：模型忽略请求时长、固定出 ~nativeClipSeconds
 *   秒。段数 = round(requested / nativeClipSeconds)，钳到 [1, maxChainSegments]；
 *   每段不下发 duration。
 * - acceptsDurationParam=true（runway/fal/proxy）：从可请求档位「降序贪心填充」，
 *   累加到 ≥ requested 或触顶 maxChainSegments；每段带上所选档位作 requestDuration。
 *
 * 关键不变量：requested ≤ 单段能力 → 恰好 1 段（严格等价现有单段行为，零回归）。
 *
 * 依赖无（仅本文件类型 + video-capabilities 的纯接口），故客户端组件亦可安全 import
 * `nearestVideoDuration` / `estimateVideoCost`（universal-safe）。
 */

import type { VideoModelCapability } from "@/services/ai/video-capabilities";

/** 单段规划 */
export interface VideoSegmentPlanItem {
  /** 段序号（从 0 起） */
  index: number;
  /** 该段目标时长（秒），用于时轴/进度估算 */
  targetSeconds: number;
  /**
   * 下发给 provider 的 duration 档位；acceptsDurationParam=false 时为 undefined
   * （Veo 忽略请求时长，不下发）。
   */
  requestDuration: number | undefined;
}

/** 整体分段规划 */
export interface VideoSegmentPlan {
  segments: VideoSegmentPlanItem[];
  /** 各段目标时长之和（估算成片总时长，真实值以 ffprobe 为准） */
  estimatedTotalSeconds: number;
}

/** 视频档位积分成本表（与既有 VIDEO_COST 一致，作为唯一真源） */
const TIER_COST: Record<number, number> = {
  5: 10,
  10: 20,
  15: 30,
};

/**
 * Veo 类「无档位」段的计费档：每段（~8s）按 10s 档计 20 积分。
 * 8s 介于 5s 与 10s 之间，按 10s 档收费与「其实生成了近 10s 内容」相符，
 * 避免按 5s 档少收导致成本倒挂。
 */
const TIERLESS_SEGMENT_TIER = 10;

/** 分镜时长的合法上限（秒），与 drama-to-scenes 的 1–60 钳制一致 */
export const MAX_SCENE_DURATION = 60;
/** 分镜时长的合法下限（秒） */
export const MIN_SCENE_DURATION = 1;

/**
 * 把任意秒数钳制为合法整数分镜时长（1–60）。
 * 服务端路由与客户端输入共用，杜绝越界值直达规划器/DB。
 */
export function clampSceneDuration(seconds: unknown): number {
  const n = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(n)) return MIN_SCENE_DURATION;
  const rounded = Math.round(n);
  return Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, rounded));
}

/**
 * 把精确秒数「就近」映射到给定档位（真-nearest，非阈值式）。
 * 统一替换此前两处分歧实现（客户端阈值式 vs workflow reduce）——两者在 6–7s
 * 处结论不同。全项目改为引用本函数，消除漂移。
 *
 * @param seconds 目标秒数
 * @param tiers 可选档位（升序或乱序均可）；缺省 [5,10,15]
 * @returns 与 seconds 差绝对值最小的档位；空档位数组回落 5
 */
export function nearestVideoDuration(
  seconds: number | undefined,
  tiers: readonly number[] = [5, 10, 15]
): number {
  const d = typeof seconds === "number" && seconds > 0 ? seconds : 5;
  if (tiers.length === 0) return 5;
  return tiers.reduce((best, tier) =>
    Math.abs(tier - d) < Math.abs(best - d) ? tier : best
  );
}

/**
 * 规划分段。
 *
 * @param requestedSeconds 用户设定的分镜时长（未钳制亦可，内部会钳到 1–60）
 * @param cap 目标模型能力
 * @returns 分段计划（至少 1 段）
 */
export function planVideoSegments(
  requestedSeconds: number,
  cap: VideoModelCapability
): VideoSegmentPlan {
  const requested = clampSceneDuration(requestedSeconds);
  const maxSegments = Math.max(1, cap.maxChainSegments);

  // ── 分支 A：模型忽略 duration（Veo）——按原生片段长度切段 ──
  if (!cap.acceptsDurationParam) {
    const native = cap.nativeClipSeconds > 0 ? cap.nativeClipSeconds : 8;
    // 段数 = round(requested / native)，至少 1 段，最多 maxSegments。
    // requested ≤ native → round ≤ 1（如 3/8=0.375→0，被 max(1) 提到 1 段）=零回归。
    const rawCount = Math.round(requested / native);
    const count = Math.min(maxSegments, Math.max(1, rawCount));
    const segments: VideoSegmentPlanItem[] = Array.from(
      { length: count },
      (_, index) => ({
        index,
        targetSeconds: native,
        requestDuration: undefined,
      })
    );
    return {
      segments,
      estimatedTotalSeconds: native * count,
    };
  }

  // ── 分支 B：模型接受 duration——降序贪心填充档位 ──
  const tiers = [...cap.requestableDurations].sort((a, b) => b - a);
  // 无可请求档位（配置异常）→ 回落单段，时长取原生片段长度
  if (tiers.length === 0) {
    return {
      segments: [
        {
          index: 0,
          targetSeconds: cap.nativeClipSeconds,
          requestDuration: undefined,
        },
      ],
      estimatedTotalSeconds: cap.nativeClipSeconds,
    };
  }

  const maxTier = tiers[0];

  // requested ≤ 最大单档：就近选 1 个档位（零回归——如 7s→[10]、3s→[5]）
  if (requested <= maxTier) {
    const tier = nearestVideoDuration(requested, tiers);
    return {
      segments: [{ index: 0, targetSeconds: tier, requestDuration: tier }],
      estimatedTotalSeconds: tier,
    };
  }

  // requested > 最大单档：降序贪心用最大档铺满，累计 ≥ requested 或触顶即止
  const segments: VideoSegmentPlanItem[] = [];
  let accumulated = 0;
  let index = 0;
  while (accumulated < requested && index < maxSegments) {
    const remaining = requested - accumulated;
    // 剩余量 ≥ 最大档就用最大档；否则用「刚好覆盖剩余量」的就近档，避免尾段过长
    const tier =
      remaining >= maxTier ? maxTier : nearestVideoDuration(remaining, tiers);
    segments.push({ index, targetSeconds: tier, requestDuration: tier });
    accumulated += tier;
    index += 1;
  }

  return {
    segments,
    estimatedTotalSeconds: accumulated,
  };
}

/**
 * 单档位成本（积分）。无匹配档位（Veo 无档位段）按 10s 档计。
 */
function tierCost(tier: number | undefined): number {
  if (tier === undefined) return TIER_COST[TIERLESS_SEGMENT_TIER];
  return TIER_COST[tier] ?? TIER_COST[TIERLESS_SEGMENT_TIER];
}

/**
 * 估算分段生成总成本（积分）= 各段档位成本之和。
 * 服务端计费与客户端成本预览共用，保证「预览成本 = 实扣成本」。
 *
 * @param requestedSeconds 分镜时长
 * @param cap 模型能力
 * @returns 总积分成本
 */
export function estimateVideoCost(
  requestedSeconds: number,
  cap: VideoModelCapability
): number {
  const plan = planVideoSegments(requestedSeconds, cap);
  return plan.segments.reduce(
    (sum, seg) => sum + tierCost(seg.requestDuration),
    0
  );
}
