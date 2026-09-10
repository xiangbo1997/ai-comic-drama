/**
 * runClosedLoop — 通用 ReAct 闭环执行器 (P3.5)
 *
 * 从 image-consistency-agent.ts 的 generate→observe→reflect→regenerate 循环抽象而来，
 * 让"角色一致性 / 角色圣经 / 叙事连贯 / 视频连贯"四个闭环复用同一套自纠错逻辑。
 *
 * 这是项目"优秀 agent 模式"的核心基础设施：一个干净、可复用的 ReAct / Evaluator-Optimizer
 * 闭环 —— 生成候选 → 评估打分 → 不达标则带记忆反思优化 → 重生成，直到通过或用尽轮次。
 *
 * 保留的不变量（与原 ImageConsistencyAgent 循环一致）：
 * - bestResult/bestScore：始终保留历史最高分结果，用尽轮次时返回最优而非最后一次
 * - 防死循环：round 上界 = maxRounds + 1（首轮不计 reflection）
 * - retryable 短路：verdict.retryable === false 立即停止
 * - catch 容错：任何一轮异常都 break，不抛出
 * - 评估失败降级：evaluate 抛出/返回 null 时接受当前候选
 * - history 跨轮记忆：每轮的 verdict 累积传给 reflect，支持"避免重复犯错"
 */

import type { SystemConfigKey } from "@/lib/system-config";
import type {
  ClosedLoopPolicy,
  ObserverVerdict,
  WorkflowContext,
  WorkflowStep,
} from "./types";

/**
 * 四闭环默认策略 (P3.5)。
 *
 * `enabled` 的取值依据「额外 LLM 调用数 × 用户感知延迟」（审计 D3）：
 * - imageConsistency：一直默认开（行为不变）。
 * - characterBible：评分函数 reviewCharacterBible 是【纯函数】，零 LLM 调用、零积分；
 *   只有评分不达标才重生成圣经（上界 maxRounds=2）。成本≈0，故默认开。
 * - storyboard：已改为【真闭环】（评审不达标即带六维评语回注 prompt 重生成整套分镜，
 *   见 workflow/steps/review.ts）。成本 = 每轮 1 次纯文本 LLM 调用，相对后续几十张图 +
 *   几十段视频可忽略；而一份「开场铺垫、旁白复述心理、结尾把故事讲完」的分镜会让
 *   后面所有生成开销全部白费。性价比反转，故默认开，maxRounds=1（一次修订够用，控时延）。
 * - videoCoherence：仍【只评分不重生成】，且评审是多模态调用（成本量级不同），
 *   用户多等数秒只换来一条评分记录，故默认关。
 *
 * 四项中除 imageConsistency 外均可被系统配置覆盖（见 CLOSED_LOOP_* 键），不必改代码即可开关。
 */
export const DEFAULT_CLOSED_LOOP_POLICIES = {
  imageConsistency: { enabled: true, maxRounds: 3, passThreshold: 75 },
  characterBible: { enabled: true, maxRounds: 2, passThreshold: 70 },
  storyboard: { enabled: true, maxRounds: 1, passThreshold: 70 },
  videoCoherence: { enabled: false, maxRounds: 1, passThreshold: 60 },
} as const satisfies Record<string, ClosedLoopPolicy>;

export type ClosedLoopName = keyof typeof DEFAULT_CLOSED_LOOP_POLICIES;

/** 闭环 → 系统配置键（imageConsistency 无开关：一直开，行为不变） */
const POLICY_CONFIG_KEY: Partial<Record<ClosedLoopName, SystemConfigKey>> = {
  characterBible: "CLOSED_LOOP_CHARACTER_BIBLE",
  storyboard: "CLOSED_LOOP_STORYBOARD",
  videoCoherence: "CLOSED_LOOP_VIDEO_COHERENCE",
};

/**
 * 解析某闭环的最终策略（同步版，不读系统配置）。
 * 优先级：config.closedLoops[name] > 默认值。
 * 对 imageConsistency 额外兼容旧字段 maxImageReflectionRounds。
 */
export function resolvePolicy(
  ctx: WorkflowContext,
  name: ClosedLoopName
): ClosedLoopPolicy {
  const fromConfig = ctx.config.closedLoops?.[name];
  if (fromConfig) return fromConfig;

  const base = DEFAULT_CLOSED_LOOP_POLICIES[name];
  if (name === "imageConsistency") {
    return { ...base, maxRounds: ctx.config.maxImageReflectionRounds };
  }
  return base;
}

/**
 * 解析某闭环的最终策略（异步版，含系统配置开关）。
 *
 * 优先级：ctx.config.closedLoops[name]（项目级显式策略，最高）
 *       > SystemConfig 的 CLOSED_LOOP_* 开关（运维级）
 *       > DEFAULT_CLOSED_LOOP_POLICIES（代码默认）。
 *
 * 项目级策略优先于运维开关：调用方显式传了策略就是显式意图，不该被全局开关反悔。
 * 读配置失败时 getSystemConfig 自身回落默认值，故本函数不会因 DB 抖动抛错。
 */
export async function resolvePolicyAsync(
  ctx: WorkflowContext,
  name: ClosedLoopName
): Promise<ClosedLoopPolicy> {
  const fromConfig = ctx.config.closedLoops?.[name];
  if (fromConfig) return fromConfig;

  const base = resolvePolicy(ctx, name);
  const key = POLICY_CONFIG_KEY[name];
  if (!key) return base;

  // 动态 import：本文件是纯编排逻辑，静态引入 system-config 会把 lib/prisma
  // （模块加载即要求 DATABASE_URL）拖进所有引用者的依赖图，让纯逻辑单测也必须备 DB。
  const { getSystemConfig } = await import("@/lib/system-config");
  const enabled = await getSystemConfig(key);
  return { ...base, enabled: Boolean(enabled) };
}

/** 单轮记录，累积构成跨轮记忆 */
export interface LoopRound<TOutput> {
  round: number;
  candidate: TOutput;
  verdict: ObserverVerdict;
}

export interface ClosedLoopConfig<TState, TOutput> {
  /** 初始状态（如 prompt 字符串、待细化的草稿对象） */
  initialState: TState;

  /** 生成候选：首轮 history 为空；重试轮带历史 */
  generate: (
    state: TState,
    history: LoopRound<TOutput>[],
    ctx: WorkflowContext
  ) => Promise<TOutput>;

  /**
   * 评估候选，返回 ObserverVerdict。
   * 抛出或返回 null 视为"无法评估"，调用方据 acceptOnEvalFailure 决定是否接受。
   */
  evaluate: (
    candidate: TOutput,
    state: TState,
    ctx: WorkflowContext
  ) => Promise<ObserverVerdict | null>;

  /** 反思：据 verdict + 历史更新 state，供下一轮 generate */
  reflect: (
    state: TState,
    verdict: ObserverVerdict,
    history: LoopRound<TOutput>[],
    ctx: WorkflowContext
  ) => Promise<TState>;

  /** 最大反思轮次（不含首轮）。实际生成次数上界 = maxRounds + 1 */
  maxRounds: number;

  /** SSE 事件用的步骤标识 */
  workflowStep: WorkflowStep;
  /** 任务描述（日志/事件消息） */
  taskLabel: string;

  /** 评估失败时是否接受当前候选（默认 true，保持原 Observer 不可用即放行的行为） */
  acceptOnEvalFailure?: boolean;

  /** 每轮回调（SSE 推送等） */
  onRound?: (round: LoopRound<TOutput>, ctx: WorkflowContext) => void;
}

export interface ClosedLoopResult<TOutput> {
  /** 历史最优候选；从未成功生成时为 null */
  best: TOutput | null;
  bestScore: number;
  /** 实际执行的轮数 */
  rounds: number;
  /** 是否有任意一轮通过质量门 */
  passed: boolean;
  history: LoopRound<TOutput>[];
}

/**
 * 执行闭环。纯编排逻辑，不耦合任何具体生成/评估实现。
 */
export async function runClosedLoop<TState, TOutput>(
  config: ClosedLoopConfig<TState, TOutput>,
  ctx: WorkflowContext
): Promise<ClosedLoopResult<TOutput>> {
  const acceptOnEvalFailure = config.acceptOnEvalFailure ?? true;
  const history: LoopRound<TOutput>[] = [];

  let state = config.initialState;
  let best: TOutput | null = null;
  let bestScore = -1;
  let passed = false;
  let executedRounds = 0;

  for (let round = 1; round <= config.maxRounds + 1; round++) {
    executedRounds = round;

    ctx.emit({
      type: round === 1 ? "step:started" : "agent:reflection",
      workflowRunId: ctx.workflowRunId,
      step: config.workflowStep,
      data: {
        round,
        message:
          round === 1
            ? `${config.taskLabel}...`
            : `质量不达标，正在优化（第 ${round} 次）...`,
      },
      timestamp: new Date(),
    });

    try {
      const candidate = await config.generate(state, history, ctx);

      const verdict = await config.evaluate(candidate, state, ctx);

      // 评估不可用：按策略接受当前候选并结束
      if (!verdict) {
        if (acceptOnEvalFailure) {
          best = candidate;
          bestScore = bestScore < 0 ? 0 : bestScore;
          passed = true;
          break;
        }
        break;
      }

      const roundRecord: LoopRound<TOutput> = { round, candidate, verdict };
      history.push(roundRecord);
      config.onRound?.(roundRecord, ctx);

      // 保留历史最优
      if (verdict.score.overall > bestScore) {
        bestScore = verdict.score.overall;
        best = candidate;
      }

      // 通过质量门
      if (verdict.pass) {
        passed = true;
        break;
      }

      // 不可重试 / 已到末轮
      if (!verdict.retryable || round > config.maxRounds) {
        break;
      }

      // 反思优化，进入下一轮
      state = await config.reflect(state, verdict, history, ctx);
    } catch {
      // 任何异常都停止循环，返回已有最优
      break;
    }
  }

  return { best, bestScore, rounds: executedRounds, passed, history };
}
