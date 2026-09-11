/**
 * 角色表情集（expression sheet）单一真源。
 *
 * ## 为什么需要
 *
 * 漫剧 80% 的镜头是表情特写，而此前系统对表情**零锚定**：分镜只落一个
 * `Scene.emotion` 关键词，出图时靠模型每次重画一张「生气的脸」。同一角色的
 * 愤怒表情在第 3 镜和第 17 镜眉形/嘴角/眼神完全不同——观众感知到的是「换人了」。
 * 专业动漫流程里三视图（锁形体）之外必须有表情集（锁五官演绎）。
 *
 * ## 存储：复用 CharacterReferenceAsset，零 schema 变更
 *
 * 表情图作为 `CharacterReferenceAsset` 落库，`pose` 写 `expr:<key>`（如 `expr:anger`）。
 * 该字段在 DB 层是裸 `String?`，无枚举约束（schema 注释里的
 * `front | side | back | 3quarter` 只是文档，不是约束）。
 *
 * `expr:` 前缀是刻意设计的**命名空间隔离**：既有消费方全部用精确匹配读 pose
 * （`three-views.ts#extractThreeViews`、`facing.ts#pickAssetUrlForFacing` 的
 * `byPose`），`expr:*` 天然不命中，不会被误当成三视图。唯一需要同步的是
 * `canonical-anchor.ts#resolveAnchorPose`——它把「不认识的 pose」静默归一成
 * `"front"`，若不处理，用户把一张表情图提为定妆锚后，朝向感知选图会拿这张
 * 表情特写当正面全身立绘用。
 *
 * ## 生成：每种表情单独出图，绝不多格拼版
 *
 * 硬约束，理由见 `prompts/character-reference.ts#POSE_CONSTRAINTS` 的措辞禁忌：
 * "character sheet" / "expression sheet" 等词在图像模型语料里字面等于「一张纸上
 * 排布多格的设定稿」，会让模型把单个表情画成九宫格。而多格表情图作为参考图喂给
 * `/images/edits` 端点更是灾难——模型不知该复现哪一格，或把六张脸融合成一张。
 * 故本模块只提供**单表情**的 prompt 片段，由调用方逐个出图。
 *
 * 纯函数、无 IO、无 LLM。
 */

/** 表情键（最小可行集，6 种） */
export const EXPRESSION_KEYS = [
  "neutral",
  "joy",
  "anger",
  "sorrow",
  "surprise",
  "embarrassed",
] as const;

export type ExpressionKey = (typeof EXPRESSION_KEYS)[number];

/** `CharacterReferenceAsset.pose` 里表情图的命名空间前缀 */
export const EXPRESSION_POSE_PREFIX = "expr:";

/**
 * 单个表情的定义：中文名（UI 展示）+ 英文五官描述（进 prompt）。
 *
 * prompt 片段刻意写到「眉形 / 眼形 / 嘴角 / 脸红区域」这一粒度，而不是
 * `angry face` 这种标签词——标签词只会让模型套用它自己的平均脸，各次生成
 * 之间仍然漂移；具体的五官几何描述才能把同一角色的同一表情钉在同一画法上。
 */
export interface ExpressionSpec {
  key: ExpressionKey;
  /** 中文名，用于 UI 与日志 */
  label: string;
  /** 英文五官描述，注入出图 prompt */
  prompt: string;
}

/**
 * 六种表情的规格表。
 *
 * 选集判据是**该表情的五官画法是否与已有的存在结构性差异**，而非情绪词典的
 * 完整性：
 * - `embarrassed`（羞/慌）入选——甜宠与都市言情题材的高频核心表情，有独立的
 *   脸红区域 + 眼神回避方向，五官几何与「喜」完全不同，是结构性差异。
 * - 「得意/冷笑」落选——只是笑的变体，可由 joy + `smug, one corner of mouth
 *   raised` 逼近。
 * - 「崩溃」落选——可由 sorrow + 强度词逼近。
 */
export const EXPRESSION_SPECS: readonly ExpressionSpec[] = [
  {
    key: "neutral",
    label: "平静",
    prompt:
      "neutral calm expression, eyebrows level and relaxed, " +
      "eyes open at normal width with a steady forward gaze, " +
      "mouth closed in a straight relaxed line, no blush, jaw unclenched",
  },
  {
    key: "joy",
    label: "喜悦",
    prompt:
      "joyful happy expression, eyebrows raised and arched outward, " +
      "eyes narrowed into gentle crescents with lower eyelids pushed up, " +
      "mouth open in a wide upward smile showing upper teeth, " +
      "cheeks lifted with a soft warm flush across the cheekbones",
  },
  {
    key: "anger",
    label: "愤怒",
    prompt:
      "angry furious expression, eyebrows sharply lowered and drawn together " +
      "into a hard V shape, vertical crease between the brows, " +
      "eyes wide open and glaring with tightened lower eyelids and small pupils, " +
      "mouth pulled down at the corners or open in a shout with bared teeth, " +
      "clenched jaw, flushed red tone across the forehead and cheeks",
  },
  {
    key: "sorrow",
    label: "悲伤",
    prompt:
      "sorrowful sad expression, inner ends of the eyebrows pulled sharply upward " +
      "into an inverted V, upper eyelids drooping, " +
      "eyes glistening and welling with tears, gaze cast downward, " +
      "mouth corners pulled down in a trembling frown, " +
      "no blush, slightly reddened eye rims and nose tip",
  },
  {
    key: "surprise",
    label: "惊讶",
    prompt:
      "surprised shocked expression, eyebrows raised high with horizontal " +
      "forehead creases, eyes opened extremely wide with visible white " +
      "all around the shrunken pupils, " +
      "mouth hanging open in a small vertical oval, chin dropped, no blush",
  },
  {
    key: "embarrassed",
    label: "羞怯",
    prompt:
      "embarrassed flustered shy expression, eyebrows tilted upward at the " +
      "inner ends in a worried curve, " +
      "eyes averted looking away to the side, not meeting the camera, " +
      "pupils shifted off-center, mouth small and pressed into a wavering line, " +
      "strong bright red blush spread across both cheeks and the bridge of the nose",
  },
] as const;

/** key → spec 的查表索引（模块级构建一次） */
const SPEC_BY_KEY = new Map<ExpressionKey, ExpressionSpec>(
  EXPRESSION_SPECS.map((s) => [s.key, s])
);

/** 取某个表情的规格；未知 key 返回 undefined */
export function getExpressionSpec(
  key: string | null | undefined
): ExpressionSpec | undefined {
  const k = key?.trim();
  if (!k) return undefined;
  return SPEC_BY_KEY.get(k as ExpressionKey);
}

/**
 * 把表情 key 编码成 `CharacterReferenceAsset.pose` 的存储值。
 * 例：`"anger"` → `"expr:anger"`。
 */
export function toExpressionPose(key: ExpressionKey): string {
  return `${EXPRESSION_POSE_PREFIX}${key}`;
}

/**
 * 从 pose 值反解表情 key；不是表情 pose（三视图 / null / 未知表情）返回 undefined。
 *
 * 严格校验尾部必须是已知表情 key——脏数据里的 `expr:whatever` 不应被当成合法
 * 表情图消费（否则会被当参考图喂给模型，而那张图画的是什么无人知晓）。
 */
export function parseExpressionPose(
  pose: string | null | undefined
): ExpressionKey | undefined {
  const p = pose?.trim();
  if (!p?.startsWith(EXPRESSION_POSE_PREFIX)) return undefined;
  const key = p.slice(EXPRESSION_POSE_PREFIX.length);
  return SPEC_BY_KEY.has(key as ExpressionKey)
    ? (key as ExpressionKey)
    : undefined;
}

/** 某个 pose 是否属于表情命名空间（含未知尾部；用于「不是三视图」的排除判断） */
export function isExpressionPose(pose: string | null | undefined): boolean {
  return Boolean(pose?.trim().startsWith(EXPRESSION_POSE_PREFIX));
}

/**
 * `Scene.emotion`（neutral|happy|sad|angry|surprised|fear）→ 表情 key。
 *
 * 情绪枚举是解析层的单一真源（见 `lib/tts-emotion.ts#SceneEmotion`），表情集
 * 不另造一套词汇，只做映射：
 * - `fear` → `surprise`：恐惧与惊讶共享「瞳孔缩小 + 眼睛大睁 + 张嘴」的核心
 *   几何，画法差异小到不值得单独占一张表情图（差异主要在肢体与光影，那是
 *   分镜层的事）。
 * - `embarrassed` 不在情绪枚举里，故本函数永不返回它——羞怯由
 *   `inferExpressionKey` 的文本线索命中。
 */
const EMOTION_TO_EXPRESSION: Record<string, ExpressionKey> = {
  neutral: "neutral",
  happy: "joy",
  sad: "sorrow",
  angry: "anger",
  surprised: "surprise",
  fear: "surprise",
};

/**
 * 羞怯 / 慌乱的文本线索。
 *
 * 只收**显式**信号：像「脸红」这种词在「气得脸红」里也会出现，故不单收
 * 「脸红」二字，而要求它与害羞语义共现（由下方 regex 的组合承担）。
 * 命中面窄一点没关系——漏判退回 emotion 映射，误判则会拿一张脸红回避视线的
 * 图去锚一个愤怒镜头，代价不对称。
 */
const EMBARRASSED_PATTERNS: RegExp[] = [
  /害羞/,
  /羞涩/,
  /羞红/,
  /娇羞/,
  /脸红心跳/,
  /红了脸/,
  /脸颊发烫/,
  /不好意思地/,
  /慌乱地移开视线/,
  /\bblush(?:ing|es|ed)?\b/i,
  /\bembarrassed\b/i,
  /\bflustered\b/i,
  /\bbashful\b/i,
  /\bshyly\b/i,
];

/**
 * 推断一个分镜该用哪张表情参考图。
 *
 * 优先级：
 * 1. 画面描述命中羞怯线索 → `embarrassed`（`Scene.emotion` 枚举里没有这个值，
 *    只能从文本捞；且羞怯镜若错用 joy 的参考图会丢掉「回避视线」这个核心特征）。
 * 2. `Scene.emotion` 映射。
 * 3. 都没有 → undefined，调用方按「无表情锚」走既有逻辑（零回归）。
 *
 * 刻意**不**在 emotion 缺省时回落 `neutral`：没有情绪标注的镜头（多为环境镜 /
 * 群像）本就不该被塞一张平静脸特写当参考图。
 */
export function inferExpressionKey(input: {
  emotion?: string | null;
  description?: string | null;
}): ExpressionKey | undefined {
  const text = input.description?.trim();
  if (text && EMBARRASSED_PATTERNS.some((re) => re.test(text))) {
    return "embarrassed";
  }

  const emotion = input.emotion?.trim().toLowerCase();
  if (!emotion) return undefined;
  return EMOTION_TO_EXPRESSION[emotion];
}

/** 带 pose 的参考资产最小形状（兼容 Prisma 行与前端类型） */
export interface ExpressionAsset {
  url: string;
  pose?: string | null;
  createdAt?: string | Date;
}

/**
 * 从角色的参考资产里挑出指定表情的图。
 *
 * 不做任何回退：没有该表情的图就返回 undefined，让调用方走原有的
 * 定妆图 / 朝向感知选图逻辑。绝不「退而求其次拿另一种表情」——用愤怒的脸去锚
 * 一个悲伤镜比没有表情锚更糟。
 */
export function pickExpressionAssetUrl(
  assets: ExpressionAsset[] | undefined | null,
  key: ExpressionKey
): string | undefined {
  if (!assets?.length) return undefined;
  const pose = toExpressionPose(key);
  return assets.find((a) => a.pose?.trim() === pose)?.url;
}

/**
 * 提取角色已有的全部表情图（UI 展示用）：key → url，缺的键不出现。
 *
 * 同一表情有多张时取**最新一张**（重新生成应覆盖旧图）。显式按 createdAt 比较
 * 而非依赖入参顺序——各调用方传入的排序不一致（characters 路由是 createdAt desc，
 * 三视图路径是 asc），依赖顺序会让同一份数据在两处显示出不同的图。
 * 无 createdAt 的老数据视为最旧，靠遍历顺序兜底。
 */
export function extractExpressionSheet(
  assets: ExpressionAsset[] | undefined | null
): Partial<Record<ExpressionKey, string>> {
  const result: Partial<Record<ExpressionKey, string>> = {};
  if (!assets?.length) return result;

  const ts = (a: ExpressionAsset): number =>
    a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bestTs: Partial<Record<ExpressionKey, number>> = {};

  for (const asset of assets) {
    const key = parseExpressionPose(asset.pose);
    if (!key) continue;
    const t = ts(asset);
    const prev = bestTs[key];
    // >= 让无 createdAt 的同表情多张退化为「取最后一张」，与既有直觉一致
    if (prev === undefined || t >= prev) {
      result[key] = asset.url;
      bestTs[key] = t;
    }
  }
  return result;
}

/**
 * 单张表情图的构图约束（与三视图的 SINGLE_SUBJECT 同思路，但取景是胸上特写）。
 *
 * 表情集要的是**脸**：全身立绘里脸只占几十个像素，作为表情参考毫无信息量。
 * 同时必须显式排斥拼版措辞的语义（"one single expression" / "no grid"），
 * 否则 "expression" 一词会把模型引向多格设定稿。
 */
export const EXPRESSION_FRAMING =
  "a single character portrait, head and shoulders close-up, face filling most of the frame, " +
  "one subject only, one single expression, one single image, " +
  "centered composition, facing the camera, isolated on a plain white background, " +
  "no grid, no collage, no multiple panels, no multiple expressions";

/**
 * 表情图负向提示：双向防拼版。与 `THREE_VIEW_NEGATIVE` 同源思路，
 * 额外压住 "expression sheet" 这个在表情场景下最危险的语料词。
 */
export const EXPRESSION_NEGATIVE =
  "expression sheet, character sheet, reference sheet, emotion chart, grid, collage, " +
  "multiple expressions, multiple faces, multiple panels, split panels, tiled images, " +
  "contact sheet, full body, wide shot";
