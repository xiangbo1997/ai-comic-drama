/**
 * 一键 AI 制片人 · 浏览器侧编排客户端（计划 §6 · 3.1）
 *
 * 向导的每一步都调「已有的」端点，本模块只做 fetch 封装 + 轮询，不新增后端逻辑：
 * - createProducerProject：POST /api/projects（复用项目创建）
 * - runDramaScript：POST /api/projects/[id]/drama-script（异步）→ 轮询
 *   /api/script/parse/[id] 至终态，返回脚本产物 + scriptId
 * - createAndLinkCharacter：POST /api/characters 建档（带画像 gender/age/description
 *   + 预填外貌）→ POST /api/projects/[id]/characters 关联。画像（profile）由向导在
 *   建档前一次性 roster 推断后透传，修复原先只传名字导致性别/年龄/人设落 null。
 *
 * 与 assist-client 同风格：读服务端 { error } 转中文提示（formatApiError）。
 */

import { formatApiError } from "@/lib/error-copy";
import { draftAppearance } from "@/lib/assist-client";
import type { AppearanceFormData } from "@/components/appearance-editor";
import type { DramaScriptArtifact } from "@/types";
import { dramaScriptToScenes, scriptToInputText } from "@/lib/drama-to-scenes";
import { normalizeProducerReview } from "@/lib/producer-review";
import type {
  ProducerAction,
  ProducerRunSnapshot,
  ProducerSettings,
} from "@/lib/producer-run";

async function readProducerResponse(
  response: Response
): Promise<ProducerRunSnapshot> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(formatApiError(data, "保存制作进度失败"));
  return data as ProducerRunSnapshot;
}
export async function listProducerRuns(): Promise<ProducerRunSnapshot[]> {
  const response = await fetch("/api/producer-runs", { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      formatApiError(
        await response.json().catch(() => null),
        "读取制作进度失败"
      )
    );
  return response.json();
}
export async function createProducerRun(
  operationId: string,
  settings: ProducerSettings
): Promise<ProducerRunSnapshot> {
  return readProducerResponse(
    await fetch("/api/producer-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId, settings }),
    })
  );
}
export async function getProducerRun(id: string): Promise<ProducerRunSnapshot> {
  return readProducerResponse(
    await fetch(`/api/producer-runs/${encodeURIComponent(id)}`, {
      cache: "no-store",
    })
  );
}
export async function advanceProducerRun(
  id: string,
  action: ProducerAction
): Promise<ProducerRunSnapshot> {
  return readProducerResponse(
    await fetch(`/api/producer-runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    })
  );
}

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
    /** 题材（批 3）：注入脚本 prompt 的题材上下文；未传则服务端回落项目已存题材 */
    genre?: string;
  }
): Promise<DramaScriptResult> {
  const startRes = await fetch(`/api/projects/${projectId}/drama-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, reuseProducerTask: true }),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "生成短剧脚本失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  return pollDramaScriptTask(taskId);
}

/** 已知 taskId 可直接续接轮询；调用者不必再次提交生成。鉴权由状态接口执行。 */
export async function pollDramaScriptTask(
  taskId: string
): Promise<DramaScriptResult> {
  if (!taskId || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) {
    throw new Error("脚本任务编号无效，请进入项目查看已生成的脚本");
  }

  // 长文本生成最多 3 轮，每轮最多 5 分钟；轮询需覆盖后台任务上限。
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 480;
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

/**
 * 同一向导实例的收尾器：POST 分镜成功后记住该事实，最终 PATCH 失败只补保存。
 * 持久脚本任务由服务端幂等恢复；这里的内存状态不冒充跨刷新 checkpoint。
 */
export function createProducerDraftFinalizer() {
  const appliedProjects = new Set<string>();
  const pending = new Map<string, Promise<void>>();

  return function finalize(
    projectId: string,
    artifact: DramaScriptArtifact,
    characterNames: string[],
    genre: string | null,
    checkpoint?: { runId: string; token: string }
  ): Promise<void> {
    const active = pending.get(projectId);
    if (active) return active;

    const run = async () => {
      if (!appliedProjects.has(projectId)) {
        const response = await fetch(`/api/projects/${projectId}/scenes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenes: dramaScriptToScenes(artifact, null, characterNames),
            ...(checkpoint
              ? { operationId: `producer-scenes:${checkpoint.runId}` }
              : {}),
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(formatApiError(error, "生成分镜列表失败"));
        }
        appliedProjects.add(projectId);
      }

      if (checkpoint) {
        await advanceProducerRun(checkpoint.runId, {
          action: "finalize",
          token: checkpoint.token,
        });
        return;
      }

      // 分镜落库可生成逐镜配置，必须重新读取再合并，避免末步擦掉这些字段。
      const currentRes = await fetch(`/api/projects/${projectId}`);
      if (!currentRes.ok)
        throw new Error("读取项目保存状态失败，请重试收尾；已生成分镜保留");
      const project = (await currentRes.json()) as {
        generationParams?: Record<string, unknown> | null;
      };
      const generationParams = project.generationParams ?? {};
      if (
        typeof generationParams !== "object" ||
        Array.isArray(generationParams)
      ) {
        throw new Error("项目生成配置无效，请进入项目检查；已生成分镜保留");
      }
      const producerReview = normalizeProducerReview(
        generationParams.producerReview
      ) ?? {
        createdByProducer: true,
        confirmed: {
          worldview: false,
          script: false,
          characters: [],
          scenes: [],
        },
      };
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: scriptToInputText(artifact),
          generationParams: {
            ...generationParams,
            producerReview,
            ...(genre ? { genre } : {}),
          },
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(
          formatApiError(error, "保存审阅状态失败，请重试收尾；已生成分镜保留")
        );
      }
    };
    const operation = run().finally(() => pending.delete(projectId));
    pending.set(projectId, operation);
    return operation;
  };
}

/** 建档 + 关联 + 外貌预填后的角色摘要（供审阅清单展示） */
export interface ProducerCharacterResult {
  id: string;
  name: string;
  appearance: AppearanceFormData | null;
}

/** 角色摘要（GET /api/characters、GET /api/projects/[id]/characters 共用最小形状） */
interface CharacterSummary {
  id: string;
  name: string;
}

/**
 * 在角色列表里按名精确查重（trim 后逐字比较）。
 *
 * GET 端点是 contains 模糊匹配，故拉取后须在客户端做精确同名匹配，避免把
 * 「林烬」与「林烬阁下」混为一谈。非数组输入（GET 失败降级）安全返回 null。
 */
export function matchCharacterByName(
  list: unknown,
  name: string
): CharacterSummary | null {
  if (!Array.isArray(list)) return null;
  const trimmed = name.trim();
  const hit = (list as CharacterSummary[]).find(
    (c) => c?.name?.trim() === trimmed
  );
  return hit ?? null;
}

/**
 * 幂等护栏：查找该用户已存在的同名角色 id（先查项目已关联，再查用户角色库）。
 *
 * 背景：CREATE→LINK 两步中若 CREATE 成功而 LINK 失败，向导重试会重跑本函数所在
 * 的 createAndLinkCharacter，若无此查重则再次 CREATE，因 characters POST 无同名唯一
 * 约束而产生重复孤儿 Character（LINK 落空的那条）。故 CREATE 前先按名精确查重：
 *  - 命中项目已关联：该名角色已就位，跳过 CREATE 直接返回（LINK 也已完成）。
 *  - 命中用户角色库（可能是上次 LINK 失败遗留的孤儿）：复用其 id，跳过 CREATE 只补 LINK。
 * GET /api/characters?search= 是 contains 模糊匹配，故拉取后在客户端做精确同名匹配。
 * 此处刻意不带 `limit`：查重必须看全量命中，走旧版全量数组形状（types/pagination.ts）。
 */
async function findExistingCharacterId(
  projectId: string,
  name: string
): Promise<{ id: string; linked: boolean } | null> {
  const trimmed = name.trim();

  // 1) 项目已关联角色：命中即已就位（无需再 LINK）
  const linkedRes = await fetch(`/api/projects/${projectId}/characters`);
  if (!linkedRes.ok) {
    throw new Error("查询项目角色失败，请重试；为避免重复建档，尚未创建角色");
  }
  const linked = await linkedRes.json();
  if (!Array.isArray(linked)) throw new Error("项目角色列表无效，请重试");
  const linkedHit = matchCharacterByName(linked, trimmed);
  if (linkedHit) return { id: linkedHit.id, linked: true };

  // 2) 用户角色库：命中即复用其 id（可能是上次 LINK 失败遗留的孤儿），仅需补 LINK
  const listRes = await fetch(
    `/api/characters?search=${encodeURIComponent(trimmed)}`
  );
  if (!listRes.ok) {
    throw new Error("查询角色库失败，请重试；为避免重复建档，尚未创建角色");
  }
  const list = await listRes.json();
  if (!Array.isArray(list)) throw new Error("角色库列表无效，请重试");
  const hit = matchCharacterByName(list, trimmed);
  if (hit) return { id: hit.id, linked: false };

  return null;
}

/**
 * 为项目创建一个角色并预填画像 + 外貌（计划 §4 · 1.2 复用）。
 *
 * 三步：建 Character（带画像 gender/age/description + 外貌若预填成功）→ 关联到项目
 * → 返回摘要。画像（profile）由向导在建档前一次性 roster 推断后透传，据此让外貌预填
 * 的性别/年龄/身份有据可依（修复原先只传名字导致外貌预填瞎猜性别）。
 * 外貌预填走 assist 的 appearance-draft（1 次 LLM/角色），失败不阻断——
 * 角色仍建档，仅外貌留空供用户手填（降级不阻断，交互原则 5）。
 *
 * 幂等：CREATE 前先查重（findExistingCharacterId）。若同名角色已存在（项目已关联或
 * 用户角色库遗留），跳过 CREATE 只做 LINK（LINK 走 upsert，重复关联安全），避免重试
 * 时重复建档产生孤儿 Character。命中已存在分支**不回填画像**，避免覆盖用户手改。
 */
export async function createAndLinkCharacter(
  projectId: string,
  name: string,
  profile?: { gender?: string; age?: string; description?: string }
): Promise<ProducerCharacterResult> {
  // 幂等护栏：命中同名已存在角色则复用，跳过 CREATE（详见 findExistingCharacterId）
  const existing = await findExistingCharacterId(projectId, name);
  if (existing) {
    // 已在项目内则彻底完成；仅在用户库遗留（未关联）时补一次 LINK
    if (!existing.linked) {
      await linkCharacterToProject(projectId, existing.id, name);
    }
    return { id: existing.id, name, appearance: null };
  }

  // 画像三字段：空串不下传（characters 路由 `|| null` 会兜底，但空串会污染语义）
  const gender = profile?.gender?.trim();
  const age = profile?.age?.trim();
  const description = profile?.description?.trim();

  // 先尝试外貌预填（带上画像三字段让性别/年龄/人设有据；失败降级为空外貌，不阻断建档）
  let appearance: AppearanceFormData | null = null;
  try {
    appearance = await draftAppearance({
      name,
      ...(gender ? { gender } : {}),
      ...(age ? { age } : {}),
      ...(description ? { description } : {}),
    });
  } catch {
    appearance = null;
  }

  // 建档：把画像 gender/age/description + 预填外貌一并落库。appearance 的
  // 全部 10 字段（9 文本 + clothingPresets）都会由 characters 路由持久化到
  // CharacterAppearance 表（clothingPresets 存 JSON 列，空则存 []）。
  const createRes = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      producerProjectId: projectId,
      ...(gender ? { gender } : {}),
      ...(age ? { age } : {}),
      ...(description ? { description } : {}),
      ...(appearance ? { appearance } : {}),
    }),
  });
  if (!createRes.ok) {
    const error = await createRes.json().catch(() => null);
    throw new Error(formatApiError(error, `创建角色「${name}」失败`));
  }
  const character = (await createRes.json()) as { id: string; name: string };

  // 关联到项目（LINK 失败时角色已建档：下次重试走查重命中孤儿分支，不再重复 CREATE）
  await linkCharacterToProject(projectId, character.id, name);

  return { id: character.id, name: character.name, appearance };
}

/** 关联角色到项目（LINK 走 upsert，重复关联安全；失败抛中文提示） */
async function linkCharacterToProject(
  projectId: string,
  characterId: string,
  name: string
): Promise<void> {
  const linkRes = await fetch(`/api/projects/${projectId}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId }),
  });
  if (!linkRes.ok) {
    const error = await linkRes.json().catch(() => null);
    throw new Error(formatApiError(error, `关联角色「${name}」到项目失败`));
  }
}
