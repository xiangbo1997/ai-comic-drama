/**
 * 场景锚图（地点空景板）的纯逻辑（计划 §5 · 2.2）
 *
 * 拆成四段职责，均为纯函数（零 prisma / 零副作用），供 locations 路由与单测复用：
 * 1. mergeLocations —— 把「分镜里出现过的 locationKey」与「已建 ProjectLocation 行」
 *    左连接成合并视图（每地点带分镜数 + 描述 + 锚图 url + 行 id），供列表展示。
 * 2. buildDescribePrompt + parseDescribeOutput —— 让 LLM 为缺描述的地点各写一句
 *    环境描述（≤80 字），防御式解析 JSON。
 * 3. buildLabelPrompt + parseLabelOutput —— 存量项目补跑：为 locationKey 为空的分镜
 *    批量指派地点标签（一次 LLM），防御式解析。
 * 4. buildPlatePrompt —— 拼「无人物空景板」出图 prompt（地点描述 + 该地点各分镜环境
 *    线索 + 画风包锚定/场景规则/色彩系统 + 硬约束：空场景无人物、定场广角、统一光源）。
 *
 * 语义：空景板作为该地点所有分镜出图的「场景锚」——只锁背景/空间布局/光线，
 * 角色形象仍只跟角色参考走（见 image-orchestrator 的 SCENE 格注入）。
 */

import { getStylePack } from "@/lib/prompts/style-packs";

/** 分镜里参与地点聚合的最小字段 */
export interface LocationScene {
  id: string;
  order: number;
  /** 地点短标签；空/缺失表示解析层未标注（存量补跑的对象） */
  locationKey?: string | null;
  description?: string | null;
}

/** 已建的地点行（ProjectLocation 子集） */
export interface LocationRow {
  id: string;
  locationKey: string;
  description?: string | null;
  imageUrl?: string | null;
}

/** 合并后的地点视图（一行一地点），供 GET locations 返回与 UI 展示 */
export interface MergedLocation {
  /** ProjectLocation 行 id；尚未建行时为 undefined */
  id?: string;
  locationKey: string;
  /** 该地点下的分镜数（据 Scene.locationKey 统计） */
  sceneCount: number;
  description?: string | null;
  imageUrl?: string | null;
}

function normalizeKey(key?: string | null): string {
  return (key ?? "").trim();
}

/**
 * 合并「分镜出现过的地点」与「已建 ProjectLocation 行」。
 *
 * - 地点集合 = 分镜里非空 locationKey 去重（分镜是地点的真源；locationKey 未标注的
 *   分镜不产生地点，交给 label 补跑先标注）。
 * - 每个地点带 sceneCount（该 key 的分镜数）+ 左连接的行信息（description/imageUrl/id）。
 * - 已建行但分镜已全部改名/删除导致「无对应分镜」的地点也保留（sceneCount=0），
 *   避免用户已生成的锚图凭空消失。
 * - 结果按 sceneCount 降序、locationKey 升序稳定排序（常用地点在前）。
 */
export function mergeLocations(
  scenes: LocationScene[],
  rows: LocationRow[]
): MergedLocation[] {
  const countByKey = new Map<string, number>();
  for (const s of scenes) {
    const key = normalizeKey(s.locationKey);
    if (!key) continue;
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  const rowByKey = new Map<string, LocationRow>();
  for (const r of rows) {
    const key = normalizeKey(r.locationKey);
    if (key) rowByKey.set(key, r);
  }

  // 地点全集 = 分镜出现过的 key ∪ 已建行的 key
  const keys = new Set<string>([...countByKey.keys(), ...rowByKey.keys()]);

  const merged: MergedLocation[] = [];
  for (const key of keys) {
    const row = rowByKey.get(key);
    merged.push({
      id: row?.id,
      locationKey: key,
      sceneCount: countByKey.get(key) ?? 0,
      description: row?.description ?? null,
      imageUrl: row?.imageUrl ?? null,
    });
  }

  merged.sort(
    (a, b) =>
      b.sceneCount - a.sceneCount || a.locationKey.localeCompare(b.locationKey)
  );
  return merged;
}

function clamp(text: string | null | undefined, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** 从 LLM 原始文本中提取 JSON 数组（宽松：容忍代码围栏或前后杂字）。找不到抛错。 */
function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("LLM 输出中未找到 JSON 数组");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

// ========== 地点描述汇总（describe） ==========

/** 待描述的地点：地点标签 + 该地点各分镜的画面描述样本 */
export interface DescribeTarget {
  locationKey: string;
  /** 该地点分镜的描述样本（已在调用方截断/采样） */
  sceneDescriptions: string[];
}

export const DESCRIBE_SYSTEM =
  "你是专业的漫剧美术指导，为每个「地点」提炼一句纯环境描述（不含任何人物/角色/动作）。" +
  "描述聚焦：空间类型、关键陈设、材质、光线氛围。每条 ≤80 字，简洁具体。" +
  "只输出 JSON 数组，不要任何解释或 markdown 代码块标记。";

/**
 * 构建地点描述 prompt。每个地点压成一行（key + 该地点分镜描述样本），
 * 让 LLM 返回 [{key, description}]。key 原样回传，用于映射。
 */
export function buildDescribePrompt(targets: DescribeTarget[]): string {
  const lines = targets.map((t) => {
    const samples = t.sceneDescriptions
      .map((d) => clamp(d, 80))
      .filter(Boolean)
      .slice(0, 6)
      .join("；");
    return `地点「${t.locationKey}」，相关画面：${samples || "无"}`;
  });

  return `为以下每个地点写一句纯环境描述（不含人物，≤80 字）：

${lines.join("\n")}

严格只输出如下 JSON 数组（key 必须与上面地点名完全一致）：
[{"key": "地点名", "description": "一句环境描述"}]`;
}

/** describe 解析结果：key → description（已 clamp） */
export interface DescribeResult {
  locationKey: string;
  description: string;
}

/**
 * 防御式解析 describe 输出。
 * - 非合法 JSON / 非数组 → 抛错（路由转 502）。
 * - 单条非法（缺 key / key 不在目标集 / 描述空）→ 丢弃，不整体失败。
 * - key 去重（同 key 保留首个）。
 */
export function parseDescribeOutput(
  raw: string,
  targets: DescribeTarget[]
): DescribeResult[] {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) throw new Error("LLM 输出不是 JSON 数组");

  const validKeys = new Set(targets.map((t) => t.locationKey));
  const seen = new Set<string>();
  const results: DescribeResult[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    const desc =
      typeof rec.description === "string" ? rec.description.trim() : "";
    if (!key || !validKeys.has(key) || seen.has(key) || !desc) continue;
    seen.add(key);
    results.push({ locationKey: key, description: clamp(desc, 80) });
  }
  return results;
}

// ========== 存量补跑：为未标注地点的分镜指派 locationKey（label） ==========

/** 待打标的分镜（locationKey 为空者） */
export interface LabelScene {
  id: string;
  order: number;
  description?: string | null;
}

export const LABEL_SYSTEM =
  "你是专业的漫剧场记，为每个分镜指派一个「地点短标签」（如「客厅」「学校操场」「地铁站台」），" +
  "同一物理地点的分镜必须用完全一致的标签。标签 ≤10 字，只描述地点不含人物/动作。" +
  "只输出 JSON 数组，不要任何解释或 markdown 代码块标记。";

/**
 * 构建地点打标 prompt。每个分镜压成一行（下标 + order + 描述），
 * 让 LLM 返回 [{index, locationKey}]。index 即 scenes 数组下标（0 起）。
 */
export function buildLabelPrompt(scenes: LabelScene[]): string {
  const lines = scenes.map(
    (s, i) => `[${i}] 镜${s.order}：${clamp(s.description, 120) || "无描述"}`
  );

  return `为以下每个分镜指派一个地点短标签（同地点用一致标签，≤10 字，只描述地点）：

${lines.join("\n")}

严格只输出如下 JSON 数组（index 为上面方括号内的下标）：
[{"index": 0, "locationKey": "客厅"}]`;
}

/** label 解析结果：分镜 id → 指派的 locationKey */
export interface LabelResult {
  sceneId: string;
  locationKey: string;
}

/**
 * 防御式解析 label 输出。
 * - 非合法 JSON / 非数组 → 抛错（路由转 502）。
 * - 单条非法（index 非整数 / 越界 / 标签空）→ 丢弃。
 * - index 去重。
 */
export function parseLabelOutput(
  raw: string,
  scenes: LabelScene[]
): LabelResult[] {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) throw new Error("LLM 输出不是 JSON 数组");

  const seen = new Set<number>();
  const results: LabelResult[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const index = rec.index;
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    if (index < 0 || index >= scenes.length || seen.has(index)) continue;
    const key =
      typeof rec.locationKey === "string" ? rec.locationKey.trim() : "";
    if (!key) continue;
    seen.add(index);
    results.push({ sceneId: scenes[index].id, locationKey: clamp(key, 20) });
  }
  return results;
}

// ========== 空景板出图 prompt ==========

/** 拼空景板 prompt 的入参 */
export interface PlatePromptInput {
  locationKey: string;
  /** 地点环境描述（describe 产出或用户改） */
  description?: string | null;
  /** 该地点各分镜的画面描述样本（提取环境线索） */
  sceneHints: string[];
  /** 项目画风 id（getStylePack 消费；未知/空回落日漫） */
  style?: string | null;
}

/** 空景板硬约束（正向）：空场景、无人物、定场广角、统一光源 */
const EMPTY_SCENE_CONSTRAINT =
  "empty scene, environment establishing shot, wide-angle establishing shot, NO people, no characters, no human figures, no silhouettes, unoccupied location, consistent single light source, clean background plate for compositing";

/** 空景板负向词（叠加画风包负向）：排斥任何人物 */
export const PLATE_NEGATIVE_BASE =
  "person, people, human, character, figure, silhouette, crowd, portrait, face";

/**
 * 拼空景板出图 prompt。
 * 排布（权重递增）：画风锚定 → 地点描述 → 分镜环境线索 → 场景规则/色彩系统 → 空场景硬约束（末尾最重）。
 * legacy 平面风格：sceneRules/colorSystem 为空串，自动跳过（不产生空段落垃圾）。
 */
export function buildPlatePrompt(input: PlatePromptInput): string {
  const pack = getStylePack(input.style);
  const hints = input.sceneHints
    .map((h) => clamp(h, 100))
    .filter(Boolean)
    .slice(0, 5)
    .join("; ");

  const parts = [
    pack.anchor,
    `Location: ${input.locationKey}.`,
    clamp(input.description, 300),
    hints ? `Environment cues: ${hints}.` : "",
    pack.sceneRules,
    pack.colorSystem,
    EMPTY_SCENE_CONSTRAINT,
  ];

  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

/** 空景板负向词：基础人物排斥 + 画风包特化负向（去重拼接）。 */
export function buildPlateNegative(style?: string | null): string {
  const pack = getStylePack(style);
  const parts = [PLATE_NEGATIVE_BASE, pack.negative.trim()].filter(Boolean);
  return parts.join(", ");
}
