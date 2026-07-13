/**
 * 一键 AI 制片人 · 浏览器侧编排客户端（计划 §6 · 3.1）
 *
 * 向导的每一步都调「已有的」端点，本模块只做 fetch 封装 + 轮询，不新增后端逻辑：
 * - createProducerProject：POST /api/projects（复用项目创建）
 * - runDramaScript：POST /api/projects/[id]/drama-script（异步）→ 轮询
 *   /api/script/parse/[id] 至终态，返回脚本产物 + scriptId
 * - createAndLinkCharacter：POST /api/characters 建档 → POST
 *   /api/projects/[id]/characters 关联 → POST /api/assist/appearance-draft 预填外貌
 *
 * 与 assist-client 同风格：读服务端 { error } 转中文提示（formatApiError）。
 */

import { formatApiError } from "@/lib/error-copy";
import { draftAppearance } from "@/lib/assist-client";
import type { AppearanceFormData } from "@/components/appearance-editor";
import type { DramaScriptArtifact } from "@/types";

/** 创建制片人项目：复用 /api/projects，返回 { id }（+ 回填的风格/画幅） */
export async function createProducerProject(body: {
  title: string;
  style: string;
  aspectRatio: string;
}): Promise<{ id: string }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "创建项目失败"));
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

/** 短剧脚本轮询产出：脚本产物 + 落库 id */
export interface DramaScriptResult {
  scriptId: string;
  artifact: DramaScriptArtifact;
}

/**
 * 生成短剧脚本并轮询到终态（计划 §4 · DramaScriptAgent）。
 *
 * POST /api/projects/[id]/drama-script 是异步的（返回 taskId），任务完成后
 * 落 ShortDramaScript，output 里带 scriptId + 完整脚本字段。轮询专用状态接口
 * /api/script/parse/[id] 直至 COMPLETED / FAILED。纯 LLM，不扣积分。
 */
export async function runDramaScript(
  projectId: string,
  body: {
    worldview: string;
    protagonist?: string;
    durationSec?: number;
    aspectRatio?: string;
    style?: string;
  }
): Promise<DramaScriptResult> {
  const startRes = await fetch(`/api/projects/${projectId}/drama-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "生成短剧脚本失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  // 脚本生成约 1 分钟，给足 3 分钟（90 × 2s）
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 90;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`/api/script/parse/${taskId}`);
    if (!pollRes.ok) {
      // 5xx 视为瞬时故障继续轮询；4xx 立即失败
      if (pollRes.status >= 500) continue;
      const error = await pollRes.json().catch(() => null);
      throw new Error(formatApiError(error, "轮询脚本生成状态失败"));
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { scriptId: string } & DramaScriptArtifact;
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) {
      const { scriptId, ...artifact } = data.result;
      return { scriptId, artifact: artifact as DramaScriptArtifact };
    }
    if (data.status === "FAILED") {
      throw new Error(data.error || "生成短剧脚本失败");
    }
  }
  throw new Error("脚本生成超时，任务可能仍在后台执行，请稍后重试");
}

/** 建档 + 关联 + 外貌预填后的角色摘要（供审阅清单展示） */
export interface ProducerCharacterResult {
  id: string;
  name: string;
  appearance: AppearanceFormData | null;
}

/**
 * 为项目创建一个角色并预填外貌（计划 §4 · 1.2 复用）。
 *
 * 三步：建 Character（带外貌若预填成功）→ 关联到项目 → 返回摘要。
 * 外貌预填走 assist 的 appearance-draft（1 次 LLM/角色），失败不阻断——
 * 角色仍建档，仅外貌留空供用户手填（降级不阻断，交互原则 5）。
 */
export async function createAndLinkCharacter(
  projectId: string,
  name: string
): Promise<ProducerCharacterResult> {
  // 先尝试外貌预填（失败降级为空外貌，不阻断建档）
  let appearance: AppearanceFormData | null = null;
  try {
    appearance = await draftAppearance({ name });
  } catch {
    appearance = null;
  }

  // 建档：把预填外貌一并落库（appearance 的 clothingPresets 不进 CharacterAppearance
  // 结构化表，仅 10 字段中的 9 个文本字段落库，与 characters 路由消费一致）
  const createRes = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      ...(appearance ? { appearance } : {}),
    }),
  });
  if (!createRes.ok) {
    const error = await createRes.json().catch(() => null);
    throw new Error(formatApiError(error, `创建角色「${name}」失败`));
  }
  const character = (await createRes.json()) as { id: string; name: string };

  // 关联到项目
  const linkRes = await fetch(`/api/projects/${projectId}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId: character.id }),
  });
  if (!linkRes.ok) {
    const error = await linkRes.json().catch(() => null);
    throw new Error(formatApiError(error, `关联角色「${name}」到项目失败`));
  }

  return { id: character.id, name: character.name, appearance };
}
