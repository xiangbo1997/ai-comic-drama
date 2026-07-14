/**
 * AI 起草辅助前端客户端（批次 1 · 1.1/1.2/1.3）
 *
 * 三条 assist 路由的浏览器侧 fetch 封装，供各页面的 useMutation 复用。
 * 与 characters/components/constants.ts 的风格一致：读取服务端 { error } 转中文提示。
 */

import { formatApiError } from "@/lib/error-copy";
import type { AppearanceFormData } from "@/components/appearance-editor";

/** 世界观起草结果（对齐 worldview-draft 路由 DraftSchema） */
export interface WorldviewDraftResult {
  worldview: string;
  protagonist: string;
  genre: string;
  filmTitle: string;
}

/** 世界观 AI 起草：一句话想法 → 完整世界观四字段 */
export async function draftWorldview(body: {
  idea: string;
  genre?: string;
  seriesContext?: string;
}): Promise<WorldviewDraftResult> {
  const res = await fetch("/api/assist/worldview-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "世界观起草失败"));
  }
  return res.json();
}

/** 角色外貌 10 字段 AI 预填 */
export async function draftAppearance(body: {
  name: string;
  gender?: string;
  age?: string;
  description?: string;
}): Promise<AppearanceFormData> {
  const res = await fetch("/api/assist/appearance-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "外貌预填失败"));
  }
  return res.json();
}

/** 尾帧衔接建议结果（对应 suggest-links 路由 POST 返回） */
export interface LinkSuggestion {
  sceneId: string;
  nextSceneId: string;
  reason: string;
}

export interface SuggestLinksResult {
  suggestions: LinkSuggestion[];
  /** 当前视频模型是否支持首尾帧插值；false 时衔接开启后会回落普通生成 */
  flSupported: boolean;
}

/** 尾帧衔接：AI 建议相邻镜哪些适合开启衔接（计划 §5 · 2.1） */
export async function suggestLinks(
  projectId: string
): Promise<SuggestLinksResult> {
  const res = await fetch(`/api/projects/${projectId}/suggest-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "衔接建议失败"));
  }
  return res.json();
}

/** 批量应用衔接：把指定分镜的 videoLinkNext 置 true，返回更新数量 */
export async function applyLinks(
  projectId: string,
  sceneIds: string[]
): Promise<{ updated: number }> {
  const res = await fetch(`/api/projects/${projectId}/suggest-links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneIds }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "应用衔接失败"));
  }
  return res.json();
}

/** 场景地点合并视图的一行（对应 locations 路由 GET 返回，计划 §5 · 2.2） */
export interface ProjectLocationView {
  /** ProjectLocation 行 id；尚未建行时缺省（需先 describe 建行才能生成锚图） */
  id?: string;
  locationKey: string;
  sceneCount: number;
  description?: string | null;
  imageUrl?: string | null;
}

/** 拉取项目场景地点合并列表 */
export async function fetchLocations(
  projectId: string
): Promise<ProjectLocationView[]> {
  const res = await fetch(`/api/projects/${projectId}/locations`);
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "读取场景地点失败"));
  }
  const data = (await res.json()) as { locations: ProjectLocationView[] };
  return data.locations;
}

/** AI 补全地点/描述（labelMissing=true 时先为未标注分镜指派地点标签） */
export async function describeLocations(
  projectId: string,
  labelMissing: boolean
): Promise<{ labeled: number; described: number }> {
  const res = await fetch(`/api/projects/${projectId}/locations/describe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labelMissing }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "补全地点/描述失败"));
  }
  return res.json();
}

/** 更新地点描述 / 锚图 URL（草稿态审改 + 上传替换回填） */
export async function patchLocation(
  projectId: string,
  locationId: string,
  body: { description?: string | null; imageUrl?: string | null }
): Promise<ProjectLocationView> {
  const res = await fetch(
    `/api/projects/${projectId}/locations/${locationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "更新场景地点失败"));
  }
  const data = (await res.json()) as { location: ProjectLocationView };
  return data.location;
}

/**
 * 生成地点空景板（无人物环境锚图），扣 1 积分。
 *
 * 异步化（对齐三视图）：POST 拿 taskId → 轮询专用状态接口直至终态。
 * COMPLETED → 返回 { imageUrl, cost }；FAILED / 超时 → 抛中文 Error。
 */
export async function generateLocationPlate(
  projectId: string,
  locationId: string,
  options: { imageConfigId?: string } = {}
): Promise<{ imageUrl: string; cost: number }> {
  const base = `/api/projects/${projectId}/locations/${locationId}/generate`;
  const startRes = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "生成场景锚图失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  // 单张生图，给足 5 分钟（150 × 2s）
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 150;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${base}/${taskId}`);
    if (!pollRes.ok) {
      // 5xx 视为瞬时故障继续轮询；4xx 立即失败
      if (pollRes.status >= 500) continue;
      const error = await pollRes.json().catch(() => null);
      throw new Error(formatApiError(error, "轮询场景锚图状态失败"));
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { imageUrl: string; cost: number };
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) return data.result;
    if (data.status === "FAILED")
      throw new Error(data.error || "生成场景锚图失败");
  }
  throw new Error("生成超时，任务可能仍在后台执行，请稍后重新打开查看");
}

/** 连贯性体检报告（对应 continuity-check 路由 output.report，计划 §5 · 2.3） */
export type ContinuityGrade = "A" | "B" | "C" | "D";

export interface ContinuityReportIssue {
  /** 修复目标分镜 id（后镜） */
  sceneId: string;
  /** 后镜序号（1 起） */
  sceneOrder: number;
  dimension: string;
  severity: "严重" | "中等" | "轻微";
  description: string;
  /** 可直接喂给迭代重生成的中文修复指令 */
  fixNote: string;
}

export interface ContinuityReport {
  /**
   * A/B/C/D；全部对因视觉调用失败/降级而跳过时为 null（体检未完成，
   * 前端须以中性/告警态展示，不显示绿色 A）。老数据可能无 null 情形。
   */
  grade: ContinuityGrade | null;
  summary: string;
  issues: ContinuityReportIssue[];
  /** 成功检查（未跳过）的对数；老报告可能缺该字段 */
  checkedPairs?: number;
  /** 因视觉调用失败/降级跳过的对数；老报告可能缺该字段 */
  skippedPairs?: number;
}

/**
 * 触发连贯性体检并轮询到终态（计划 §5 · 2.3）。
 *
 * 异步化（对齐 generateLocationPlate）：POST 拿 taskId → 轮询专用状态接口直至终态。
 * COMPLETED → 返回 report；前置条件不满足（<2 出图 / 视觉不支持）由 POST 直接抛中文 Error。
 * 不扣积分。
 */
export async function runContinuityCheck(
  projectId: string
): Promise<ContinuityReport> {
  const base = `/api/projects/${projectId}/continuity-check`;
  const startRes = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "连贯性体检失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  // 逐对 VLM 调用，镜多时耗时长；给足 8 分钟（240 × 2s）
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 240;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${base}/${taskId}`);
    if (!pollRes.ok) {
      // 5xx 视为瞬时故障继续轮询；4xx 立即失败
      if (pollRes.status >= 500) continue;
      const error = await pollRes.json().catch(() => null);
      throw new Error(formatApiError(error, "轮询体检状态失败"));
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { report: ContinuityReport };
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result?.report) {
      return data.result.report;
    }
    if (data.status === "FAILED") {
      throw new Error(data.error || "连贯性体检失败");
    }
  }
  throw new Error("体检超时，任务可能仍在后台执行，请稍后重试");
}

export type PromptSuggestContext = "character_reference" | "scene_iterate";

/** 提示词 AI 建议：返回 2~3 条中文短句 */
export async function suggestPrompts(body: {
  context: PromptSuggestContext;
  character?: {
    name: string;
    gender?: string;
    age?: string;
    description?: string;
  };
  scene?: {
    description?: string;
    dialogue?: string;
    emotion?: string;
    shotType?: string;
  };
  currentPrompt?: string;
}): Promise<{ suggestions: string[] }> {
  const res = await fetch("/api/assist/prompt-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "提示词建议失败"));
  }
  return res.json();
}
