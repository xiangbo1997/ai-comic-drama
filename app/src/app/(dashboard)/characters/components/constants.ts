import type { CharacterListItem, Tag } from "@/types";

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
};

export async function fetchCharacters(): Promise<CharacterListItem[]> {
  const res = await fetch("/api/characters");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to fetch characters");
  }
  return res.json();
}

export async function createCharacter(data: Record<string, unknown>) {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create character");
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
  if (!res.ok) throw new Error("Failed to update character");
  return res.json();
}

export async function deleteCharacter(id: string) {
  const res = await fetch(`/api/characters/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete character");
  return res.json();
}

export async function generateReference(
  id: string,
  options: {
    baseImage?: string;
    customPrompt?: string;
    useExistingImage?: boolean;
    existingImageIndex?: number;
    imageConfigId?: string;
  } = {}
) {
  const res = await fetch(`/api/characters/${id}/generate-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(error?.error || "生成参考图失败");
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
  options: { imageConfigId?: string } = {}
): Promise<{ views: { pose: string; url: string }[]; cost: number }> {
  const startRes = await fetch(`/api/characters/${id}/generate-three-views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!startRes.ok) {
    const error = await startRes.json().catch(() => null);
    throw new Error(error?.error || "生成三视图失败");
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
  if (!res.ok) throw new Error("Failed to fetch tags");
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
    const error = await res.json();
    throw new Error(error.error || "Failed to create tag");
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
    const error = await res.json();
    throw new Error(error.error || "Failed to update tag");
  }
  return res.json();
}

export async function deleteTag(id: string) {
  const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to delete tag");
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
    const error = await res.json();
    throw new Error(error.error || "生成描述失败");
  }
  return res.json();
}
