/**
 * AI 场记（视觉连贯性体检）的纯逻辑（计划 §5 · 2.3）
 *
 * 拆成两段职责，均为纯函数，供 continuity-check 路由与单测复用（与 suggest-links.ts 同构）：
 * 1. buildPairList —— 已出图分镜按 order 升序两两配对（相邻对）；只保留【两侧都有 imageUrl】
 *    的对，跳过空图缺口（缺口两侧不相邻，不做跨缺口对比）。
 * 2. assembleContinuityReport —— 把每对的问题清单摊平（每条 issue 挂到【后镜】——即修复目标），
 *    按 Toonflow 评级标尺算 A/B/C/D 综合等级，产出一句话总结 + 逐条问题清单。
 *
 * 连贯性体检语义：VLM 对相邻镜图片对比 角色服装/发型/环境/光线/色调 是否跳变，
 * 每个问题带「可直接喂给迭代重生成的中文 fixNote」。修复走已有的 iterate+note 迭代生成机制。
 */

/** 参与体检的单个分镜（仅取配对需要的字段） */
export interface ContinuityScene {
  id: string;
  order: number;
  imageUrl?: string | null;
  /** 地点短标签（同物理地点共用同值）；供 VLM 判断「环境背景」维度是否算问题 */
  locationKey?: string | null;
  /** 该镜出场角色名（供 VLM 对齐「服装/发型」维度的对象） */
  characterNames?: string[];
}

/** 一对相邻已出图分镜（前镜 prev、后镜 next） */
export interface ContinuityPair {
  prev: ContinuityScene;
  next: ContinuityScene;
}

/** VLM 可检查的连贯性维度 */
export type ContinuityDimension =
  | "角色服装"
  | "发型"
  | "环境背景"
  | "光线"
  | "色调";

/** 问题严重度（Toonflow 三档） */
export type ContinuitySeverity = "严重" | "中等" | "轻微";

/** VLM 对单对相邻镜返回的单条问题 */
export interface ContinuityPairIssue {
  dimension: ContinuityDimension;
  severity: ContinuitySeverity;
  /** 问题描述（≤60 字） */
  description: string;
  /** 可直接喂给迭代重生成的中文修复指令（≤40 字） */
  fixNote: string;
}

/** 单对相邻镜的 VLM 检查结果（跳过的对以 skipped 记账，不静默截断） */
export interface ContinuityPairResult {
  prevSceneId: string;
  nextSceneId: string;
  /** 后镜序号（1 起），供报告展示「镜 N」；修复目标即后镜 */
  nextSceneOrder: number;
  /** VLM 未能检查此对（视觉调用失败 / 降级）→ true，issues 为空 */
  skipped: boolean;
  issues: ContinuityPairIssue[];
}

/** 报告中的一条问题（已挂到后镜，即修复目标） */
export interface ContinuityReportIssue {
  sceneId: string;
  sceneOrder: number;
  dimension: ContinuityDimension;
  severity: ContinuitySeverity;
  description: string;
  fixNote: string;
}

/** 综合等级（Toonflow 标尺） */
export type ContinuityGrade = "A" | "B" | "C" | "D";

/** 体检报告 */
export interface ContinuityReport {
  grade: ContinuityGrade;
  /** 一句话总结（含跳过对数记账，若有） */
  summary: string;
  issues: ContinuityReportIssue[];
}

/**
 * 已出图分镜两两配对（相邻对）。
 *
 * 规则（按 order 升序）：
 * - 只保留【前后镜都有 imageUrl】的相邻对；任一侧缺图 → 该对跳过（缺口两侧不相邻）。
 * - 少于 2 张已出图 → 返回空数组（无从对比）。
 *
 * 输入无需预排序：内部按 order 升序后再配对。
 */
export function buildPairList(scenes: ContinuityScene[]): ContinuityPair[] {
  const withImage = scenes.filter((s) => Boolean(s.imageUrl));
  if (withImage.length < 2) return [];

  const ordered = [...withImage].sort((a, b) => a.order - b.order);
  const pairs: ContinuityPair[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    pairs.push({ prev: ordered[i], next: ordered[i + 1] });
  }
  return pairs;
}

/**
 * Toonflow 评级标尺：按严重/中等问题数量定 A/B/C/D。
 * - A：0 严重 且 ≤2 中等
 * - B：0 严重 且 ≤5 中等
 * - C：1–2 严重
 * - D：≥3 严重
 *
 * 说明：轻微问题不参与降级（仅作提示）；中等数量只在无严重时决定 A/B。
 */
function computeGrade(
  severeCount: number,
  moderateCount: number
): ContinuityGrade {
  if (severeCount >= 3) return "D";
  if (severeCount >= 1) return "C";
  // 无严重问题：按中等数量分 A/B
  if (moderateCount <= 2) return "A";
  if (moderateCount <= 5) return "B";
  // 无严重但中等 >5：视觉连贯性问题偏多，降到 C
  return "C";
}

/**
 * 汇总各对 VLM 结果为一份体检报告。
 *
 * - 每条 issue 挂到【后镜】的 sceneId/order（迭代重生成的修复目标）。
 * - 综合等级按严重/中等问题数量算（computeGrade）。
 * - 跳过的对（视觉调用失败）计数并写进 summary，不静默丢弃。
 */
export function assembleContinuityReport(
  pairResults: ContinuityPairResult[]
): ContinuityReport {
  const issues: ContinuityReportIssue[] = [];
  let severeCount = 0;
  let moderateCount = 0;
  let skippedCount = 0;

  for (const pair of pairResults) {
    if (pair.skipped) {
      skippedCount += 1;
      continue;
    }
    for (const issue of pair.issues) {
      issues.push({
        sceneId: pair.nextSceneId,
        sceneOrder: pair.nextSceneOrder,
        dimension: issue.dimension,
        severity: issue.severity,
        description: issue.description,
        fixNote: issue.fixNote,
      });
      if (issue.severity === "严重") severeCount += 1;
      else if (issue.severity === "中等") moderateCount += 1;
    }
  }

  const grade = computeGrade(severeCount, moderateCount);
  const summary = buildSummary({
    grade,
    total: issues.length,
    severeCount,
    moderateCount,
    skippedCount,
  });

  return { grade, summary, issues };
}

/** 一句话总结：等级 + 问题数量 + 跳过对记账 */
function buildSummary(p: {
  grade: ContinuityGrade;
  total: number;
  severeCount: number;
  moderateCount: number;
  skippedCount: number;
}): string {
  const skipTail =
    p.skippedCount > 0
      ? `（另有 ${p.skippedCount} 对因视觉调用失败未检查）`
      : "";

  if (p.total === 0) {
    return `连贯性良好，未发现明显跳变${skipTail}`;
  }

  const parts: string[] = [];
  if (p.severeCount > 0) parts.push(`${p.severeCount} 处严重`);
  if (p.moderateCount > 0) parts.push(`${p.moderateCount} 处中等`);
  const lightCount = p.total - p.severeCount - p.moderateCount;
  if (lightCount > 0) parts.push(`${lightCount} 处轻微`);

  return `评级 ${p.grade}，共 ${p.total} 处连贯性问题（${parts.join("、")}）${skipTail}`;
}
