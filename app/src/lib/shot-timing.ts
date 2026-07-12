/**
 * 单镜时长确定性计算（对标动漫工业「タイムシート」秒表掐镜）。
 *
 * 断裂修复：此前 duration 由 LLM 拍脑袋填 1-60s，与对白字数无确定关系，导致
 * 配音 / 字幕 / 视频长度三者对不齐（历史反复修的「视频时长对齐」类 bug 的上游根因）。
 *
 * 专业依据（三份调研收敛）：
 * - 对白镜时长 = 台词朗读时长；中文口播 ~2.5 字/秒（漫剧行业惯例，估台词镜长）。
 * - 快节奏冲突/反转镜以近景/特写为主，单镜 1-2s；铺垫/信息镜 2-4s；情绪特写 2-3s。
 *   与 lib/prompts/episode-structure.ts 的 SHOT_RHYTHM_RULES 数值同源，避免漂移。
 *
 * 纯函数、无 IO、无 LLM。校准而非替换 LLM：
 * - 有对白：时长不得短于对白朗读时长（保证配音不被截断），且不短于景别下限。
 * - 无对白：按景别 + 情绪派生。
 * - 始终尊重 LLM 给的值作为「叙事意图」：若 LLM 值落在 [算出下限, 合理上限] 内则采信，
 *   否则夹到区间——只纠正明显不合理（对白镜太短 / 空镜拉太长）的值。
 */

/** 中文口播速率：字 / 秒（漫剧行业估算惯例） */
const CN_CHARS_PER_SEC = 2.5;

/** 英文口播速率：词 / 秒（~150 wpm） */
const EN_WORDS_PER_SEC = 2.5;

/** 单镜绝对下限 / 上限（秒）——与 SHOT_RHYTHM_RULES 对齐，允许长动作分段 */
const ABSOLUTE_MIN = 1;
const ABSOLUTE_MAX = 60;

/** 无对白时按景别派生的基础时长（秒）：冲突镜短、铺垫镜长 */
const SHOT_TYPE_BASE: Record<string, number> = {
  特写: 2.5,
  近景: 2.5,
  中景: 3,
  全景: 3.5,
  远景: 4,
};

/** 快节奏情绪：这些情绪下单镜更短更密（冲突 / 反转瞬间） */
const FAST_EMOTIONS = new Set(["angry", "surprised", "fear"]);

/** 有对白时按景别的最低时长（保证画面不因对白极短而闪切） */
const SHOT_TYPE_DIALOGUE_MIN: Record<string, number> = {
  特写: 1.5,
  近景: 1.5,
  中景: 2,
  全景: 2,
  远景: 2.5,
};

export interface ShotTimingInput {
  /** 对白（中文为主）；null / 空视为无对白 */
  dialogue?: string | null;
  /** 旁白；有旁白也按口播时长兜底（旁白也要念完） */
  narration?: string | null;
  /** 景别：特写|近景|中景|全景|远景 */
  shotType?: string | null;
  /** 情绪：neutral|happy|sad|angry|surprised|fear */
  emotion?: string | null;
  /** LLM 给的原始时长（作为叙事意图参考，落在合理区间则采信） */
  llmDuration?: number | null;
}

/**
 * 估算一段中文 / 混合文本的口播时长（秒）。
 * 中文按字数 / 2.5；连续 ASCII 词按词数 / 2.5；两者相加，保留小数（不取整）。
 */
export function estimateSpeechSeconds(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  // 表意字符（汉字/假名）逐字计：用 Unicode 脚本属性，避免手写码点区间出错
  const cjkCount = (
    trimmed.match(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/gu) ??
    []
  ).length;
  // 连续 ASCII 字母数字串按「词」计
  const enWords = (trimmed.match(/[A-Za-z0-9]+/g) ?? []).length;

  const cjkSeconds = cjkCount / CN_CHARS_PER_SEC;
  const enSeconds = enWords / EN_WORDS_PER_SEC;
  return cjkSeconds + enSeconds;
}

/**
 * 计算单镜确定性时长（秒，整数）。
 *
 * 逻辑：
 * 1. 算「口播下限」= 对白 + 旁白 的朗读时长（二者叠加，因为都要念完）。
 * 2. 算「景别下限」：有台词用 SHOT_TYPE_DIALOGUE_MIN，无台词用 SHOT_TYPE_BASE
 *    （快情绪再打 0.7 折，让冲突镜更短更密）。
 * 3. floor = max(口播下限, 景别下限, ABSOLUTE_MIN)。
 * 4. 若 LLM 值 >= floor 且 <= 合理上限，采信 LLM（尊重叙事意图，如长动作镜）。
 *    否则取 floor 向上取整（对白镜被 LLM 填太短时，强制补到能念完）。
 * 5. 全程夹在 [ABSOLUTE_MIN, ABSOLUTE_MAX]。
 */
export function computeShotDuration(input: ShotTimingInput): number {
  const dialogue = input.dialogue?.trim() ?? "";
  const narration = input.narration?.trim() ?? "";
  const hasSpeech = dialogue.length > 0 || narration.length > 0;

  // 1. 口播下限：对白与旁白都要念完，时长叠加
  const speechFloor =
    estimateSpeechSeconds(dialogue) + estimateSpeechSeconds(narration);

  // 2. 景别下限
  const shotType = input.shotType ?? "";
  let shotFloor: number;
  if (hasSpeech) {
    shotFloor = SHOT_TYPE_DIALOGUE_MIN[shotType] ?? 2;
  } else {
    const base = SHOT_TYPE_BASE[shotType] ?? 3;
    const fast = input.emotion ? FAST_EMOTIONS.has(input.emotion) : false;
    shotFloor = fast ? base * 0.7 : base;
  }

  // 3. 综合下限
  const floor = Math.max(speechFloor, shotFloor, ABSOLUTE_MIN);

  // 4. LLM 值裁决：落在 [floor, 合理上限] 内则采信
  const llm = input.llmDuration;
  // 合理上限：无对白空镜不宜超过 8s（防 LLM 凑时长拉长空镜）；
  // 有对白/长动作时按 floor 放宽，允许长台词镜。
  const softCeiling = Math.max(floor, hasSpeech ? floor + 4 : 8);
  if (
    typeof llm === "number" &&
    llm >= floor &&
    llm <= Math.max(softCeiling, floor)
  ) {
    return clamp(Math.round(llm));
  }

  // 5. 否则取下限向上取整
  return clamp(Math.ceil(floor));
}

/** 夹到 [ABSOLUTE_MIN, ABSOLUTE_MAX] 的整数 */
function clamp(n: number): number {
  return Math.min(ABSOLUTE_MAX, Math.max(ABSOLUTE_MIN, Math.round(n)));
}

/** 可被时长校准的分镜的最小形状（两条解析路径的 scene 都满足） */
export interface CalibratableScene {
  shotType?: string | null;
  dialogue?: string | null;
  narration?: string | null;
  emotion?: string | null;
  duration?: number | null;
}

/**
 * 批量校准分镜时长（immutable：返回带新 duration 的浅拷贝数组）。
 *
 * 用于解析层产出后、落库前统一把 LLM 拍脑袋的 duration 校准为「对白驱动的
 * 确定值」。下游（视频分段 / TTS / 导出时轴）无需改动即受益。
 *
 * 泛型保留原 scene 的所有其它字段，只覆盖 duration。
 */
export function calibrateSceneDurations<T extends CalibratableScene>(
  scenes: T[]
): T[] {
  return scenes.map((scene) => ({
    ...scene,
    duration: computeShotDuration({
      dialogue: scene.dialogue,
      narration: scene.narration,
      shotType: scene.shotType,
      emotion: scene.emotion,
      llmDuration: scene.duration ?? null,
    }),
  }));
}
