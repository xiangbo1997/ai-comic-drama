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
// 合规（广电总局令第 16 号）：AI 提示标识缺省契约解析 + 片头信息位编号类型
import { resolveAiDisclosure, type AiDisclosure } from "@/lib/ai-disclosure";
import type { TitleCardCredentials } from "@/lib/title-cards";
// 镜头语言节：景别序列体检（级差 / 连坐 / 建立镜），纯函数
import {
  analyzeShotSequence,
  suggestContrastScale,
  FLAT_TRANSITION_RATIO_WARN,
  SAME_SCALE_RUN_THRESHOLD,
} from "@/lib/shot-sequence";

/**
 * 微短剧单集时长上限（秒）——《微短剧管理办法》（国家广播电视总局令第 16 号，
 * 2026-09-01 施行）将「单集时长少于二十分钟」的网络剧片定义为微短剧。
 *
 * 达到或超过此值即不属微短剧，办法的微短剧条款（含第二十七条片头标注、
 * 第三十四条 AI 标识）不适用，合规节据此提示用户判据可能不适用。
 * 注意这与「红果红线」的 180s 投流上限是两套独立阈值：前者是法规定义边界，
 * 后者是平台投流建议，不可混用。
 */
const MICRO_DRAMA_MAX_SEC = 20 * 60;

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
  /** 地点标签——镜头语言节「新地点首镜应有建立镜」判定 */
  locationKey?: string | null;
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

/**
 * 叙事质量评审摘要（复用闭环3 已落库的 review:storyboard artifact）。
 *
 * 与本文件其余各节的区别：这一节的数据是 LLM 从导演视角打的六维分，
 * 不是机检指标——本文件不重算、不调 LLM，只消费已有结果并映射成节状态。
 */
export interface NarrativeReviewInput {
  /** 0-100 综合评分 */
  score: number;
  /** 是否达标（闭环判定结果，直接沿用不重算） */
  pass: boolean;
  /** 通过阈值（闭环 policy 的 passThreshold） */
  passThreshold: number;
  /** 六维分数（维度名 → 0-100）；老数据/纯函数评审可能缺省 */
  dimensions?: Record<string, number>;
  /** 评审反馈文案 */
  feedback?: string;
  /** 闭环返回的可执行建议（低分维度的修改指引来源） */
  suggestions?: string[];
}

/** 报告的一节 */
export interface ReviewSection {
  key:
    | "pacing"
    | "hook"
    | "continuity"
    | "completeness"
    | "redline"
    | "compliance"
    | "narrative"
    | "shotLanguage";
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
  /**
   * AI 生成内容提示标识配置（generationParams.aiDisclosure，合规第三十四条）。
   * 缺省即视为「已启用默认标识」——由 buildComplianceSection 内部走
   * resolveAiDisclosure 统一解析，与导出端同一缺省契约（不在此重复判断）。
   */
  aiDisclosure?: AiDisclosure | null;
  /**
   * 片头信息位编号（generationParams.titleCards.credentials，合规第二十七条）。
   * 缺省/全空 → 合规节提示未标注编号。
   */
  credentials?: TitleCardCredentials | null;
  /**
   * 片头标题卡是否启用（resolveTitleCardsEnabled 解析后的布尔值）。
   * 编号只渲染在片头卡上，故卡片关闭时填了编号也不会出现在成片——
   * 合规节需要这个事实来给出正确建议。
   */
  titleCardEnabled?: boolean;
  /**
   * 叙事质量评审摘要（闭环3 的 review:storyboard artifact）。
   * 从未跑过自动 workflow / 评审失败 / 手动搭建的项目 → 空，对应节报「未评审」。
   */
  narrativeReview?: NarrativeReviewInput | null;
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
  const compliance = buildComplianceSection(
    scenes,
    input.cardExtraSec ?? 0,
    input.aiDisclosure ?? null,
    input.credentials ?? null,
    input.titleCardEnabled ?? false,
    suggestions
  );

  const narrative = buildNarrativeSection(
    input.narrativeReview ?? null,
    suggestions
  );

  const shotLanguage = buildShotLanguageSection(scenes, suggestions);

  const sections = [
    pacing,
    hook,
    continuity,
    completeness,
    redline,
    compliance,
    narrative,
    shotLanguage,
  ];
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

/**
 * ⑥ 合规检查节：《微短剧管理办法》（国家广播电视总局令第 16 号，2026-09-01 施行）
 * 机检可覆盖的条款门禁。
 *
 * 三道检查：
 *  1) 第三十四条——AI 生成提示标识是否开启（关闭则 bad，这是法定强制要求）。
 *  2) 第二十七条——片头是否标注剧名与三项编号（剧名由片头卡自动带；
 *     编号未填 → warn；填了但片头卡关闭 → warn，因编号只渲染在片头卡上）。
 *  3) 单集时长是否 <20 分钟（MICRO_DRAMA_MAX_SEC）——办法第二条将「单集时长
 *     少于二十分钟」定义为微短剧；≥20 分钟则不属微短剧，本办法的微短剧条款
 *     （含上述两条）不适用，规则体系不同，需提示用户本节判据可能不适用。
 *
 * ⚠️ 本节只检查「我们能机检的事实」（开关状态 / 字段是否填 / 时长），
 * 不对「标识是否足够明显」「编号是否真实有效」下结论——前者法规未给量化标准，
 * 后者需向主管部门核验，均超出确定性体检能力。
 */
function buildComplianceSection(
  scenes: ReviewScene[],
  cardExtraSec: number,
  aiDisclosure: AiDisclosure | null,
  credentials: TitleCardCredentials | null,
  titleCardEnabled: boolean,
  suggestions: ReviewSuggestion[]
): ReviewSection {
  const lines: string[] = [];
  let badHit = false;
  let warnHit = false;

  // ① 第三十四条：AI 生成提示标识（缺省即启用，与导出端同一契约）
  const disclosure = resolveAiDisclosure(aiDisclosure);
  if (disclosure.enabled) {
    const where =
      disclosure.mode === "head"
        ? `片头 ${fmtSec(disclosure.headSec)}s 内显示`
        : "全片显示";
    lines.push(
      `AI 生成提示标识已开启（${where}，文案「${disclosure.text}」）—— 符合第三十四条「每集明显位置添加提示标识」。`
    );
  } else {
    badHit = true;
    lines.push(
      "AI 生成提示标识已关闭。第三十四条要求 AI 生成制作的微短剧在每集明显位置添加提示标识——投国内持证平台前必须开启。"
    );
    suggestions.push({
      text: "在导出弹窗「合规标识」里开启「AI 生成提示标识」（第三十四条法定要求）；仅在不投国内持证平台时才可关闭。",
    });
  }

  // ② 第二十七条：片头信息位（剧名 + 许可证号 / 批准文件编号 / 节目编号）
  const filled = [
    credentials?.licenseNo,
    credentials?.approvalNo,
    credentials?.programNo,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  if (filled.length === 0) {
    warnHit = true;
    lines.push(
      "片头未标注许可证号 / 批准文件编号 / 节目编号（第二十七条要求片头明显位置标注剧名与这三项编号）。剧名已由片头标题卡自动标注。"
    );
    suggestions.push({
      text: "在导出弹窗「合规标识 · 片头信息位」填写许可证号 / 批准文件编号 / 节目编号（第二十七条）；这些编号需由持证方向主管部门取得，系统不会代为生成。",
    });
  } else if (!titleCardEnabled) {
    // 编号填了但片头卡没开 —— 编号只渲染在片头卡上，成片里看不到（静默失效）
    warnHit = true;
    lines.push(
      `已填 ${filled.length} 项片头编号，但片头标题卡未开启——编号只渲染在片头卡上，当前不会出现在成片里。`
    );
    suggestions.push({
      text: "已填片头编号但片头标题卡关闭：请在「成片包装」开启「片头标题卡」，否则第二十七条要求的编号不会出现在成片。",
    });
  } else {
    lines.push(
      `片头信息位已标注 ${filled.length} 项编号 + 剧名（第二十七条）。编号真实有效性需自行向主管部门核验。`
    );
    if (filled.length < 3) {
      warnHit = true;
      lines.push(
        "第二十七条列明三项编号（许可证号 / 批准文件编号 / 节目编号），当前未填满，请确认是否有遗漏。"
      );
    }
  }

  // ③ 单集时长 <20 分钟（办法第二条的微短剧定义边界）
  const totalSec =
    scenes.reduce((sum, s) => sum + (s.duration || 0), 0) +
    Math.max(0, cardExtraSec);
  if (totalSec >= MICRO_DRAMA_MAX_SEC) {
    warnHit = true;
    lines.push(
      `单集总时长 ${fmtSec(totalSec)}s 已达 ${MICRO_DRAMA_MAX_SEC / 60} 分钟——办法将「单集时长少于二十分钟」定义为微短剧，本集已超出该定义，适用的管理规则与本节判据可能不同，请自行确认。`
    );
    suggestions.push({
      text: `单集时长 ${fmtSec(totalSec)}s 已达 ${MICRO_DRAMA_MAX_SEC / 60} 分钟，超出微短剧定义（单集 <20 分钟），请确认适用的管理规则。`,
    });
  } else {
    lines.push(
      `单集总时长 ${fmtSec(totalSec)}s，在微短剧定义范围内（单集 <${MICRO_DRAMA_MAX_SEC / 60} 分钟）。`
    );
  }

  lines.push(
    "依据：《微短剧管理办法》（国家广播电视总局令第 16 号，2026-09-01 施行）第二十七条、第三十四条。本节仅机检开关与字段，不判定标识是否「足够明显」（法规未规定量化标准）。"
  );

  const status: ReviewSectionStatus = badHit ? "bad" : warnHit ? "warn" : "ok";
  return { key: "compliance", title: "合规检查", status, lines };
}

/**
 * 叙事六维中文名（source: lib/prompts/agent-prompts/narrative-review.ts 的
 * STORYBOARD_REVIEW_SYSTEM，含各维权重）。维度名与权重都以那份 prompt 为单一真源，
 * 此处只做展示映射——改权重去改 prompt，别在这里另起一套。
 */
const NARRATIVE_DIMENSION_LABELS: Record<string, string> = {
  narrative_flow: "叙事连贯",
  character_continuity: "角色连续",
  visual_diversity: "镜头多样",
  hook_strength: "开场钩子",
  cliffhanger: "结尾钩子",
  externalization: "外化质量",
};

/**
 * 单维「低分」阈值：低于此分即在报告里点名并给出建议。
 *
 * 取 60 而非闭环的 passThreshold(70)：passThreshold 判的是加权总分，
 * 单维低于 60 才算明显短板（六维中一两维 65 分不影响整体成立）。
 * 与评审 prompt 的「任一项 <40 则不通过」是两档不同粒度的判据，不冲突。
 */
const NARRATIVE_DIMENSION_WEAK = 60;

/**
 * ⑦ 叙事质量节：消费闭环3（review:storyboard artifact）已落库的六维评审结果。
 *
 * 与前六节的根本差异：前六节是机检（时长/字数/字段是否填），一集「开场三秒主角起床、
 * 全片旁白复述心理、结尾把故事讲完」的剧本只要镜数落在区间内就能拿 A——机检发现不了
 * 任何叙事问题。这一节把导演视角的六维评分接进报告，补上这个盲区。
 *
 * ⚠️ 本节不重算、不调 LLM、不重跑评审——只汇总已有结果（与连贯性节同一分工原则）。
 *
 * 节状态映射：
 * - 未评审（artifact 缺失）→ ok + 说明。「没跑过评审」不是缺陷，不应拖低综合等级
 *   （手动搭建的项目从不跑 workflow，若判 warn 会让它们永远拿不到 A）。
 * - pass=false → bad（叙事不达标是硬伤：后续几十张图 + 几十段视频全建立在这份分镜上）。
 * - pass=true 但有单维 <60 → warn（整体成立但有明显短板）。
 * - pass=true 且六维齐整 → ok。
 */
function buildNarrativeSection(
  review: NarrativeReviewInput | null,
  suggestions: ReviewSuggestion[]
): ReviewSection {
  if (!review) {
    return {
      key: "narrative",
      title: "叙事质量",
      status: "ok",
      lines: [
        "未评审：本项目没有可用的分镜叙事评审结果（未跑过自动工作流，或评审调用失败）。",
        "叙事质量（开场钩子 / 结尾钩子 / 内心戏外化等）需由 AI 导演评审给出，本报告的其余各节只做机检，覆盖不到这些维度。",
      ],
    };
  }

  const lines: string[] = [];

  lines.push(
    `叙事综合评分 ${Math.round(review.score)} / 100（达标线 ${review.passThreshold}），` +
      `${review.pass ? "已达标" : "未达标"}。`
  );

  if (review.feedback?.trim()) {
    lines.push(`导演评语：${review.feedback.trim()}`);
  }

  // 六维逐项展示（只给总分无法定位是哪一维拖了后腿）
  const dims = Object.entries(review.dimensions ?? {});
  const weak: Array<{ key: string; label: string; score: number }> = [];
  if (dims.length > 0) {
    lines.push(
      "分维度：" +
        dims
          .map(([key, val]) => {
            const label = NARRATIVE_DIMENSION_LABELS[key] ?? key;
            const rounded = Math.round(val);
            if (val < NARRATIVE_DIMENSION_WEAK) {
              weak.push({ key, label, score: rounded });
            }
            return `${label} ${rounded}`;
          })
          .join(" / ")
    );
  }

  if (weak.length > 0) {
    lines.push(
      `${weak.length} 个维度低于 ${NARRATIVE_DIMENSION_WEAK} 分（明显短板）：` +
        weak.map((w) => `${w.label}(${w.score})`).join("、")
    );
  }

  // 可执行建议：复用评审返回的 suggestions（逐条具体到镜，比自造文案有用）。
  // 全片级建议，无 sceneId——评审看的是分镜序列摘要，拿不到 DB 的 scene.id。
  const actionable = (review.suggestions ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (actionable.length > 0) {
    for (const text of actionable) {
      suggestions.push({ text: `叙事评审：${text}` });
    }
  } else if (!review.pass || weak.length > 0) {
    // 评审判了不达标却没给建议（LLM 漏填）——仍要给用户一个可执行落点
    suggestions.push({
      text:
        weak.length > 0
          ? `叙事评审：${weak.map((w) => w.label).join("、")}维度偏低，建议在「世界观创作」重写脚本或手动调整对应分镜后重跑工作流。`
          : "叙事评审未达标但未给出具体建议，建议重跑一次工作流或在「世界观创作」重写脚本。",
    });
  }

  const status: ReviewSectionStatus = !review.pass
    ? "bad"
    : weak.length > 0
      ? "warn"
      : "ok";

  return { key: "narrative", title: "叙事质量", status, lines };
}

/**
 * ⑧ 镜头语言节：景别序列的确定性体检。
 *
 * 断裂背景：全系统唯一的镜间景别规则是 `prompts/episode-structure.ts` 的一句
 * 自然语言（「相邻分镜避免同景别同机位」），塞在 30-50 镜的长输出 prompt 里，
 * LLM 必然遗忘；而本文件这个现成的体检器此前**从不让 shotType 参与任何判据**
 * （只在 ReviewScene 里做了类型声明）。这一节把规则变成可判定校验。
 *
 * 三道判据（行业标准，见 lib/shot-sequence.ts 文件头）：
 *  1) 连续同景别 ≥3 镜 → bad（观众感觉「没切」，最典型的业余单调感）。
 *  2) 相邻级差为 0 的镜对占比 >30% → warn（整体切换幅度不足）。
 *  3) 某地点首镜非全景/远景 → warn（缺建立镜，观众建立不起空间关系）。
 *
 * ⚠️ 只对可识别为标准五景别的镜生效：未标景别 / 机位角度键（俯拍/过肩）/ 乱输入
 * 一律排除出判据（把「俯拍」当景别参与级差排序是错的）。可识别镜不足 2 个时
 * 直接返回 ok 并说明样本不足——不对缺数据的项目扣分。
 */
function buildShotLanguageSection(
  scenes: ReviewScene[],
  suggestions: ReviewSuggestion[]
): ReviewSection {
  const lines: string[] = [];

  // 无分镜：同「样本不足」——没跑体检，不是没通过（完整性节已单独报缺分镜）
  if (scenes.length === 0) {
    return {
      key: "shotLanguage",
      title: "镜头语言",
      status: "ok",
      lines: ["尚无分镜，未做镜头语言体检。"],
    };
  }

  const analysis = analyzeShotSequence(
    scenes.map((s) => ({
      order: s.order,
      shotType: s.shotType,
      locationKey: s.locationKey,
    }))
  );

  // 样本不足：可识别景别 <2 镜，无法比较任何相邻对——体检**没跑**，不是没通过。
  //
  // 判 ok 而非 warn，理由三条：
  // 1) 「没数据」与「有缺陷」是两种状态；叙事质量节在未评审时同样返回 ok，
  //    同一份报告里两个节对同一种情况必须给一致语义。
  // 2) 命中的正好是系统自己造成数据缺口的那批项目（归一化之前的存量项目、
  //    1-2 镜的草稿）——因系统自身缺口去扣项目的分是最坏的版本。
  // 3) 本文件每条 warn 都对应具体动作（拆分长镜 / 精简台词），而报告是 GET 只读
  //    无阻断能力，唯一价值就是可行动信号；不可行动的 warn 是噪音还白降一级。
  //
  // 但仍在 lines 里留一行说明「这项没跑」，好过静默返回 ok。
  if (analysis.recognizedCount < 2) {
    return {
      key: "shotLanguage",
      title: "镜头语言",
      status: "ok",
      lines: [
        `景别样本不足（识别到 ${analysis.recognizedCount} 镜），未做序列体检。`,
        "如需体检镜头语言，可在分镜卡逐镜补标景别，或用「智能拆解分镜」重新解析以带上景别。",
      ],
    };
  }

  let badHit = false;
  let warnHit = false;

  lines.push(
    `${analysis.recognizedCount} 个分镜标注了景别，其中特写+近景占 ${(analysis.closeUpRatio * 100).toFixed(0)}%。`
  );

  // ① 连续同景别 ≥3 镜 → bad
  if (analysis.sameScaleRuns.length > 0) {
    badHit = true;
    lines.push(
      `${analysis.sameScaleRuns.length} 处连续 ${SAME_SCALE_RUN_THRESHOLD} 镜以上同景别（观众会感觉「没切」）：` +
        analysis.sameScaleRuns
          .map(
            (r) =>
              `镜 ${r.startOrder + 1}-${r.startOrder + r.length}（连续 ${r.length} 个${r.scale}）`
          )
          .join("、")
    );
    for (const run of analysis.sameScaleRuns) {
      // 建议改中间那一镜（打断连坐最省事），给出具体的跨档替换景别
      const midOffset = Math.floor(run.length / 2);
      const midOrder = run.startOrder + midOffset;
      const target = suggestContrastScale(run.scale);
      const midScene = scenes.find((s) => s.order === midOrder);
      suggestions.push({
        sceneId: midScene?.id,
        sceneOrder: midOrder + 1,
        text: `镜 ${run.startOrder + 1}-${run.startOrder + run.length} 连续 ${run.length} 个${run.scale}，建议镜 ${midOrder + 1} 改为${target}打断单调（相邻两镜景别应至少跨一档）。`,
      });
    }
  }

  // ② 相邻级差为 0 的占比 >30% → warn
  if (analysis.comparablePairs > 0) {
    const flatRatio =
      analysis.flatTransitions.length / analysis.comparablePairs;
    if (flatRatio > FLAT_TRANSITION_RATIO_WARN) {
      warnHit = true;
      lines.push(
        `${analysis.flatTransitions.length}/${analysis.comparablePairs} 组相邻镜景别完全相同（${(flatRatio * 100).toFixed(0)}%，超过 ${FLAT_TRANSITION_RATIO_WARN * 100}% 的合理上限），整体切换幅度不足。`
      );
      suggestions.push({
        text: `全片 ${(flatRatio * 100).toFixed(0)}% 的相邻镜景别相同，建议按「远景交代 → 中景推进 → 特写情绪」的节奏重新分配景别，相邻两镜至少跨一档。`,
      });
    }
  }

  // ③ 新地点首镜缺建立镜 → warn
  if (analysis.missingEstablishing.length > 0) {
    warnHit = true;
    lines.push(
      `${analysis.missingEstablishing.length} 个地点的首镜不是建立镜（全景/远景），观众建立不起空间关系：` +
        analysis.missingEstablishing
          .map((m) => `「${m.locationKey}」（镜 ${m.firstOrder + 1}）`)
          .join("、")
    );
    for (const m of analysis.missingEstablishing) {
      const scene = scenes.find((s) => s.order === m.firstOrder);
      suggestions.push({
        sceneId: scene?.id,
        sceneOrder: m.firstOrder + 1,
        text: `地点「${m.locationKey}」首镜（镜 ${m.firstOrder + 1}）非全景/远景，建议改为建立镜交代空间，或在其前插入一个全景空镜。`,
      });
    }
  }

  if (!badHit && !warnHit) {
    lines.push("景别序列跨档合理，无连续同景别，各地点均有建立镜。");
  }

  const status: ReviewSectionStatus = badHit ? "bad" : warnHit ? "warn" : "ok";
  return { key: "shotLanguage", title: "镜头语言", status, lines };
}
