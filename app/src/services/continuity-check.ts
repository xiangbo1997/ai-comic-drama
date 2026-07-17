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
  /** 分镜画面描述（剧情意图上下文）；供 VLM 区分剧情性变化与意外跳变 */
  description?: string | null;
  /** 换装标注（"角色名：服装" 格式化短句）；有值时对应服装变化属剧情需要 */
  outfitNotes?: string[];
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
  /** 前镜 id（连贯性基准）——修复后镜时作为一致性锚图来源 */
  prevSceneId: string;
  dimension: ContinuityDimension;
  severity: ContinuitySeverity;
  description: string;
  fixNote: string;
  /** 相对上一轮的变化状态；首轮体检 / 无可比上轮时缺省 */
  changeStatus?: IssueChangeStatus;
}

/** 综合等级（Toonflow 标尺）；null = 未实际检查任何一对，不给等级 */
export type ContinuityGrade = "A" | "B" | "C" | "D";

/** 问题相对上一轮报告的变化状态：NEW = 新增；PERSISTING = 上轮已报本轮仍在 */
export type IssueChangeStatus = "NEW" | "PERSISTING";

/** 与上一轮报告的对比记账（重新体检时回答「修复到底有没有用」） */
export interface PreviousComparison {
  /** 上轮有、本轮没了（按 镜+维度 桶匹配）→ 视作已解决 */
  resolved: number;
  /** 上轮有、本轮仍在 */
  persisting: number;
  /** 本轮新出现 */
  added: number;
}

/** 体检报告 */
export interface ContinuityReport {
  /**
   * 综合等级 A/B/C/D；当【没有任何一对被成功检查】（全部 skipped）时为 null——
   * 此时报告是「未完成」而非「通过」，前端必须以中性/告警态展示，绝不显示绿色 A。
   * 老数据兼容：历史报告无 null 情形，读取方仍应容忍 grade 为字符串或缺失。
   */
  grade: ContinuityGrade | null;
  /** 一句话总结（含跳过对数记账，若有；全跳过时明确说明体检未完成） */
  summary: string;
  issues: ContinuityReportIssue[];
  /** 成功检查（未跳过）的对数——供前端区分「查过且干净」与「根本没查」 */
  checkedPairs: number;
  /** 因视觉调用失败/降级而跳过的对数 */
  skippedPairs: number;
  /** 与上一轮报告的对比记账；首轮体检 / 上轮未完成时缺省 */
  previousComparison?: PreviousComparison;
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
 * - 诚实报告（核心修复）：若【没有任何一对被成功检查】（全部 skipped），
 *   grade 置 null、summary 明说「体检未完成」，绝不把「0 问题」伪装成绿色 A。
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
        prevSceneId: pair.prevSceneId,
        dimension: issue.dimension,
        severity: issue.severity,
        description: issue.description,
        fixNote: issue.fixNote,
      });
      if (issue.severity === "严重") severeCount += 1;
      else if (issue.severity === "中等") moderateCount += 1;
    }
  }

  const checkedPairs = pairResults.length - skippedCount;

  // 没有任何一对被成功检查（全跳过或空输入）→ 体检未完成，不给等级。
  // 「0 问题」在此不等于「连贯性良好」——是「根本没查」，必须诚实区分。
  if (checkedPairs === 0) {
    return {
      grade: null,
      summary: buildUncheckedSummary(skippedCount),
      issues: [],
      checkedPairs: 0,
      skippedPairs: skippedCount,
    };
  }

  const grade = computeGrade(severeCount, moderateCount);
  const summary = buildSummary({
    grade,
    total: issues.length,
    severeCount,
    moderateCount,
    skippedCount,
  });

  return { grade, summary, issues, checkedPairs, skippedPairs: skippedCount };
}

/** 体检未完成（无一对成功检查）的一句话总结 */
function buildUncheckedSummary(skippedCount: number): string {
  if (skippedCount === 0) {
    // 无对可比（理论上被路由 buildPairList 前置拦截，此处兜底）
    return "体检未完成：没有可比对的相邻分镜。";
  }
  return (
    `体检未完成：${skippedCount} 对相邻分镜的视觉调用全部失败，未能实际检查。` +
    "请确认所用大模型支持图像识别（多模态），且分镜图片可被访问。"
  );
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

/**
 * 与上一轮报告做「前后轮对比记账」，回答重新体检时的核心疑问：修复到底有没有用。
 *
 * 规则：
 * - 无 previous、previous.grade == null（上轮体检未完成）、或 previous.issues 非数组
 *   → 原样返回 current（不加任何标注）。
 * - current.grade == null（本轮体检未完成）→ 同样原样返回。
 * - 匹配粒度 = `sceneId + dimension` 桶计数（同镜同维度可能多条，按数量配对）：
 *   本轮每条落到对应桶，桶内还有余量 → 记 PERSISTING（上轮已报本轮仍在），
 *   桶已耗尽 → 记 NEW（本轮新出现）；上轮桶里未被本轮消耗的余量计入 resolved（已解决）。
 *   不比 description 文本——VLM 每轮措辞会漂移，按 镜+维度 桶最稳。
 *
 * 不可变：返回全新报告对象 + 全新 issues 数组（`{...issue, changeStatus}`），绝不改写入参。
 */
export function diffContinuityReports(
  current: ContinuityReport,
  previous: ContinuityReport | null | undefined
): ContinuityReport {
  // 无可比上轮 / 上轮未完成（grade=null）/ 上轮 issues 结构异常 → 原样返回，不加标注
  if (!previous || previous.grade == null || !Array.isArray(previous.issues)) {
    return current;
  }
  // 本轮体检未完成（无一对成功检查）→ 不做对比，原样返回
  if (current.grade == null) {
    return current;
  }

  // 上一轮的 镜+维度 桶计数（同镜同维度可能多条 → 记数量，按量配对）
  const previousBuckets = new Map<string, number>();
  for (const issue of previous.issues) {
    const key = `${issue.sceneId}::${issue.dimension}`;
    previousBuckets.set(key, (previousBuckets.get(key) ?? 0) + 1);
  }

  let persisting = 0;
  let added = 0;
  const issues: ContinuityReportIssue[] = current.issues.map((issue) => {
    const key = `${issue.sceneId}::${issue.dimension}`;
    const remaining = previousBuckets.get(key) ?? 0;
    if (remaining > 0) {
      // 桶内还有上轮余量 → 配对为「仍存在」，消耗一个
      previousBuckets.set(key, remaining - 1);
      persisting += 1;
      return { ...issue, changeStatus: "PERSISTING" as const };
    }
    // 桶已耗尽 → 本轮新出现
    added += 1;
    return { ...issue, changeStatus: "NEW" as const };
  });

  // 上轮桶里未被本轮消耗的余量 = 已解决
  let resolved = 0;
  for (const remaining of previousBuckets.values()) {
    resolved += remaining;
  }

  return {
    ...current,
    issues,
    previousComparison: { resolved, persisting, added },
  };
}
