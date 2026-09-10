/**
 * TTS 情绪映射（纯函数，无 IO）
 *
 * Scene.emotion 一直落库却从未进入配音链，导致「新闻播报腔」——单调朗读是配音最
 * 大的 AI 破绽。此模块把项目内部情绪枚举映射到各 TTS provider 的情绪表达能力：
 *   - 火山 bigtts：原生 emotion 参数（mapEmotionToVolcengine）；
 *   - ElevenLabs：无独立 emotion 参数，用 voice_settings 的 stability/style
 *     近似表达（mapEmotionToElevenLabs）。
 *
 * 情绪枚举（与 Scene.emotion / video-prompt.ts 对齐）：
 *   neutral | happy | sad | angry | surprised | fear
 * neutral 视为「无情绪」——两个映射都返回不做调整的信号，保持 provider 默认。
 */

/** 项目内部情绪枚举（与 Scene.emotion 对齐；neutral 表示无特定情绪） */
export type SceneEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fear";

/**
 * 火山 bigtts 支持的情绪值（保守子集）。neutral 不下发 emotion 参数（省略）。
 * 映射到火山官方情绪枚举：开心/悲伤/愤怒/惊讶/恐惧（官方 HTTP 接口文档 6561/1257584，
 * 仅「多情感音色」支持；不支持的音色会报错，由 provider 层无情绪重试兜底）。
 */
const VOLCENGINE_EMOTION_MAP: Record<SceneEmotion, string | undefined> = {
  neutral: undefined,
  happy: "happy",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  fear: "fear",
};

/**
 * 把项目情绪映射到火山 bigtts 的 emotion 值。
 *
 * @param emotion Scene.emotion（可空/未知值按 neutral 处理）
 * @returns 火山 emotion 值；neutral / 未知 → undefined（不下发 emotion 参数）
 */
export function mapEmotionToVolcengine(
  emotion?: string | null
): string | undefined {
  if (!emotion) return undefined;
  const key = emotion.trim().toLowerCase() as SceneEmotion;
  return VOLCENGINE_EMOTION_MAP[key];
}

/** ElevenLabs voice_settings 的情绪化覆盖（相对默认的增量，仅在有情绪时应用） */
export interface ElevenLabsEmotionSettings {
  /** 稳定度（0–1）：越低越有表现张力，越高越平稳 */
  stability: number;
  /** 风格强度（0–1）：越高越戏剧化 */
  style: number;
}

/**
 * ElevenLabs 情绪化 voice_settings 覆盖（保守区间）。
 * 默认 stability=0.5 / style=0（provider 现状）；此表按情绪微调：
 *   - 高唤醒（angry/surprised/fear）：降 stability + 升 style → 更有张力；
 *   - 低唤醒（sad）：升 stability + 略升 style → 沉稳克制；
 *   - happy：略降 stability + 升 style → 轻快。
 * neutral 不在表中（返回 undefined，保持 provider 默认设置）。
 */
const ELEVENLABS_EMOTION_MAP: Partial<
  Record<SceneEmotion, ElevenLabsEmotionSettings>
> = {
  happy: { stability: 0.4, style: 0.35 },
  sad: { stability: 0.7, style: 0.2 },
  angry: { stability: 0.3, style: 0.5 },
  surprised: { stability: 0.35, style: 0.45 },
  fear: { stability: 0.4, style: 0.4 },
};

/**
 * 把项目情绪映射到 ElevenLabs voice_settings 覆盖。
 *
 * @param emotion Scene.emotion（可空/未知/neutral → undefined 保持默认）
 * @returns 情绪化 voice_settings 覆盖；无情绪时 undefined
 */
export function mapEmotionToElevenLabs(
  emotion?: string | null
): ElevenLabsEmotionSettings | undefined {
  if (!emotion) return undefined;
  const key = emotion.trim().toLowerCase() as SceneEmotion;
  return ELEVENLABS_EMOTION_MAP[key];
}

/**
 * 情绪 → 语速系数。
 *
 * 表演不只是换个音色：愤怒/惊讶要抢拍，悲伤/恐惧要拖住。此前旁白与对白
 * 共用同一个 emotion 和同一个语速，悲伤的镜头里两者都用 1.1x 快语速冲过去，
 * 该慢的地方没慢下来——这是表演最忌讳的。
 *
 * 数值取配音导演的常用区间；乘到基准语速后由调用方 clamp 到 provider 合法域
 * （gpt-sovits 的 SPEED_MIN/MAX 为 0.5-2.0）。
 */
const EMOTION_SPEED_FACTOR: Record<SceneEmotion, number> = {
  neutral: 1.0,
  happy: 1.05,
  sad: 0.9,
  angry: 1.15,
  surprised: 1.2,
  fear: 1.1,
};

/** 语速合法域（与 gpt-sovits provider 的 SPEED_MIN/MAX 契约一致） */
const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;

/**
 * 按情绪调整语速。未知/空情绪返回基准值本身（零回归）。
 * 结果 clamp 到 0.5-2.0，避免叠加用户自定义语速后越界被 provider 拒绝。
 */
export function applyEmotionSpeed(
  baseSpeed: number,
  emotion?: string | null
): number {
  if (!emotion) return baseSpeed;
  const key = emotion.trim().toLowerCase() as SceneEmotion;
  const factor = EMOTION_SPEED_FACTOR[key];
  if (!factor) return baseSpeed;
  const adjusted = baseSpeed * factor;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, adjusted));
}

/**
 * 旁白语速系数：比对白慢 5%。
 *
 * 旁白是说书人不是角色——它的职责是交代信息、控制节奏。跟着角色情绪一起
 * 愤怒是外行做法（"三年后，林家大宅"用暴怒语气念，听感极其怪异）。
 * 工业配置是旁白恒中性 + 略慢于对白。
 */
export const NARRATION_SPEED_FACTOR = 0.95;
