/**
 * 角色画像 roster · AI 选角 Prompt 构建（一键 AI 制片人 · 3.1 修复）
 *
 * 背景：制片人向导原先建档角色时只传名字，Character.gender/age/description
 * 全落 null，且外貌预填仅凭名字瞎猜性别 → 出图性别错误。本 prompt 在建档前做
 * **一次**结构化 LLM 调用，从脚本产物文本为「给定的每个角色名」推断
 * gender/age/一句话身份，供全链路透传（建档 + 外貌预填）。
 *
 * 与 appearance-draft 的区别：那个吃「单个角色 + 已知性别年龄」产出结构化外貌；
 * 本 prompt 是它的上游——一次性为「一批角色名」推断基础画像（性别/年龄/身份）。
 */

/** 单次调用最多推断的角色数（与向导 MAX_PRODUCER_CHARACTERS 成本护栏一致） */
export const MAX_ROSTER_CHARACTERS = 6;

export interface CharacterRosterInput {
  /** 待推断画像的角色名（且仅这些名字，LLM 不得增删） */
  names: string[];
  /** 世界观设定（函数内截断防超长） */
  worldview: string;
  /** 主角身份一句话描述（可选，帮助定位主角性别年龄） */
  protagonist?: string;
  /** 各场景摘要（标题/描述/对白拼接，函数内截断防超长） */
  scenesDigest?: string;
}

export const CHARACTER_ROSTER_SYSTEM =
  "你是专业的动漫短剧选角导演，擅长依据剧本文本为每个角色定位性别、年龄与身份人设。" +
  "只输出 JSON，不要任何解释、markdown 代码块标记或多余文字。";

/** 世界观最大注入长度（超出截断，防 prompt 过长） */
const WORLDVIEW_MAX = 2000;
/** 场景摘要最大注入长度（超出截断，防 prompt 过长） */
const SCENES_DIGEST_MAX = 3000;

/** 截断到指定长度（超出补省略号，保持 prompt 稳定不超长） */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max)}……（已截断）`
    : trimmed;
}

/**
 * 归一化 gender 容错映射。
 *
 * 大小写、首尾空白不敏感：
 * - "male" / "男" / "m"   → "male"
 * - "female" / "女" / "f" → "female"
 * - 其余（含空串/未知）    → ""
 */
export function normalizeRosterGender(g: string): "male" | "female" | "" {
  const v = (g ?? "").trim().toLowerCase();
  if (v === "male" || v === "男" || v === "m") return "male";
  if (v === "female" || v === "女" || v === "f") return "female";
  return "";
}

/** LLM 输出的单条角色画像（路由/客户端共用最小形状） */
export interface RosterProfileRaw {
  name: string;
  gender: string;
  age: string;
  description: string;
}

/**
 * 按请求 names 过滤 LLM 输出的角色画像（纯函数，供路由 + 测试共用）。
 *
 * LLM 可能编造请求外的多余角色，或漏掉部分角色；此处只保留 name 命中
 * 请求集合（trim 后精确匹配）的条目，同时对 gender 做归一化。
 *
 * @param requestedNames 请求的角色名（权威白名单）
 * @param rawProfiles LLM 产出的画像数组
 * @returns 过滤 + 归一后的画像（gender 已收敛为 male/female/""）
 */
export function filterRosterByNames(
  requestedNames: string[],
  rawProfiles: RosterProfileRaw[]
): RosterProfileRaw[] {
  const allow = new Set(requestedNames.map((n) => n.trim()));
  const seen = new Set<string>();
  const result: RosterProfileRaw[] = [];
  for (const p of rawProfiles) {
    const name = p.name.trim();
    // 不在白名单、或同名重复（LLM 偶发重复输出）→ 丢弃
    if (!allow.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      gender: normalizeRosterGender(p.gender),
      age: p.age.trim(),
      description: p.description.trim(),
    });
  }
  return result;
}

/**
 * 构建角色画像 roster 的用户 prompt。
 *
 * 要求 LLM 对给定的**每个**角色名（且仅这些名字）输出：
 * { gender: "male"|"female", age: 如「22」或「20-25」, description: 一句话身份人设 ≤50字 }。
 * gender 必须二选一，依据文本证据判断；实在无证据按名字气质给最可能值。
 */
export function buildCharacterRosterPrompt(
  input: CharacterRosterInput
): string {
  const worldviewBlock = truncate(input.worldview, WORLDVIEW_MAX);
  const protagonistLine = input.protagonist?.trim()
    ? `\n- 主角身份：${input.protagonist.trim()}`
    : "";
  const scenesBlock = input.scenesDigest?.trim()
    ? `\n\n【场景摘要（推断人设的证据来源）】\n${truncate(
        input.scenesDigest,
        SCENES_DIGEST_MAX
      )}`
    : "";
  const nameList = input.names.map((n) => n.trim()).join("、");

  return `请为以下短剧角色逐一定位性别、年龄与一句话身份人设，用于角色建档。

【世界观】
${worldviewBlock}${protagonistLine}

【需要定位的角色（且仅这些，不要增删）】
${nameList}${scenesBlock}

字段与取值要求：
- name：必须与上面列出的角色名完全一致。
- gender：**必须**二选一，只能是「male」或「female」（英文小写）。依据剧本文本证据判断；确无证据时按名字气质给出最可能的值，不要留空。
- age：如「22」或「20-25」这样的数字/区间，无从判断时给一个符合角色定位的合理值。
- description：一句话身份人设（谁 + 处境/关系/性格），**不超过 50 字**，中文。

严格只输出如下 JSON（characters 数组须覆盖上面列出的每个角色，且不含多余角色）：
{"characters":[{"name":"","gender":"male","age":"","description":""}]}`;
}
