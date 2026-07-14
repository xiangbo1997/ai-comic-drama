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
 */

import { estimateSpeechSeconds } from "@/lib/shot-timing";
import type { HookType } from "@/types/series-bible";

/** 每分钟镜数合理区间下限（源自 EPISODE_PACING_RULES 信息增量节奏） */
const SHOTS_PER_MIN_MIN = 15;
/** 每分钟镜数合理区间上限（超出即碎切疲劳） */
const SHOTS_PER_MIN_MAX = 25;
/** 无对白空镜时长上限（秒）——source: shot-timing.ts softCeiling */
const SILENT_SHOT_MAX_SEC = 8;

/** 报告参与体检的单个分镜（仅取审片需要的字段，与 types/scene.ts Scene 兼容） */
export interface ReviewScene {
  id: string;
  order: number;
  duration: number;
  shotType?: string | null;
  dialogue?: string | null;
  narration?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  /** 尾帧衔接下一镜：开启时要求下一镜已出图，否则衔接静默失效 */
  videoLinkNext?: boolean;
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
  key: "pacing" | "hook" | "continuity" | "completeness";
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

  const sections = [pacing, hook, continuity, completeness];
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

  // 对白朗读超时（对白+旁白朗读时长 > duration → 配音被截断）
  const overrun = scenes
    .map((s) => ({
      scene: s,
      speech:
        estimateSpeechSeconds(s.dialogue ?? "") +
        estimateSpeechSeconds(s.narration ?? ""),
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
