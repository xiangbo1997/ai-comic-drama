import type { CharacterListItem, Tag } from "@/types";
import { formatApiError } from "@/lib/error-copy";

export const VOICE_PRESETS = [
  {
    id: "zh_female_shuangkuaisisi_moon_bigtts",
    name: "甜美女声",
    gender: "female",
    provider: "volcano",
  },
  {
    id: "zh_female_tianmeixiaoyuan_moon_bigtts",
    name: "温柔女声",
    gender: "female",
    provider: "volcano",
  },
  {
    id: "zh_male_chunhou_moon_bigtts",
    name: "磁性男声",
    gender: "male",
    provider: "volcano",
  },
  {
    id: "zh_male_yangguang_moon_bigtts",
    name: "阳光男声",
    gender: "male",
    provider: "volcano",
  },
  {
    id: "zh_female_linjie_moon_bigtts",
    name: "知性女声",
    gender: "female",
    provider: "volcano",
  },
  {
    id: "zh_male_wennuanahu_moon_bigtts",
    name: "温暖男声",
    gender: "male",
    provider: "volcano",
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  style: "风格",
  gender: "性别",
  role: "角色类型",
  other: "其他",
};

export type CharacterFormData = {
  name: string;
  gender: string;
  age: string;
  description: string;
  voiceId: string;
  voiceProvider: string;
  tagIds: string[];
  appearance: import("@/components/appearance-editor").AppearanceFormData;
};

export type GenerateOptions = {
  source: "none" | "upload" | "existing";
  customPrompt: string;
  uploadedImage: string | null;
  imageConfigId?: string;
  /** 多候选抽卡档位（1 / 2 / 4，缺省 1）批次 2 · 1.4B */
  count?: 1 | 2 | 4;
};

export async function fetchCharacters(): Promise<CharacterListItem[]> {
  const res = await fetch("/api/characters");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("获取角色列表失败");
  }
  return res.json();
}

// 以下助手统一：读取服务端 { error }（经 formatApiError 转中文），
// 不再抛硬编码英文串（此前 "Failed to create character" 直达 toast）

export async function createCharacter(data: Record<string, unknown>) {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "创建角色失败"));
  }
  return res.json();
}

export async function updateCharacter(
  id: string,
  data: Record<string, unknown>
) {
  const res = await fetch(`/api/characters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "保存角色失败"));
  }
  return res.json();
}

export async function deleteCharacter(id: string) {
  const res = await fetch(`/api/characters/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "删除角色失败"));
  }
  return res.json();
}

/** 角色被项目/分镜引用的数量——删除前告知级联后果用 */
export async function fetchCharacterUsage(
  id: string
): Promise<{ projectCount: number; sceneCount: number }> {
  const res = await fetch(`/api/characters/${id}/usage`);
  if (!res.ok) throw new Error("获取角色使用情况失败");
  return res.json();
}

/** 参考图候选（多候选抽卡回传） */
export interface ReferenceCandidate {
  imageUrl: string;
  /** VLM 择优分数（0–100）；视觉不可用时 null */
  vlmScore: number | null;
  /** 是否为推荐张（分数最高） */
  recommended: boolean;
}

/**
 * 生成角色参考图（批次 2 · 1.4B：多候选抽卡 + VLM 择优）。
 *
 * 异步化：POST 拿 taskId → 轮询任务状态，返回候选列表（不直接入库）。
 * 用户在画廊点选一张后调 selectReference 入库。count 默认 1（零回归）。
 */
export async function generateReference(
  id: string,
  options: {
    baseImage?: string;
    customPrompt?: string;
    useExistingImage?: boolean;
    existingImageIndex?: number;
    imageConfigId?: string;
    /** 多候选档位 1 / 2 / 4，缺省 1 */
    count?: number;
  } = {}
): Promise<{ candidates: ReferenceCandidate[]; cost: number }> {
  const startRes = await fetch(`/api/characters/${id}/generate-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!startRes.ok) {
    // formatApiError 保留 { required, current } 差额信息——此前只取 error 字段，
    // 用户看到英文 "Insufficient credits" 且不知道差多少积分（ux-config P0-2）
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "生成参考图失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  // 轮询：N 张候选，给足 5 分钟（150 × 2s）
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 150;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(
      `/api/characters/${id}/generate-reference/${taskId}`
    );
    if (!pollRes.ok) {
      const error = await pollRes.json().catch(() => null);
      throw new Error(error?.error || "轮询参考图状态失败");
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { candidates: ReferenceCandidate[]; cost: number };
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) return data.result;
    if (data.status === "FAILED")
      throw new Error(data.error || "生成参考图失败");
  }
  throw new Error("生成超时，请稍后刷新角色查看");
}

/**
 * 把用户在候选画廊点选的一张参考图入库（批次 2 · 1.4B）。
 * 候选图生成阶段已上传并扣费，本步骤只持久化选中张，不扣费。
 */
export async function selectReference(id: string, imageUrl: string) {
  const res = await fetch(`/api/characters/${id}/select-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "保存参考图失败"));
  }
  return res.json();
}

/**
 * 一键生成角色三视图（正/侧/背，防生成崩坏），扣 9 积分。
 *
 * 异步化（绕开 Cloudflare 100s 超时）：POST 拿 taskId → 轮询任务状态。
 */
export async function generateThreeViews(
  id: string,
  options: { imageConfigId?: string; customPrompt?: string } = {}
): Promise<{ views: { pose: string; url: string }[]; cost: number }> {
  const startRes = await fetch(`/api/characters/${id}/generate-three-views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(formatApiError(error, "生成三视图失败"));
  }
  const { taskId } = (await startRes.json()) as { taskId: string };

  // 轮询：3 张串行生图，给足 3 分钟（90 × 2s）
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 90;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(
      `/api/characters/${id}/generate-three-views/${taskId}`
    );
    if (!pollRes.ok) {
      const error = await pollRes.json().catch(() => null);
      throw new Error(error?.error || "轮询三视图状态失败");
    }
    const data = (await pollRes.json()) as {
      status: string;
      result?: { views: { pose: string; url: string }[]; cost: number };
      error?: string;
    };
    if (data.status === "COMPLETED" && data.result) return data.result;
    if (data.status === "FAILED")
      throw new Error(data.error || "生成三视图失败");
  }
  throw new Error("生成超时，请稍后刷新角色查看");
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch("/api/tags");
  if (!res.ok) throw new Error("获取标签列表失败");
  return res.json();
}

export async function createTag(data: {
  name: string;
  category?: string;
  color?: string;
}) {
  const res = await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "创建标签失败"));
  }
  return res.json();
}

export async function updateTag(
  id: string,
  data: { name?: string; category?: string; color?: string }
) {
  const res = await fetch(`/api/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "更新标签失败"));
  }
  return res.json();
}

export async function deleteTag(id: string) {
  const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "删除标签失败"));
  }
  return res.json();
}

export async function generateDescription(data: {
  name: string;
  gender: string;
  age: string;
}) {
  const res = await fetch("/api/characters/generate-description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(formatApiError(error, "生成描述失败"));
  }
  return res.json();
}
