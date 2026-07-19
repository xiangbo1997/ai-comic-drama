/**
 * 视频（I2V）生成 Prompt 构建器
 *
 * 采用 Google Veo「五段式」公式并针对图生视频（I2V）重排：运镜优先、
 * 动作次之、氛围其后、连续性与音频指令收尾、负面词兜底。纯函数、无 LLM。
 *
 * 设计要点：
 * - 身份无关（identity-free）：身份前缀由 provider 单独 prepend，这里绝不内联，
 *   避免与 provider 双重注入。
 * - cameraMovement 在解析器里几乎恒为 null，所以运镜默认值由 shotType + emotion 派生。
 * - 刻意省略 colorPalette / composition：首帧已携带这两者，二次描述会导致片中色彩/光位漂移。
 * - 负面词区段必须纯 ASCII：服务端 contentSafetyMiddleware 会拦截中文敏感词
 *   （如「血腥」在 BLOCKED_KEYWORDS 中），中文负面词会导致请求自我 400。
 */

/** 视频场景 prompt 构建输入 */
export interface VideoScenePromptInput {
  /** 画面动作描述（中文，原样作为 Action 段） */
  description: string;
  /**
   * 运动节拍（中文，可选）：这一镜里"什么在动"。有值时 Action 段拼成
   * `${description}。${actionBeat}`（两段都中文），把静态画面描述补成运动指令。
   * 由解析层 LLM 或视频导演增强产出，禁止外貌描写/对白（喂前已内容安全过滤）。
   */
  actionBeat?: string | null;
  /** 项目风格：anime|realistic|comic|watercolor|cyberpunk|fantasy|3d|oil|sketch */
  style?: string | null;
  /** 景别：特写|近景|中景|全景|远景 */
  shotType?: string | null;
  /** 机位角度：eye-level|high-angle|low-angle|dutch-angle|over-the-shoulder|POV... */
  cameraAngle?: string | null;
  /** 运镜方向（解析器几乎恒为 null，缺省时按 shotType+emotion 派生） */
  cameraMovement?: string | null;
  /** 光线描述（DB 短字符串，直接透传） */
  lighting?: string | null;
  /** 情绪：neutral|happy|sad|angry|surprised|fear */
  emotion?: string | null;
  /**
   * 氛围覆盖（英文短语，可选）：由视频导演增强产出。有值时替换「情绪派生的
   * 氛围短语」（ATMOSPHERE_MAP[emotion]），让 LLM 精调的氛围（如
   * "quiet dread before the storm"）取代粗粒度情绪映射。风格短句/光线不受影响。
   */
  atmosphereOverride?: string | null;
  /** 视频时长（秒）；>=10 时追加运动弧线 */
  duration?: number;
  /** FL 首尾帧模式（插值本身即运镜，不再叠加其他运镜） */
  hasLastFrame?: boolean;
  /**
   * 本镜是否有对白（批3 引入）：有对白且景别为特写/近景/中景时，音频指令改为
   * 「角色自然口型开合（lip flap）」而非一刀切禁口型——闭嘴人物 + 画外配音是
   * 视频最大 AI 破绽。远景/无对白镜仍保持原「禁口型」文案（远景看不清嘴、无对白
   * 镜不该动嘴）。管线仍自叠 TTS 并丢弃模型音轨，故指令始终「no audible dialogue」。
   */
  hasDialogue?: boolean;
}

/** 景别 → 取景短语 */
const FRAMING_MAP: Record<string, string> = {
  特写: "Extreme close-up",
  近景: "Close-up",
  中景: "Medium shot",
  全景: "Full wide shot",
  远景: "Extreme wide establishing shot",
};

/** 机位角度 → 取景修饰后缀 */
const ANGLE_MODIFIER_MAP: Record<string, string> = {
  "low-angle": " from a low angle",
  "high-angle": " from a high angle",
  "dutch-angle": " with a slight Dutch tilt",
  "over-the-shoulder": " with over-the-shoulder framing",
  POV: " from a POV perspective",
  pov: " from a POV perspective",
};

/**
 * 合法运镜标识符（13 值枚举）。解析器 / 导演增强 / Zod 校验共用唯一真源，
 * 避免枚举在多处漂移。顺序与 CAMERA_MOVEMENT_MAP 键一致。
 */
export const CAMERA_MOVEMENTS = [
  "static",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "dolly_in",
  "dolly_out",
  "orbit",
  "tracking",
  "handheld",
  "crane",
] as const;

/** 运镜标识符字面量联合类型 */
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

/** 运镜标识符 → 视频模型可理解的复合运镜短语（升级自旧 12 个单动词） */
const CAMERA_MOVEMENT_MAP: Record<string, string> = {
  static:
    "locked-off static frame with only subtle in-scene motion (hair, cloth, breathing)",
  zoom_in: "slow, smooth push-in that gradually tightens on the subject",
  zoom_out: "gentle pull-out revealing more of the surrounding environment",
  dolly_in: "slow dolly-in on the subject with background parallax",
  dolly_out: "steady dolly-out revealing scale",
  pan_left: "smooth pan to the left, sweeping across the scene",
  pan_right: "smooth pan to the right, sweeping across the scene",
  tilt_up: "slow upward tilt",
  tilt_down: "slow downward tilt",
  orbit: "slow arc shot orbiting the subject",
  tracking:
    "smooth tracking shot following the subject at a steady distance with motion parallax",
  handheld: "subtle handheld movement for a raw documentary feel",
  crane: "crane shot rising to reveal the full scale of the scene",
};

/**
 * 把运镜标识符（zoom_in/pan_left/...）转成视频模型可理解的复合运镜短语。
 * 未知值以下划线转空格降级；空值返回空串（调用方据此决定是否拼接）。
 */
export function describeCameraMovement(movement?: string | null): string {
  if (!movement) return "";
  return CAMERA_MOVEMENT_MAP[movement] ?? movement.replace(/_/g, " ");
}

/** 情绪 → 氛围短语（video-specific，短） */
const ATMOSPHERE_MAP: Record<string, string> = {
  happy: "warm, uplifting mood",
  sad: "melancholic, subdued mood",
  angry: "tense, charged atmosphere",
  surprised: "sudden, startling beat",
  fear: "ominous, suspenseful tension",
};

/**
 * 风格 → 视频专用短句（不复用图像端冗长 getStylePrefix，避免 morphing）。
 * 每个 style id 一条极简短句；画风包新增的 5 个 id 同样给短句，未命中的 id
 * 由调用方（line 253 的 `input.style ? map[input.style] : undefined`）自动省略。
 */
const VIDEO_STYLE_MAP: Record<string, string> = {
  anime: "consistent 2D anime aesthetic",
  realistic: "photorealistic cinematic film look, natural physics",
  comic: "bold comic-book cel-shaded look",
  watercolor: "soft watercolor painterly motion",
  cyberpunk: "neon cyberpunk mood, high contrast",
  fantasy: "ethereal fantasy atmosphere",
  "3d": "polished 3D-rendered look",
  oil: "oil-painting texture in motion",
  sketch: "hand-drawn sketch aesthetic",
  // 画风包新增（Toonflow 改编）：短句化，保持「不 morphing」纪律
  anime90s: "retro 90s hand-drawn anime look, warm nostalgic tone",
  guofeng2d: "Chinese guofeng cel-shaded anime look, oriental elegance",
  anime3d: "cel-look 3D-rendered animation, warm healing tone",
  "guofeng-cyber": "guofeng-cyberpunk 3D render, oriental sci-fi mood",
  urban2d: "modern urban romance anime look, cool desaturated tone",
};

/** 通用负面词（纯 ASCII） */
const UNIVERSAL_NEGATIVES = [
  "on-screen text",
  "subtitles",
  "watermark",
  "extra limbs",
  "deformed hands",
  "face morphing",
  "flickering",
];

/** 情绪速度修饰：angry/surprised/fear 在特写/近景上偏快 */
const FAST_EMOTIONS = new Set(["angry", "surprised", "fear"]);

/** 取景段（景别 + 角度修饰）。无 shotType → 空串。 */
function buildFraming(
  shotType?: string | null,
  cameraAngle?: string | null
): string {
  if (!shotType) return "";
  const base = FRAMING_MAP[shotType];
  if (!base) return "";
  const modifier = cameraAngle ? (ANGLE_MODIFIER_MAP[cameraAngle] ?? "") : "";
  return `${base}${modifier}`;
}

/** 运镜段：FL 模式 / 显式 cameraMovement / 按 shotType+emotion 派生 三分支。 */
function buildCameraMove(input: VideoScenePromptInput): string {
  // a) FL 首尾帧模式：插值本身即运镜。此前直接覆盖运镜、丢弃导演的 13 值枚举意图；
  //    改为把导演/DB 的运镜短语并入 FL 文案（"...with {运镜}"），让运镜意图存活；
  //    无显式运镜时回落纯插值文案（旧行为）。
  if (input.hasLastFrame) {
    const base =
      "Smooth continuous camera motion that begins on the first frame and seamlessly transitions to end on the final frame";
    const movement = input.cameraMovement
      ? describeCameraMovement(input.cameraMovement)
      : "";
    return movement ? `${base}, with ${movement}` : base;
  }

  // b) 显式 cameraMovement
  if (input.cameraMovement) {
    return describeCameraMovement(input.cameraMovement);
  }

  // c) cameraMovement 为空（常态）：按 shotType 派生默认运镜
  const { shotType, emotion } = input;
  const fast = emotion ? FAST_EMOTIONS.has(emotion) : false;

  if (shotType === "特写" || shotType === "近景") {
    return fast
      ? "quick, decisive push-in"
      : "slow, smooth push-in, building intimacy";
  }
  if (shotType === "中景") {
    return fast
      ? "steady tracking shot with subtle handheld energy"
      : "slow dolly-in toward the subject";
  }
  if (shotType === "全景" || shotType === "远景") {
    return "slow, cinematic pull-out revealing the environment";
  }
  // 无 shotType
  return "gentle, slow camera drift with subtle in-scene motion";
}

/** 连续性段（固定）：FL 模式与普通 I2V 文案不同。 */
function buildContinuity(hasLastFrame?: boolean): string {
  return hasLastFrame
    ? "Maintain character and setting continuity across the transition"
    : "Maintain the exact character appearance, outfit, and setting from the first frame; consistent lighting throughout";
}

/** 无对白 / 远景镜的音频指令：禁口型（管线自叠 TTS 并丢弃模型音轨）。 */
const AUDIO_DIRECTIVE_SILENT =
  "No spoken dialogue, no lip-sync, ambient sound only";

/**
 * 有对白且景别看得清嘴（特写/近景/中景）的音频指令：角色自然口型开合（lip flap）。
 *
 * 漫剧行业标准是「模糊的动漫式口型开合」（对不上音素但嘴在动），不是音素级精确唇
 * 同步——闭嘴人物 + 画外配音才是第一视觉 AI 破绽。仍声明「no audible dialogue」，
 * 因管线自叠 TTS、丢弃模型音轨。
 */
const AUDIO_DIRECTIVE_LIP_FLAP =
  "Character speaks with natural anime-style mouth movement (lip flap), no audible dialogue, ambient sound only";

/** 看得清嘴的景别（特写/近景/中景）：这些景别有对白才输出 lip flap。 */
const LIP_FLAP_SHOT_TYPES = new Set(["特写", "近景", "中景"]);

/**
 * 音频指令：有对白 + 景别看得清嘴 → lip flap；否则禁口型。
 * FL 首尾帧模式不特殊处理（插值本身不涉及口型，沿用景别判据）。
 */
function buildAudioDirective(input: VideoScenePromptInput): string {
  const shotVisible = input.shotType
    ? LIP_FLAP_SHOT_TYPES.has(input.shotType)
    : false;
  return input.hasDialogue && shotVisible
    ? AUDIO_DIRECTIVE_LIP_FLAP
    : AUDIO_DIRECTIVE_SILENT;
}

/** 负面词段（纯 ASCII）：通用列表 + 按风格分支，合并后上限 9 条。 */
function buildNegatives(style?: string | null): string {
  const negatives = [...UNIVERSAL_NEGATIVES];
  if (style === "anime" || style === "comic" || style === "watercolor") {
    negatives.push("photorealistic rendering", "live-action look");
  } else if (style === "realistic") {
    negatives.push("cartoon", "anime", "plastic texture");
  }
  return `Avoid: ${negatives.slice(0, 9).join(", ")}`;
}

/** 长度上限（字符）。超限时按优先级丢弃整段。 */
const LENGTH_LIMIT = 900;

/**
 * 构建统一的视频场景 prompt。
 *
 * 段落顺序（Veo 五段式，I2V 适配）：
 * ① 运镜（取景 + 机位）② 动作（原中文 description）③ 氛围（情绪 + 风格 + 光线）
 * ④ 运动弧线（duration>=10 且非 FL）⑤ 连续性 ⑥ 音频指令 ⑦ 负面词
 *
 * 空段跳过；用 ". " 连接；末尾以负面词句收尾。
 * 超过 900 字符时按 lighting → atmosphere → arc → style 短句 优先级丢弃整段
 * （绝不丢 description/运镜/连续性/音频/负面词，绝不中途截断）。
 */
export function buildVideoScenePrompt(input: VideoScenePromptInput): string {
  const framing = buildFraming(input.shotType, input.cameraAngle);
  const cameraMove = buildCameraMove(input);
  // 取景 + 运镜合成运镜段（取景可空）
  const cinematography = [framing, cameraMove].filter(Boolean).join(", ");

  // Action 段：description 打底；有 actionBeat 时中文拼接补成运动指令
  // （静态画面 + 运动节拍 → 视频模型可执行的动作描述）。
  const actionBeat = input.actionBeat?.trim();
  const baseAction = input.description.trim();
  const action = actionBeat ? `${baseAction}。${actionBeat}` : baseAction;

  // 氛围：导演增强的 atmosphereOverride 优先，否则回落情绪派生映射。
  const overrideAtmosphere = input.atmosphereOverride?.trim();
  const atmosphere =
    overrideAtmosphere ||
    (input.emotion ? ATMOSPHERE_MAP[input.emotion] : undefined);
  const styleClause = input.style ? VIDEO_STYLE_MAP[input.style] : undefined;
  const lighting = input.lighting?.trim() || undefined;

  const arc =
    typeof input.duration === "number" &&
    input.duration >= 10 &&
    !input.hasLastFrame
      ? "Beginning steady, then gradually intensifying the movement toward the end"
      : undefined;

  const continuity = buildContinuity(input.hasLastFrame);
  const audioDirective = buildAudioDirective(input);
  const negatives = buildNegatives(input.style);

  // 组装氛围段的辅助：从三个可选片段（可被长度守卫单独丢弃）拼出逗号串。
  // 氛围段落作为句子开头，故首字母大写（映射值为小写，如 melancholic → Melancholic）。
  const assembleAmbiance = (
    keepAtmosphere: boolean,
    keepStyle: boolean,
    keepLighting: boolean
  ): string => {
    const parts: string[] = [];
    if (keepAtmosphere && atmosphere) parts.push(atmosphere);
    if (keepStyle && styleClause) parts.push(styleClause);
    if (keepLighting && lighting) parts.push(lighting);
    const joined = parts.join(", ");
    return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : "";
  };

  // 组装整段：氛围三片段的保留开关由长度守卫控制
  const assemble = (
    keepLighting: boolean,
    keepAtmosphere: boolean,
    keepArc: boolean,
    keepStyle: boolean
  ): string => {
    const ambiance = assembleAmbiance(keepAtmosphere, keepStyle, keepLighting);
    const sections = [
      cinematography,
      action,
      ambiance,
      keepArc ? arc : undefined,
      continuity,
      audioDirective,
      negatives,
    ].filter((s): s is string => Boolean(s && s.trim()));
    // 各段以 ". " 连接，整体以句号收尾（每段读作完整句子）
    return sections.length > 0 ? `${sections.join(". ")}.` : "";
  };

  // 长度守卫：按 lighting → atmosphere → arc → style 优先级逐个丢弃整段
  const dropOrder: Array<[boolean, boolean, boolean, boolean]> = [
    [true, true, true, true], // 全保留
    [false, true, true, true], // 丢 lighting
    [false, false, true, true], // 再丢 atmosphere
    [false, false, false, true], // 再丢 arc
    [false, false, false, false], // 再丢 style 短句
  ];

  let result = assemble(true, true, true, true);
  for (const [keepLighting, keepAtmosphere, keepArc, keepStyle] of dropOrder) {
    result = assemble(keepLighting, keepAtmosphere, keepArc, keepStyle);
    if (result.length <= LENGTH_LIMIT) break;
  }

  return result;
}
