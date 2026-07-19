/**
 * 情绪语法（Emotion Grammar）——把「情绪 × 强度」翻译成漫剧化的夸张表情词 + 漫画符号词
 *
 * 背景：脚本解析层的情绪只落成 emotion（neutral/happy/sad/angry/surprised/fear）+
 * 可选强度，出图 prompt 此前只会拼成一句 "sad mood"，高潮镜头因此渲染成平静插画。
 * 本模块补齐动漫工业的「夸张表情语汇」与「漫画符号语汇」（速度线、冲击帧、汗滴、
 * 爆青筋等），让情绪在关键帧上被【画出来】而非只标注。
 *
 * 分层：
 * - expression（夸张表情）：任何画风都适用（写实剧同样需要强表演，只是幅度收敛）。
 * - symbols（漫画符号）：仅 2D/动画/漫画类画风适用；写实/油画类画风【禁用】
 *   （速度线/冲击帧画在照片级画面上会崩坏），由 packAllowsMangaSymbols 门控。
 *
 * ⚠️ 依赖纪律：与 style-packs.ts 同级，零导入其它 app 代码，纯数据 + 微型查表，
 *    无副作用、无外部依赖（客户端也可 import）。
 */

/** 解析层产出的情绪枚举（与 SCRIPT_PARSE_SYSTEM 的 6 值对齐）。 */
export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fear";

/** 情绪强度：低（日常）/ 中（明显）/ 高潮（爆发，最夸张）。 */
export type EmotionIntensity = "low" | "medium" | "climax";

/** 情绪语法输出：夸张表情词 + 漫画符号词（后者已按画风门控，可能为空）。 */
export interface EmotionGrammar {
  /** 夸张表情短语（英文，任何画风适用）。空串表示中性无需强调。 */
  expression: string;
  /** 漫画符号短语（英文，仅非写实画风；写实画风恒为空串）。 */
  symbols: string;
}

/** 中文情绪别名 → 规范情绪值（解析层偶发中文时兜底）。 */
const EMOTION_ALIASES: Record<string, Emotion> = {
  中性: "neutral",
  平静: "neutral",
  开心: "happy",
  高兴: "happy",
  喜悦: "happy",
  悲伤: "sad",
  难过: "sad",
  伤心: "sad",
  愤怒: "angry",
  生气: "angry",
  惊讶: "surprised",
  震惊: "surprised",
  恐惧: "fear",
  害怕: "fear",
  惊恐: "fear",
};

/** 规范化情绪值：未知/空回落 neutral，接受英文枚举与常见中文别名。 */
export function normalizeEmotion(emotion?: string | null): Emotion {
  const raw = emotion?.trim().toLowerCase();
  if (!raw) return "neutral";
  if (
    raw === "neutral" ||
    raw === "happy" ||
    raw === "sad" ||
    raw === "angry" ||
    raw === "surprised" ||
    raw === "fear"
  ) {
    return raw;
  }
  return EMOTION_ALIASES[emotion!.trim()] ?? "neutral";
}

/**
 * 夸张表情词表：emotion × intensity → 英文表情短语。
 * neutral 恒为空（无需强调）；其余随强度从收敛到爆发递进。
 */
const EXPRESSION_MAP: Record<Emotion, Record<EmotionIntensity, string>> = {
  neutral: { low: "", medium: "", climax: "" },
  happy: {
    low: "gentle warm smile, soft bright eyes",
    medium: "beaming joyful smile, sparkling eyes, flushed cheeks",
    climax:
      "exaggerated ecstatic expression, wide open joyful mouth, tightly shut happy eyes, radiant blushing face",
  },
  sad: {
    low: "downcast eyes, subtle frown, quivering lip",
    medium: "teary glistening eyes, trembling lips, sorrowful furrowed brows",
    climax:
      "exaggerated anguished expression, streaming tears, tightly clenched teary eyes, contorted crying mouth",
  },
  angry: {
    low: "narrowed eyes, tight jaw, faint frown",
    medium: "gritted teeth, sharply furrowed angry brows, glaring intense eyes",
    climax:
      "furious exaggerated expression, gritted bared teeth, blazing wide eyes, sharply slanted eyebrows, snarling mouth",
  },
  surprised: {
    low: "slightly widened eyes, raised eyebrows",
    medium: "widened eyes, parted lips, jolted expression",
    climax:
      "exaggerated shocked expression, huge dilated eyes, dropped jaw, stunned frozen face",
  },
  fear: {
    low: "tense wary eyes, stiff posture",
    medium: "wide fearful eyes, pale tense face, shrinking back",
    climax:
      "exaggerated terrified expression, bulging petrified eyes, sweating pale face, screaming open mouth",
  },
};

/**
 * 漫画符号词表：emotion × intensity → 英文符号短语（速度线/冲击帧/汗滴/爆青筋等）。
 * 仅在【非写实画风】+【medium/climax】时启用；low 与 neutral 恒空（避免符号泛滥）。
 */
const SYMBOL_MAP: Record<Emotion, Record<EmotionIntensity, string>> = {
  neutral: { low: "", medium: "", climax: "" },
  happy: {
    low: "",
    medium: "sparkle effects, soft glowing highlights",
    climax: "burst of sparkles, radial joy effect, floating heart motifs",
  },
  sad: {
    low: "",
    medium: "vertical gloom shading lines, single falling sweat drop",
    climax:
      "heavy vertical depression lines over the face, dramatic teardrop symbols, dark gloom background",
  },
  angry: {
    low: "",
    medium: "popped anger vein mark, subtle sharp background lines",
    climax:
      "anime rage effect, throbbing anger vein marks, radial speed lines background, flame aura motif",
  },
  surprised: {
    low: "",
    medium: "impact focus lines, small shock marks",
    climax:
      "impact frame, explosive radial focus lines, bold shock burst background",
  },
  fear: {
    low: "",
    medium: "trembling motion lines, cold sweat drops",
    climax:
      "jagged fear lines, heavy cold sweat drops, dark vignette dread background, trembling shake effect",
  },
};

/**
 * 写实/拟真类画风 id 集合——这些画风【禁用】漫画符号（速度线/冲击帧画上去会崩）。
 * 说明：3D/国风赛博虽是渲染，但仍是动画化风格，允许漫画符号；仅纯写实与油画禁用。
 */
const NO_MANGA_SYMBOL_STYLES: ReadonlySet<string> = new Set([
  "realistic",
  "oil",
]);

/** 判断画风是否允许漫画符号（写实/油画禁用，其余允许）。空/未知按允许处理（默认 anime 系）。 */
export function packAllowsMangaSymbols(style?: string | null): boolean {
  const id = style?.trim();
  if (!id) return true;
  return !NO_MANGA_SYMBOL_STYLES.has(id);
}

/**
 * 构建情绪语法：把「情绪 × 强度 × 画风」翻译成夸张表情词 + 漫画符号词。
 *
 * @param emotion   情绪（英文枚举或中文别名，未知回落 neutral）
 * @param intensity 情绪强度（缺省 medium；climax 最夸张）
 * @param style     画风 id（用于门控漫画符号；写实/油画返回空 symbols）
 */
export function buildEmotionGrammar(
  emotion?: string | null,
  intensity: EmotionIntensity = "medium",
  style?: string | null
): EmotionGrammar {
  const e = normalizeEmotion(emotion);
  const expression = EXPRESSION_MAP[e][intensity];
  const symbols = packAllowsMangaSymbols(style) ? SYMBOL_MAP[e][intensity] : "";
  return { expression, symbols };
}

/**
 * 便捷拼接：把情绪语法拼成一段可直接进 prompt 的短语（表情在前，符号在后）。
 * 两者皆空（如 neutral）返回空串，由调用方 filter 掉。
 */
export function buildEmotionPhrase(
  emotion?: string | null,
  intensity: EmotionIntensity = "medium",
  style?: string | null
): string {
  const { expression, symbols } = buildEmotionGrammar(
    emotion,
    intensity,
    style
  );
  return [expression, symbols].filter(Boolean).join(", ");
}

/**
 * 从 emotion + 景别 + 显式 isClimax 推断强度（供 DB 手动路径：Scene 未持久化
 * emotionIntensity 时的兜底）。
 * - 显式 isClimax=true → climax。
 * - neutral → low（中性无强度可言）。
 * - 特写/close-up 类景别 + 高唤醒情绪（angry/surprised/fear）→ climax（近景放大情绪）。
 * - 其余非中性 → medium。
 */
export function inferEmotionIntensity(
  emotion?: string | null,
  shotType?: string | null,
  isClimax?: boolean
): EmotionIntensity {
  if (isClimax) return "climax";
  const e = normalizeEmotion(emotion);
  if (e === "neutral") return "low";
  const shot = shotType?.trim().toLowerCase() ?? "";
  const isCloseShot =
    shot.includes("特写") ||
    shot.includes("close-up") ||
    shot.includes("close up") ||
    shot.includes("extreme close");
  const highArousal = e === "angry" || e === "surprised" || e === "fear";
  if (isCloseShot && highArousal) return "climax";
  return "medium";
}
