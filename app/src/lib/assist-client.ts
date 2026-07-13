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
