/**
 * 尾帧衔接建议的纯逻辑（计划 §5 · 2.1「尾帧衔接智能化」）
 *
 * 拆成三段职责，均为纯函数，供 suggest-links 路由与单测复用：
 * 1. prefilterLinkCandidates —— 相邻镜对的确定性预筛，把「明显不连贯」的对提前排除，
 *    只留下候选对喂给 LLM（无候选时零 LLM 调用，零成本）。
 * 2. buildLinkSuggestPrompt —— 把候选对压成紧凑输入，让 LLM 判断哪些「同场景 + 动作/时间连续」。
 * 3. parseLinkSuggestOutput —— 防御式解析 LLM 输出（严格 JSON 数组），越界/非法索引丢弃。
 *
 * 衔接语义：videoLinkNext 开启后，生成本镜视频时把「下一镜图片」作尾帧走 FL 首尾帧插值，
 * 实现相邻镜无缝衔接。只有空间/时间连续的相邻镜适合衔接；跳切强开会出现变形 morph。
 */

/** 参与判断的单个分镜（仅取衔接判定需要的字段） */
export interface LinkCandidateScene {
  id: string;
  order: number;
  /** 地点短标签（同物理地点共用同值）；空/缺失表示解析层未标注 */
  locationKey?: string | null;
  description?: string | null;
  /** 运动节拍（这一镜"什么在动"），供 LLM 判断动作是否连续 */
  actionBeat?: string | null;
  emotion?: string | null;
}

/** 预筛后的候选对：相邻两镜（i 与 i+1） */
export interface LinkCandidatePair {
  scene: LinkCandidateScene;
  nextScene: LinkCandidateScene;
}

/** LLM 判定通过的衔接建议（对应一对相邻镜） */
export interface LinkSuggestion {
  sceneId: string;
  nextSceneId: string;
  reason: string;
}

function normalizeLocation(key?: string | null): string {
  return (key ?? "").trim();
}

/**
 * 相邻镜对的确定性预筛。
 *
 * 规则（按 order 升序两两配对）：
 * - 两侧地点标签都非空且【不同】→ 排除（明确异地，无需 LLM）。
 * - 两侧地点标签都非空且【相同】→ 候选（同地点，交给 LLM 判动作/时间是否连续）。
 * - 任一侧地点标签缺失 → 候选（解析层未标注，交给 LLM 凭描述判断）。
 *
 * 输入无需预排序：内部按 order 升序后再配对。少于 2 个分镜时返回空数组。
 */
export function prefilterLinkCandidates(
  scenes: LinkCandidateScene[]
): LinkCandidatePair[] {
  if (scenes.length < 2) return [];

  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const pairs: LinkCandidatePair[] = [];

  for (let i = 0; i < ordered.length - 1; i++) {
    const scene = ordered[i];
    const nextScene = ordered[i + 1];
    const locA = normalizeLocation(scene.locationKey);
    const locB = normalizeLocation(nextScene.locationKey);

    // 两侧都有地点标签且不同 → 明确异地，直接排除
    if (locA && locB && locA !== locB) continue;

    pairs.push({ scene, nextScene });
  }

  return pairs;
}

function clamp(text: string | null | undefined, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

export const LINK_SUGGEST_SYSTEM =
  "你是专业的漫剧剪辑导演，判断相邻两个分镜是否适合「首尾帧衔接」（用前一镜的下一镜图片做尾帧做无缝过渡）。" +
  "只有【同一场景】且【动作或时间连续】的相邻镜才适合衔接（如进门/伸手/转身等空间连续的动作）；" +
  "跳切、换地点、时间跳跃、大幅度机位变化都不适合。只输出 JSON 数组，不要任何解释或 markdown 代码块标记。";

/**
 * 构建衔接判断的用户 prompt。
 *
 * 每个候选对压成一行紧凑输入（pair 索引 + 两侧 order/地点/描述/节拍/情绪），
 * 让 LLM 返回「适合衔接」的 pair 索引数组及一句话理由。
 * pair 索引即 candidates 数组下标（0 起），解析时用它映射回 sceneId。
 */
export function buildLinkSuggestPrompt(
  candidates: LinkCandidatePair[]
): string {
  const lines = candidates.map((pair, index) => {
    const a = pair.scene;
    const b = pair.nextScene;
    return (
      `[对 ${index}] 镜${a.order}→镜${b.order}\n` +
      `  前镜: 地点=${normalizeLocation(a.locationKey) || "未标注"} | ` +
      `描述=${clamp(a.description, 120) || "无"} | ` +
      `动作=${clamp(a.actionBeat, 60) || "无"} | 情绪=${a.emotion || "无"}\n` +
      `  后镜: 地点=${normalizeLocation(b.locationKey) || "未标注"} | ` +
      `描述=${clamp(b.description, 120) || "无"} | ` +
      `动作=${clamp(b.actionBeat, 60) || "无"} | 情绪=${b.emotion || "无"}`
    );
  });

  return `以下是若干组相邻分镜对，判断每一对是否「同场景且动作/时间连续，适合首尾帧衔接」：

${lines.join("\n\n")}

只挑出【适合衔接】的对。严格只输出如下 JSON 数组（reason 为中文一句话，≤30 字，说明为何连续）：
[{"pair": 0, "reason": "同一房间内伸手推门的连续动作"}]
若没有任何一对适合衔接，输出空数组 []。`;
}

/**
 * 从 LLM 原始文本中提取 JSON 数组（宽松：容忍代码围栏或前后杂字）。
 * 找不到合法数组时抛错，供路由转 502（不臆造结果）。
 */
function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("LLM 输出中未找到 JSON 数组");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * 防御式解析 LLM 输出，映射回衔接建议。
 *
 * - 解析失败（非合法 JSON / 非数组）→ 抛错（路由转 502）。
 * - 单个条目非法（pair 非整数 / 越界 / 缺 reason）→ 丢弃该条，不整体失败。
 * - pair 索引去重（同一对只保留首个）。
 *
 * @param raw LLM 原始文本
 * @param candidates 预筛候选对（pair 索引即其下标）
 */
export function parseLinkSuggestOutput(
  raw: string,
  candidates: LinkCandidatePair[]
): LinkSuggestion[] {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("LLM 输出不是 JSON 数组");
  }

  const suggestions: LinkSuggestion[] = [];
  const seen = new Set<number>();

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const pair = record.pair;
    if (typeof pair !== "number" || !Number.isInteger(pair)) continue;
    if (pair < 0 || pair >= candidates.length) continue;
    if (seen.has(pair)) continue;

    const candidate = candidates[pair];
    const reasonRaw =
      typeof record.reason === "string" ? record.reason.trim() : "";
    const reason = reasonRaw ? clamp(reasonRaw, 40) : "同场景动作连续";

    seen.add(pair);
    suggestions.push({
      sceneId: candidate.scene.id,
      nextSceneId: candidate.nextScene.id,
      reason,
    });
  }

  return suggestions;
}
