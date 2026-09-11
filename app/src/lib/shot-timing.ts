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

import { normalizeShotType } from "./shot-type-normalize";

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

/**
 * 开场镜数：前 N 镜按开场快切处理。
 * 竖屏短剧的 3 秒定生死，开场要 3-5 个镜头砸完，单镜 0.6-1.0s。
 */
const OPENING_SHOT_COUNT = 3;

/** 开场镜的下限系数：把景别/情绪算出的 floor 压到约一半 */
const OPENING_FLOOR_FACTOR = 0.55;

/**
 * 开场镜的绝对下限（秒）——**低于 ABSOLUTE_MIN**，这是刻意的。
 *
 * 原实现里「口播下限 + 景别下限先取 max」导致实际没有任何镜能低于 1.5s，
 * 开场快切在物理上不可能出现。开场镜通常无对白或只念半句，允许压到 0.8s。
 */
const OPENING_ABSOLUTE_MIN = 0.8;

/**
 * 开场镜「可忽略的口播时长」阈值（秒）。
 * 口播不超过此值（约 2 个字 / 1 个词）视为「无实质台词」，允许压到开场下限；
 * 超过则以口播下限为准，保证台词念得完。
 */
const OPENING_SPEECH_TOLERANCE = 0.8;

/** 高潮镜的下限系数：高潮段单镜 0.8-1.5s，比常规更密 */
const CLIMAX_FLOOR_FACTOR = 0.7;

/** 结尾钩子镜的下限系数与硬下限（秒）：最后一镜要留白，让钩子沉下去 */
const ENDING_FLOOR_FACTOR = 1.3;
const ENDING_MIN = 2.5;

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

  // ---- 以下为「全片节奏曲线」的位置上下文（全部可选，缺省即退回逐镜独立计算） ----

  /** 本镜在全片中的下标（0 起）。缺省时不套用任何节奏系数（零回归） */
  sceneIndex?: number;
  /** 全片总镜数。与 sceneIndex 配合判断「是否最后一镜」 */
  totalScenes?: number;
  /** 解析层落库的高潮标记 */
  isClimax?: boolean | null;
  /** 解析层落库的节拍类型：impact / reveal / emotional / calm */
  beatType?: string | null;
}

/** 节奏段落（供日志/测试断言，也让分支意图自解释） */
type PacingPhase = "opening" | "climax" | "ending" | "normal";

/**
 * 判定本镜属于哪个节奏段落。
 *
 * 优先级（互斥，从强到弱）：
 * 1. `ending`——最后一镜。结尾钩子要留白，优先级高于开场/高潮：
 *    极短剧（如 3 镜）里「最后一镜」同时也落在开场窗口内，此时必须按结尾处理，
 *    否则全片最后一个镜头被压到 0.8s，钩子还没看清就黑屏了。
 * 2. `opening`——前 3 镜。开场 3 秒定生死，优先级高于高潮：
 *    冷开场（直接从高潮切入，isClimax=true）正是要快切，两者诉求一致。
 * 3. `climax`——isClimax 或 impact 节拍。
 * 4. `normal`——其余，不套用系数。
 */
function resolvePacingPhase(input: ShotTimingInput): PacingPhase {
  const { sceneIndex, totalScenes } = input;
  if (typeof sceneIndex !== "number") return "normal";

  if (
    typeof totalScenes === "number" &&
    totalScenes > 0 &&
    sceneIndex === totalScenes - 1
  ) {
    return "ending";
  }

  if (sceneIndex < OPENING_SHOT_COUNT) return "opening";

  if (
    input.isClimax === true ||
    input.beatType?.trim().toLowerCase() === "impact"
  ) {
    return "climax";
  }

  return "normal";
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

  // 2. 景别下限。查表前归一：复合值（「大特写·急推」）与别名（「大全景」）在
  //    精确匹配下必然 miss，全片景别时长差异被抹平成统一的 3s/2s 兜底。
  const shotType = normalizeShotType(input.shotType) ?? "";
  let shotFloor: number;
  if (hasSpeech) {
    shotFloor = SHOT_TYPE_DIALOGUE_MIN[shotType] ?? 2;
  } else {
    const base = SHOT_TYPE_BASE[shotType] ?? 3;
    const fast = input.emotion ? FAST_EMOTIONS.has(input.emotion) : false;
    shotFloor = fast ? base * 0.7 : base;
  }

  // 3. 综合下限
  const rawFloor = Math.max(speechFloor, shotFloor, ABSOLUTE_MIN);

  // 3.5 全片节奏曲线：按本镜在全片中的位置调整下限。
  //
  // 此前 computeShotDuration 只看单镜自身（对白字数 + 景别 + 情绪），入参不含任何
  // 位置信息——不知道这镜是第几镜、是否在开场 3 秒内、是否临近高潮。结果是全片
  // 机械等长，而等长节奏 = 催眠。行业标准的竖屏短剧节奏曲线：
  //   开场 0-3s：0.6-1.0s 快切 3-5 个镜头  |  铺垫段：2.5-4s
  //   高潮段：0.8-1.5s                      |  结尾钩子最后一镜：2.5-3.5s 留白
  // 全片 ASL 目标 2.0-2.8s。
  //
  // 缺省 sceneIndex 时 phase 恒为 "normal"、floor === rawFloor，与改动前逐字等价。
  const phase = resolvePacingPhase(input);
  const floor = applyPacingFloor(rawFloor, phase, speechFloor);

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

  // 5. 否则取下限取整。
  //
  // 常规镜向上取整（`ceil`）：下限是「至少要这么长」的硬约束——有对白时向下取整
  // 会让台词念不完。但**无实质台词的开场快切镜例外**：此时下限不保护任何口播，
  // 而 ceil 会把 1.375s 顶成 2s，开场压缩被取整悄悄吃掉一半，
  // 「实际没有任何镜能低于 1.5s」的老毛病换个形式复发。故改用四舍五入，
  // 让 1.375 → 1s（DB 的 Int 列能表达的最快快切）。
  const roundsDown =
    phase === "opening" && speechFloor <= OPENING_SPEECH_TOLERANCE;
  return clamp(roundsDown ? Math.round(floor) : Math.ceil(floor));
}

/** 夹到 [ABSOLUTE_MIN, ABSOLUTE_MAX] 的整数 */
function clamp(n: number): number {
  return Math.min(ABSOLUTE_MAX, Math.max(ABSOLUTE_MIN, Math.round(n)));
}

/**
 * 按节奏段落调整下限。纯函数，`phase === "normal"` 时原样返回（零回归）。
 *
 * 开场镜是唯一**允许突破口播下限**的段落：开场快切镜通常无对白或只念半句，
 * 若仍被口播下限顶住就永远快不起来（这正是「实际没有任何镜能低于 1.5s」的根因）。
 * 但突破是有条件的——`speechFloor <= OPENING_SPEECH_TOLERANCE` 时才放行。
 * 有整句台词的开场镜（口播 3s）绝不能压到 0.8s，否则配音被硬生生截断，
 * 这比节奏平淡严重得多。
 *
 * ⚠️ 已知精度损失：`Scene.duration` 在 DB 里是 `Int`（见 prisma/schema.prisma），
 * 故 0.8s 落库后会被 `clamp` 取整成 1s，行业标准的 0.6-1.0s 开场快切实际只能
 * 做到 1s。要真正落地亚秒级需把该列改为 Float/Decimal——属 schema 变更，
 * 本次未做（见交付报告）。当前实现已把「开场比常规短一半」这层节奏差做出来了。
 */
function applyPacingFloor(
  rawFloor: number,
  phase: PacingPhase,
  speechFloor: number
): number {
  switch (phase) {
    case "opening": {
      const compressed = rawFloor * OPENING_FLOOR_FACTOR;
      // 有实质对白时不突破口播下限，只在 [口播下限, rawFloor] 间压缩
      if (speechFloor > OPENING_SPEECH_TOLERANCE) {
        return Math.max(compressed, speechFloor);
      }
      return Math.max(compressed, OPENING_ABSOLUTE_MIN);
    }
    case "climax": {
      // 高潮镜同样不截断对白：压缩后不得低于口播下限
      const compressed = rawFloor * CLIMAX_FLOOR_FACTOR;
      return Math.max(compressed, speechFloor, ABSOLUTE_MIN);
    }
    case "ending":
      // 结尾钩子拉长留白；口播更长时以口播为准（念完优先）
      return Math.max(rawFloor * ENDING_FLOOR_FACTOR, ENDING_MIN, speechFloor);
    case "normal":
      return rawFloor;
  }
}

/**
 * 判断某镜是否豁免「剪辑裁剪」（批2 剪辑节奏回归）。
 *
 * 常规漫剧单镜 1–4s 快切，provider 返回的 5–8s 片段应被裁到叙事目标时长。
 * 但高潮 / 动作 / 大动态镜需要完整时长承载动作弧线，不应被砍尾——否则动作
 * 半途截断（挥拳到一半、转身没转完）。判据分两层：
 *
 * 强信号（解析层已落库的显式标注，优先级最高，命中即豁免）：
 * - isClimax === true：解析层判定的高潮镜，成片的情绪顶点，必须保完整时长。
 * - beatType === "impact"：冲击节拍（爆点/反转瞬间），动作弧线不容截断。
 *
 * 启发式（强信号缺失时的兜底，沿用原判据）：
 * - 快节奏情绪（angry/surprised/fear）：冲突 / 反转瞬间，动作往往需要完整呈现。
 * - actionBeat 存在且非空：LLM/导演标注了「这一镜什么在动」，说明是动作镜。
 * - 叙事目标时长本就较长（≥6s）：长镜是刻意设计（长台词 / 慢推），不该裁。
 *
 * 这些判据都在解析层 / DB 可得，故豁免决策放在调用方（route / workflow，二者
 * 都有 scene 数据）而非 segmented-video（只有秒数）。缺省不豁免（裁剪，恢复快节奏）。
 */
export function isTrimExemptShot(input: {
  emotion?: string | null;
  actionBeat?: string | null;
  targetDuration?: number | null;
  /** 解析层落库的高潮标记（强信号，命中直接豁免） */
  isClimax?: boolean | null;
  /** 解析层落库的节拍类型（强信号，"impact" 直接豁免） */
  beatType?: string | null;
}): boolean {
  // 强信号优先：显式标注比情绪启发式可靠得多
  if (input.isClimax === true) return true;
  if (input.beatType?.trim().toLowerCase() === "impact") return true;

  const fastEmotion = input.emotion ? FAST_EMOTIONS.has(input.emotion) : false;
  const hasActionBeat = Boolean(input.actionBeat?.trim());
  const isLongShot =
    typeof input.targetDuration === "number" && input.targetDuration >= 6;
  return fastEmotion || hasActionBeat || isLongShot;
}

/** 可被时长校准的分镜的最小形状（两条解析路径的 scene 都满足） */
export interface CalibratableScene {
  shotType?: string | null;
  dialogue?: string | null;
  narration?: string | null;
  emotion?: string | null;
  duration?: number | null;
  /** 高潮标记（解析层落库）；驱动高潮段的节奏压缩 */
  isClimax?: boolean | null;
  /** 节拍类型（解析层落库）；"impact" 与 isClimax 等效触发高潮段 */
  beatType?: string | null;
}

/**
 * 批量校准分镜时长（immutable：返回带新 duration 的浅拷贝数组）。
 *
 * 用于解析层产出后、落库前统一把 LLM 拍脑袋的 duration 校准为「对白驱动的
 * 确定值」。下游（视频分段 / TTS / 导出时轴）无需改动即受益。
 *
 * 数组下标即分镜顺序（两条调用路径都在落库前、按下标写 order），故直接用
 * index/length 作为节奏曲线的位置上下文——开场前 3 镜快切、高潮镜压缩、
 * 末镜留白。
 *
 * 泛型保留原 scene 的所有其它字段，只覆盖 duration。
 */
export function calibrateSceneDurations<T extends CalibratableScene>(
  scenes: T[]
): T[] {
  return scenes.map((scene, index) => ({
    ...scene,
    duration: computeShotDuration({
      dialogue: scene.dialogue,
      narration: scene.narration,
      shotType: scene.shotType,
      emotion: scene.emotion,
      llmDuration: scene.duration ?? null,
      sceneIndex: index,
      totalScenes: scenes.length,
      isClimax: scene.isClimax,
      beatType: scene.beatType,
    }),
  }));
}
