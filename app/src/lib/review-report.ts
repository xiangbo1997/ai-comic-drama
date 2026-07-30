/**
 * 全片审片报告纯逻辑（计划 §6 · 3.2）
 *
 * 导出前的确定性体检：不调 LLM、不做 IO——把已落库的分镜数据 + 结尾钩子 +
 * 2.3 连贯性摘要拼成一份「时长节奏 / 结尾钩子 / 连贯性 / 完整性」四节报告，
 * 附可跳转到对应分镜的修改建议清单。快、免费、可靠。
 *
 * 阈值单一真源（不自造新数值，全部派生自既有专业规则）：
 * - 对白朗读时长：estimateSpeechSeconds（lib/shot-timing.ts，中文 2.5 字/秒）——
 *   若「对白+旁白朗读时长 > 时长」则配音会被截断（对白超时）。
 * - 无对白空镜上限 8s：lib/shot-timing.ts 的 softCeiling（无对白空镜不宜超过 8s，
 *   防 LLM 凑时长拉长空镜），与 SHOT_RHYTHM_RULES「超过 5 秒必须有明确叙事理由」同源。
 * - 每分钟镜数 15-25：lib/prompts/episode-structure.ts 的 EPISODE_PACING_RULES
 *   （每 15-20 秒一个信息增量、台词密度 12-18 句/分钟 + 竖屏短切为常态）蒸馏出的
 *   合理镜频区间；低于 15 = 镜头偏长拖沓，高于 25 = 碎切疲劳。
 *
 * 等级复用 2.3 的 A/B/C/D 思路：按「异常节」数量降级（见 computeGrade 注释）。
 *
 * ── 时间轴约定 ──
 * 本文件的 duration 一律是「成片轴」时长（已按逐镜倍速换算，= DB scene.duration / speed），
 * 由 route 层从 generationParams.sceneEffects 取 speed 算好后传入；台词朗读时长同样按
 * speechSpeed 换算（导出端给配音挂了同一 speed 的 atempo）。故本文件内不出现任何倍速逻辑，
 * 所有阈值都直接对着成片实际秒数比较。
 */

import { estimateSpeechSeconds } from "@/lib/shot-timing";
import type { HookType } from "@/types/series-bible";

/** 每分钟镜数合理区间下限（源自 EPISODE_PACING_RULES 信息增量节奏） */
const SHOTS_PER_MIN_MIN = 15;
/** 每分钟镜数合理区间上限（超出即碎切疲劳） */
const SHOTS_PER_MIN_MAX = 25;
/** 无对白空镜时长上限（秒）——source: shot-timing.ts softCeiling */
const SILENT_SHOT_MAX_SEC = 8;

/**
 * ── 红果红线门禁阈值（来源：红果 2026 年 4 月《漫剧内容创作建议》）──
 *
 * 红果（番茄旗下短剧平台）对漫剧的硬性投流红线，机检可覆盖的部分固化为常量。
 * 不涉视觉的项（画风统一/音画同步/角色跨镜一致）由 2.3 连贯性体检（AI 场记）覆盖，
 * 本节末行注明分工。
 */
/** 单集总时长硬上限（秒）：超过判 bad（红果建议单集 ≤3 分钟） */
const REDLINE_TOTAL_SEC_BAD = 180;
/** 单集总时长告警线（秒）：超过判 warn（逼近上限，留投流余量） */
const REDLINE_TOTAL_SEC_WARN = 168;
/** 开场钩子窗口（秒）：前 N 秒内须有冲突/钩子镜（留存生死线） */
const REDLINE_HOOK_WINDOW_SEC = 3;
/** 情绪断档上限（秒）：任意连续 N 秒无情绪事件即告警 */
const REDLINE_EMOTION_GAP_SEC = 30;
/** 对白单句字数上限：超过给逐镜精简建议（竖屏一屏可读） */
const REDLINE_DIALOGUE_MAX_CHARS = 15;
/** 静止长镜时长下限（秒）：超过且无运动即给「加镜内运动」建议 */
const REDLINE_STATIC_SHOT_SEC = 4;
/** 逐镜 suggestion 最多列出条数（对白过长/静止长镜各自），超出汇总一条 */
const REDLINE_SUGGESTION_LIMIT = 5;

/** 报告参与体检的单个分镜（仅取审片需要的字段，与 types/scene.ts Scene 兼容） */
export interface ReviewScene {
  id: string;
  order: number;
  /**
   * 分镜「成片轴」时长（秒）——已按倍速换算（= DB scene.duration / speed），
   * 由 route 层用 generationParams.sceneEffects 算好传入。本文件所有时长判据
   * （总时长/空镜/对白超时/红线）一律读此字段，无需再关心倍速。
   */
  duration: number;
  /**
   * 该镜倍速（缺省 1）。仅用于把「台词朗读时长」换算到成片轴——导出端给配音挂了
   * 同一 speed 的 atempo（见 video-synthesis 的配音 buildAtempoChain），故朗读
   * 时长也须除 speed，才能与已换算的 duration 在同一时间轴上比较。
   */
  speechSpeed?: number;
  shotType?: string | null;
  dialogue?: string | null;
  narration?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  /** 尾帧衔接下一镜：开启时要求下一镜已出图，否则衔接静默失效 */
  videoLinkNext?: boolean;
  /** 叙事节拍类型（impact/reveal/emotional/calm）——红线门禁「开场钩子/情绪断档」用 */
  beatType?: string | null;
  /** 高潮镜标记——红线门禁「开场钩子/情绪断档」的情绪事件判定 */
  isClimax?: boolean | null;
  /** 运镜（static/zoom_in/...）——红线门禁「静止长镜缺运动」判定 */
  cameraMovement?: string | null;
  /** 运动节拍（镜内动作描述）——红线门禁「静止长镜缺运动」的动作判定 */
  actionBeat?: string | null;
  /** 情感标签（neutral/angry/...）——红线门禁「开场钩子/情绪断档」的情绪事件判定 */
  emotion?: string | null;
}

/** 2.3 连贯性体检摘要（复用最近一次已完成 continuity_check 任务的结果） */
export interface ContinuitySummaryInput {
  /**
   * 综合评级 A/B/C/D；null = 体检未完成（视觉调用全部失败，无一对成功检查）。
   * 未完成时不是「通过」也不是「尚未运行」——是「跑过但没查成」，须单独告警。
   */
  grade: string | null;
  /** 一句话总结（含跳过对记账 / 未完成说明） */
  summary: string;
  /** 问题条数 */
  issueCount: number;
}

/** 报告的节状态：ok 正常、warn 需注意、bad 有明显问题 */
export type ReviewSectionStatus = "ok" | "warn" | "bad";

/** 报告的一节 */
export interface ReviewSection {
  key: "pacing" | "hook" | "continuity" | "completeness" | "redline";
  title: string;
  status: ReviewSectionStatus;
  /** 逐条陈述（每条一行） */
  lines: string[];
}

/** 一条可跳转的修改建议 */
export interface ReviewSuggestion {
  /** 关联分镜（有则可「定位」跳转）；全片级建议无此字段 */
  sceneId?: string;
  /** 分镜序号（1 起，展示用） */
  sceneOrder?: number;
  /** 建议文案 */
  text: string;
}

/** 综合等级 */
export type ReviewGrade = "A" | "B" | "C" | "D";

/** 审片报告 */
export interface ReviewReport {
  grade: ReviewGrade;
  sections: ReviewSection[];
  suggestions: ReviewSuggestion[];
}

/** assembleReviewReport 的入参 */
export interface AssembleReviewReportInput {
  scenes: ReviewScene[];
  /** 最新短剧脚本的结尾钩子类型；解析型项目 / 漏标时为空 */
  hookType?: HookType | null;
  /** 2.3 连贯性摘要；从未运行过 continuity_check 时为空 */
  continuitySummary?: ContinuitySummaryInput | null;
  /**
   * 片头/片尾卡额外时长（秒）——红线总时长门禁须把启用的卡片时长计入单集总时长。
   * 由 route 按 genParams.titleCards + isSeries 用 resolveTitleCardsEnabled 与
   * TITLE_CARD_SEC/END_CARD_SEC 算好传入；缺省 0（无卡片）。
   */
  cardExtraSec?: number;
}

/**
 * 秒数展示：整数不带小数，小数保留一位（如 8.4s）。
 */
function fmtSec(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

/**
 * 组装审片报告（纯函数）。
 *
 * 四节各自算 status 并产出 lines + suggestions；综合等级按「非 ok 节」数量降级。
 */
export function assembleReviewReport(
  input: AssembleReviewReportInput
): ReviewReport {
  const scenes = [...input.scenes].sort((a, b) => a.order - b.order);
  const suggestions: ReviewSuggestion[] = [];

  const pacing = buildPacingSection(scenes, suggestions);
  const hook = buildHookSection(input.hookType ?? null, suggestions);
  const continuity = buildContinuitySection(
    input.continuitySummary ?? null,
    suggestions
  );
  const completeness = buildCompletenessSection(scenes, suggestions);
  const redline = buildRedlineSection(
    scenes,
    input.cardExtraSec ?? 0,
    suggestions
  );

  const sections = [pacing, hook, continuity, completeness, redline];
  const grade = computeGrade(sections);

  return { grade, sections, suggestions };
}

/**
 * 综合等级：按「非 ok 节」数量降级（复用 2.3 A/B/C/D 思路，以节为单位）。
 * - 有 bad 节：≥2 个 bad → D；恰好 1 个 bad → C。
 * - 无 bad 节：0 个 warn → A；≥1 个 warn → B。
 */
function computeGrade(sections: ReviewSection[]): ReviewGrade {
  const badCount = sections.filter((s) => s.status === "bad").length;
  const warnCount = sections.filter((s) => s.status === "warn").length;
  if (badCount >= 2) return "D";
  if (badCount === 1) return "C";
  if (warnCount >= 1) return "B";
  return "A";
}

/**
 * ① 时长节奏节：总时长、镜数、每分钟镜数、超长空镜清单、对白朗读超时清单。
 *
 * 异常判据（全部派生自文档化规则，见文件头）：
 * - 无对白且 duration > 8s → 拉长嫌疑（超长空镜）。
 * - 对白+旁白朗读时长 > duration → 配音会被截断（对白超时）。
 * - 每分钟镜数落在 [15,25] 外 → 节奏偏离（<15 拖沓、>25 碎切）。
 */
function buildPacingSection(
  scenes: ReviewScene[],
  suggestions: ReviewSuggestion[]
): ReviewSection {
  const lines: string[] = [];

  if (scenes.length === 0) {
    return {
      key: "pacing",
      title: "时长节奏",
      status: "warn",
      lines: ["尚无分镜，无法评估节奏。"],
    };
  }

  const totalSec = scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
  const shotCount = scenes.length;
  const shotsPerMin = totalSec > 0 ? (shotCount / totalSec) * 60 : 0;

  lines.push(
    `总时长 ${fmtSec(totalSec)}s，共 ${shotCount} 个分镜，` +
      `每分钟约 ${shotsPerMin.toFixed(1)} 个镜头。`
  );

  // 每分钟镜数偏离（全片级，无关联分镜）
  let pacingDeviated = false;
  if (totalSec > 0 && shotsPerMin < SHOTS_PER_MIN_MIN) {
    pacingDeviated = true;
    lines.push(
      `镜频偏低（<${SHOTS_PER_MIN_MIN}/分钟），镜头偏长易拖沓，可考虑拆分长镜或加快切换。`
    );
    suggestions.push({
      text: `全片每分钟仅 ${shotsPerMin.toFixed(1)} 个镜头，低于 ${SHOTS_PER_MIN_MIN} 的合理区间，建议拆分长镜提升节奏。`,
    });
  } else if (shotsPerMin > SHOTS_PER_MIN_MAX) {
    pacingDeviated = true;
    lines.push(
      `镜频偏高（>${SHOTS_PER_MIN_MAX}/分钟），碎切过密易疲劳，可合并部分短镜。`
    );
    suggestions.push({
      text: `全片每分钟 ${shotsPerMin.toFixed(1)} 个镜头，高于 ${SHOTS_PER_MIN_MAX} 的合理区间，建议合并部分短镜。`,
    });
  }

  // 超长空镜（无对白且 > 8s）
  const longSilent = scenes.filter(
    (s) => !hasSpeech(s) && (s.duration || 0) > SILENT_SHOT_MAX_SEC
  );
  if (longSilent.length > 0) {
    lines.push(
      `${longSilent.length} 个无对白空镜超过 ${SILENT_SHOT_MAX_SEC}s（有凑时长嫌疑）：` +
        longSilent
          .map((s) => `镜 ${s.order + 1}（${fmtSec(s.duration)}s）`)
          .join("、")
    );
    for (const s of longSilent) {
      suggestions.push({
        sceneId: s.id,
        sceneOrder: s.order + 1,
        text: `镜 ${s.order + 1} 无对白却长达 ${fmtSec(s.duration)}s，建议缩短或补充台词/旁白。`,
      });
    }
  }

  // 对白朗读超时（对白+旁白朗读时长 > duration → 配音被截断）。
  // 朗读时长按 speechSpeed 换算到成片轴（duration 已换算），保持判据两边同轴。
  const overrun = scenes
    .map((s) => ({
      scene: s,
      speech: sceneSpeechSeconds(s),
    }))
    .filter((x) => x.speech > (x.scene.duration || 0));
  if (overrun.length > 0) {
    lines.push(
      `${overrun.length} 个分镜台词朗读时长超过镜头时长（配音会被截断）：` +
        overrun
          .map(
            (x) =>
              `镜 ${x.scene.order + 1}（需 ${fmtSec(Math.ceil(x.speech))}s / 现 ${fmtSec(x.scene.duration)}s）`
          )
          .join("、")
    );
    for (const x of overrun) {
      suggestions.push({
        sceneId: x.scene.id,
        sceneOrder: x.scene.order + 1,
        text: `镜 ${x.scene.order + 1} 台词约需 ${fmtSec(Math.ceil(x.speech))}s，现时长 ${fmtSec(x.scene.duration)}s，建议延长镜头或精简台词。`,
      });
    }
  }

  // 节状态：对白超时是硬伤（配音截断）→ bad；仅节奏偏离/空镜过长 → warn。
  const status: ReviewSectionStatus =
    overrun.length > 0
      ? "bad"
      : pacingDeviated || longSilent.length > 0
        ? "warn"
        : "ok";

  return { key: "pacing", title: "时长节奏", status, lines };
}

/** 有对白或旁白 */
function hasSpeech(s: ReviewScene): boolean {
  return Boolean(s.dialogue?.trim()) || Boolean(s.narration?.trim());
}

/**
 * 该镜「成片轴」台词朗读时长（秒）= (对白+旁白朗读时长) / speechSpeed。
 *
 * 导出端配音与画面挂同一 speed，故朗读时长与 duration 必须同除 speed 才可比较；
 * speechSpeed 缺省/非正时按 1（不变速）处理，行为与未接入倍速时完全一致。
 */
function sceneSpeechSeconds(s: ReviewScene): number {
  const raw =
    estimateSpeechSeconds(s.dialogue ?? "") +
    estimateSpeechSeconds(s.narration ?? "");
  const speed = s.speechSpeed && s.speechSpeed > 0 ? s.speechSpeed : 1;
  return raw / speed;
}

/**
 * ② 结尾钩子节：hookType 已标注则展示类型；未标注（解析型项目）→ warn + 建议。
 */
function buildHookSection(
  hookType: HookType | null,
  suggestions: ReviewSuggestion[]
): ReviewSection {
  if (hookType) {
    return {
      key: "hook",
      title: "结尾钩子",
      status: "ok",
      lines: [`本集结尾钩子类型：${hookType}钩。`],
    };
  }
  suggestions.push({
    text: "结尾钩子未标注：可用「世界观创作」重新生成脚本以带上钩子类型，或人工确认结尾是否留有悬念。",
  });
  return {
    key: "hook",
    title: "结尾钩子",
    status: "warn",
    lines: [
      "结尾钩子未标注（解析型项目或脚本漏填）。爆款方法论要求每集结尾停在未解决的张力上。",
    ],
  };
}

/**
 * ③ 连贯性节：复用 2.3 摘要（评级 + 问题数）；从未运行 → warn + 指引。
 * 不在此触发 continuity_check（只汇总已有结果）。
 */
function buildContinuitySection(
  summary: ContinuitySummaryInput | null,
  suggestions: ReviewSuggestion[]
): ReviewSection {
  if (!summary) {
    suggestions.push({
      text: "尚未运行 AI 场记体检：建议先做一次视觉连贯性检查，再导出。",
    });
    return {
      key: "continuity",
      title: "连贯性",
      status: "warn",
      lines: ["尚未运行 AI 场记体检。"],
    };
  }

  // 体检跑过但无一对成功检查（grade=null）：既非「通过」也非「尚未运行」，
  // 而是「视觉调用全部失败」——单独告警，避免误判为已过审。
  if (summary.grade === null) {
    suggestions.push({
      text: "AI 场记体检未完成（视觉调用全部失败）：请确认所用大模型支持图像识别（多模态），再重跑一次连贯性检查。",
    });
    return {
      key: "continuity",
      title: "连贯性",
      status: "warn",
      lines: [
        summary.summary || "场记体检未完成：视觉调用全部失败，未能实际检查。",
      ],
    };
  }

  // 复用 2.3 评级映射节状态：A/B → ok，C → warn，D → bad。
  const status: ReviewSectionStatus =
    summary.grade === "D" ? "bad" : summary.grade === "C" ? "warn" : "ok";

  const lines = [summary.summary];
  if (summary.issueCount > 0) {
    lines.push("可在「AI 场记」面板逐条按建议重生成。");
    suggestions.push({
      text: `连贯性体检发现 ${summary.issueCount} 处问题（评级 ${summary.grade}），建议在 AI 场记面板逐条修复后再导出。`,
    });
  }
  return { key: "continuity", title: "连贯性", status, lines };
}

/**
 * ④ 完整性节：缺图/缺视频/缺音频/空镜（无对白无旁白）统计；
 * 衔接镜（videoLinkNext）的下一镜缺图数（衔接会静默失效）。
 */
function buildCompletenessSection(
  scenes: ReviewScene[],
  suggestions: ReviewSuggestion[]
): ReviewSection {
  const lines: string[] = [];

  if (scenes.length === 0) {
    return {
      key: "completeness",
      title: "素材完整性",
      status: "warn",
      lines: ["尚无分镜。"],
    };
  }

  const missingImage = scenes.filter((s) => !s.imageUrl);
  const missingVideo = scenes.filter((s) => !s.videoUrl);
  const missingAudio = scenes.filter((s) => !s.audioUrl);
  // 空镜：既无对白也无旁白（无声画面，通常需补台词或确认是否有意为之）
  const emptyShots = scenes.filter((s) => !hasSpeech(s));

  lines.push(
    `缺图 ${missingImage.length} / 缺视频 ${missingVideo.length} / ` +
      `缺配音 ${missingAudio.length} / 无对白无旁白 ${emptyShots.length}（共 ${scenes.length} 镜）。`
  );

  // 缺图是导出硬伤——逐镜给可跳转建议
  for (const s of missingImage) {
    suggestions.push({
      sceneId: s.id,
      sceneOrder: s.order + 1,
      text: `镜 ${s.order + 1} 缺少图片，导出前请先生成。`,
    });
  }

  // 衔接镜下一镜缺图：videoLinkNext 依赖下一镜图片做尾帧，缺图则衔接静默失效
  let brokenLinks = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    if (scenes[i].videoLinkNext && !scenes[i + 1].imageUrl) {
      brokenLinks += 1;
      suggestions.push({
        sceneId: scenes[i].id,
        sceneOrder: scenes[i].order + 1,
        text: `镜 ${scenes[i].order + 1} 已开启尾帧衔接，但下一镜缺图，衔接会失效——请先为下一镜出图。`,
      });
    }
  }
  if (brokenLinks > 0) {
    lines.push(`${brokenLinks} 处尾帧衔接因下一镜缺图而失效。`);
  }

  // 节状态：缺图或衔接断裂 → bad；缺视频/缺配音/空镜 → warn；全齐 → ok。
  const status: ReviewSectionStatus =
    missingImage.length > 0 || brokenLinks > 0
      ? "bad"
      : missingVideo.length > 0 ||
          missingAudio.length > 0 ||
          emptyShots.length > 0
        ? "warn"
        : "ok";

  return { key: "completeness", title: "素材完整性", status, lines };
}

/** 该分镜是否构成「情绪事件」：beatType 非空 / isClimax / emotion 非中性非空 */
function isEmotionEvent(s: ReviewScene): boolean {
  if (s.beatType && s.beatType.trim()) return true;
  if (s.isClimax) return true;
  const emo = (s.emotion ?? "").trim().toLowerCase();
  return emo.length > 0 && emo !== "neutral";
}

/** 该分镜是否是「开场钩子/冲突镜」：beatType∈{impact,reveal} / isClimax / 强情绪 */
function isHookShot(s: ReviewScene): boolean {
  const beat = (s.beatType ?? "").trim().toLowerCase();
  if (beat === "impact" || beat === "reveal") return true;
  if (s.isClimax) return true;
  const emo = (s.emotion ?? "").trim().toLowerCase();
  return emo === "angry" || emo === "surprised" || emo === "fear";
}

/** 按中文句末标点切句（。！？!?；;），用于对白单句字数体检 */
function splitDialogueSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * ⑤ 红果红线节：平台硬性投流红线的机检门禁（阈值见文件头常量，
 * source: 红果 2026 年 4 月《漫剧内容创作建议》）。
 *
 * 五道门禁：
 *  1) 单集总时长（分镜和 + 启用卡片时长）>180s → bad；>168s → warn。
 *  2) 开场 3s 内无冲突/钩子镜（前 3s 的镜无一为 impact/reveal/isClimax/强情绪）→ warn。
 *  3) 任意连续 30s 无情绪事件 → warn（定位断档起始镜）。
 *  4) 对白单句 >15 字 → 逐镜 suggestion（最多列 5 条，超出汇总一条）。
 *  5) 单镜 >4s 且 cameraMovement∈{static,空} 且无 actionBeat → 逐镜「加镜内运动」建议。
 *
 * 节末注明：画风统一 / 音画同步 / 角色跨镜一致由连贯性体检（AI 场记）覆盖。
 */
function buildRedlineSection(
  scenes: ReviewScene[],
  cardExtraSec: number,
  suggestions: ReviewSuggestion[]
): ReviewSection {
  const lines: string[] = [];

  if (scenes.length === 0) {
    return {
      key: "redline",
      title: "红果红线",
      status: "warn",
      lines: [
        "尚无分镜，无法体检红线。",
        "画风统一 / 音画同步 / 角色跨镜一致由连贯性体检（AI 场记）覆盖。",
      ],
    };
  }

  let badHit = false;
  let warnHit = false;

  // ① 单集总时长（含卡片）
  const shotSec = scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
  const totalSec = shotSec + Math.max(0, cardExtraSec);
  const cardNote =
    cardExtraSec > 0 ? `（含片头尾卡 ${fmtSec(cardExtraSec)}s）` : "";
  if (totalSec > REDLINE_TOTAL_SEC_BAD) {
    badHit = true;
    lines.push(
      `单集总时长 ${fmtSec(totalSec)}s${cardNote} 超过红线上限 ${REDLINE_TOTAL_SEC_BAD}s，投流会被限制，必须删减。`
    );
    suggestions.push({
      text: `单集总时长 ${fmtSec(totalSec)}s 超过 ${REDLINE_TOTAL_SEC_BAD}s 红线，建议删减次要分镜压到 ${REDLINE_TOTAL_SEC_BAD}s 内。`,
    });
  } else if (totalSec > REDLINE_TOTAL_SEC_WARN) {
    warnHit = true;
    lines.push(
      `单集总时长 ${fmtSec(totalSec)}s${cardNote} 逼近红线上限 ${REDLINE_TOTAL_SEC_BAD}s，建议留投流余量。`
    );
  } else {
    lines.push(`单集总时长 ${fmtSec(totalSec)}s${cardNote}，在红线范围内。`);
  }

  // ② 开场 3s 内须有冲突/钩子镜
  let acc = 0;
  let hookInWindow = false;
  for (const s of scenes) {
    if (acc >= REDLINE_HOOK_WINDOW_SEC) break;
    if (isHookShot(s)) {
      hookInWindow = true;
      break;
    }
    acc += s.duration || 0;
  }
  if (!hookInWindow) {
    warnHit = true;
    const first = scenes[0];
    lines.push(
      `开场 ${REDLINE_HOOK_WINDOW_SEC}s 内无冲突/钩子镜（留存生死线），易流失。`
    );
    suggestions.push({
      sceneId: first.id,
      sceneOrder: first.order + 1,
      text: `开场 ${REDLINE_HOOK_WINDOW_SEC}s 内应有冲突/悬念/强情绪镜，建议把首镜（镜 ${first.order + 1}）改为钩子镜或前置一记冲突。`,
    });
  }

  // ③ 任意连续 30s 无情绪事件 → 断档
  let gapStartOrder: number | null = null;
  let gapSec = 0;
  let gapReported = false;
  for (const s of scenes) {
    if (isEmotionEvent(s)) {
      gapSec = 0;
      gapStartOrder = null;
      continue;
    }
    if (gapStartOrder === null) gapStartOrder = s.order;
    gapSec += s.duration || 0;
    if (gapSec >= REDLINE_EMOTION_GAP_SEC && !gapReported) {
      warnHit = true;
      gapReported = true;
      const startScene = scenes.find((x) => x.order === gapStartOrder);
      lines.push(
        `存在连续约 ${fmtSec(gapSec)}s 无情绪事件的平淡段（自镜 ${(gapStartOrder ?? 0) + 1} 起），易掉节奏。`
      );
      suggestions.push({
        sceneId: startScene?.id,
        sceneOrder: (gapStartOrder ?? 0) + 1,
        text: `自镜 ${(gapStartOrder ?? 0) + 1} 起连续 ${fmtSec(gapSec)}s 无情绪起伏，建议插入冲突/反转/情绪点提振节奏。`,
      });
    }
  }

  // ④ 对白单句 >15 字
  const longDialogueScenes: ReviewScene[] = [];
  for (const s of scenes) {
    const dlg = s.dialogue?.trim();
    if (!dlg) continue;
    const hasLong = splitDialogueSentences(dlg).some(
      (sent) => Array.from(sent).length > REDLINE_DIALOGUE_MAX_CHARS
    );
    if (hasLong) longDialogueScenes.push(s);
  }
  if (longDialogueScenes.length > 0) {
    warnHit = true;
    lines.push(
      `${longDialogueScenes.length} 个分镜存在单句 >${REDLINE_DIALOGUE_MAX_CHARS} 字的长对白（竖屏一屏难读完）。`
    );
    const shown = longDialogueScenes.slice(0, REDLINE_SUGGESTION_LIMIT);
    for (const s of shown) {
      suggestions.push({
        sceneId: s.id,
        sceneOrder: s.order + 1,
        text: `镜 ${s.order + 1} 对白单句超过 ${REDLINE_DIALOGUE_MAX_CHARS} 字，建议拆句或精简（竖屏字幕一屏可读）。`,
      });
    }
    if (longDialogueScenes.length > REDLINE_SUGGESTION_LIMIT) {
      suggestions.push({
        text: `另有 ${longDialogueScenes.length - REDLINE_SUGGESTION_LIMIT} 个分镜对白单句过长，一并精简。`,
      });
    }
  }

  // ⑤ 静止长镜（>4s 且无运镜无动作）
  const staticLongScenes = scenes.filter((s) => {
    if ((s.duration || 0) <= REDLINE_STATIC_SHOT_SEC) return false;
    const cam = (s.cameraMovement ?? "").trim().toLowerCase();
    const isStatic = cam === "" || cam === "static";
    const noAction = !(s.actionBeat && s.actionBeat.trim());
    return isStatic && noAction;
  });
  if (staticLongScenes.length > 0) {
    warnHit = true;
    lines.push(
      `${staticLongScenes.length} 个分镜 >${REDLINE_STATIC_SHOT_SEC}s 却无运镜也无镜内动作（易显呆滞）。`
    );
    const shown = staticLongScenes.slice(0, REDLINE_SUGGESTION_LIMIT);
    for (const s of shown) {
      suggestions.push({
        sceneId: s.id,
        sceneOrder: s.order + 1,
        text: `镜 ${s.order + 1} 时长 ${fmtSec(s.duration)}s 但静止无动作，建议加镜内运动（运镜/角色动作/环境动态）。`,
      });
    }
    if (staticLongScenes.length > REDLINE_SUGGESTION_LIMIT) {
      suggestions.push({
        text: `另有 ${staticLongScenes.length - REDLINE_SUGGESTION_LIMIT} 个静止长镜，一并补镜内运动。`,
      });
    }
  }

  // 分工声明：非机检可覆盖的视觉红线归属连贯性体检
  lines.push("画风统一 / 音画同步 / 角色跨镜一致由连贯性体检（AI 场记）覆盖。");

  const status: ReviewSectionStatus = badHit ? "bad" : warnHit ? "warn" : "ok";
  return { key: "redline", title: "红果红线", status, lines };
}
