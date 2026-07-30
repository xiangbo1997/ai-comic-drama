/**
 * 项目生成参数（Project.generationParams）的服务端白名单校验。
 *
 * 从 api/projects/[id]/route.ts 抽出为纯函数（同 subtitle-style-normalize 的
 * 抽出动机），使「字段白名单是否完备」可被 round-trip 单测覆盖——历史上
 * subtitleStyle / BGM / SFX / 花字都踩过「前端存了但这里没挂分支 → 静默丢弃」的坑。
 *
 * 契约：逐字段重建，只放行已知字段并 clamp 到合理范围，防止任意 JSON 落库。
 * 语义与抽出前逐字一致（纯搬迁 + 防漏告警）。
 */

import { createLogger } from "@/lib/logger";
import { normalizeSubtitleStyle } from "@/lib/subtitle-style-normalize";
import { normalizeProducerReview } from "@/lib/producer-review";
import { getSfxById } from "@/lib/sfx-library";
import { MAX_EMPHASIS_SCENES } from "@/types/export-style";
import { resolveLutPreset, DEFAULT_COLOR_GRADE } from "@/lib/color-grade";
import type { GenerationParams } from "@/types/project";

const log = createLogger("lib:generation-params-normalize");

/**
 * 按 sceneId 键控的逐镜配置数组上限（subtitlePositions / sceneEffects 共用）。
 *
 * 语义 = 单项目分镜数上限：这类数组每个分镜最多一条，截断即静默丢弃用户配置。
 * 此前 sceneEffects 硬截 200 而 subtitlePositions 是 500，分镜数在 200-500 之间
 * 的长项目，后段分镜的滤镜/变速/运镜配置存不进 DB（静默丢尾）。
 */
const MAX_SCENE_KEYED_ENTRIES = 500;

/**
 * normalizeGenerationParams 收录的字段全集（防漏机制的声明式真源）。
 *
 * `Record<keyof GenerationParams, true>` 的类型约束让「GenerationParams 新增字段却
 * 没在这里登记」直接编译报错；下方 normalizeGenerationParams 结尾据此把白名单外的
 * 未知键 log.warn 出来。两者配合 round-trip 单测
 * （tests/lib/generation-params-normalize.test.ts）兜住历史上反复出现的
 * 「前端存了但后端白名单没挂 → 静默丢弃」缺陷。
 */
export const GENERATION_PARAM_KEY_MAP: Record<keyof GenerationParams, true> = {
  temperature: true,
  topP: true,
  styleStrength: true,
  negativePreset: true,
  customNegative: true,
  subtitleStyle: true,
  subtitlePositions: true,
  watermark: true,
  stickers: true,
  transitions: true,
  sceneEffects: true,
  backgroundMusic: true,
  sfx: true,
  emphasis: true,
  colorGrade: true,
  titleCards: true,
  producerReview: true,
  renderStrategy: true,
};

const GENERATION_PARAM_KEYS = new Set(Object.keys(GENERATION_PARAM_KEY_MAP));

/**
 * 白名单 + 范围校验 generationParams，防止任意 JSON 落库。
 * 返回 Prisma 可接受的 plain object。
 */
export function normalizeGenerationParams(
  input: unknown
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof src.temperature === "number") {
    out.temperature = clampNumber(src.temperature, 0, 1.5);
  }
  if (typeof src.topP === "number") {
    out.topP = clampNumber(src.topP, 0, 1);
  }
  if (typeof src.styleStrength === "number") {
    out.styleStrength = clampNumber(src.styleStrength, 0, 1);
  }
  if (
    typeof src.negativePreset === "string" &&
    src.negativePreset.length <= 32
  ) {
    out.negativePreset = src.negativePreset;
  }
  if (
    typeof src.customNegative === "string" &&
    src.customNegative.length <= 1000
  ) {
    out.customNegative = src.customNegative;
  }
  // 字幕样式（全片统一）：校验后整体放行。白名单逻辑抽到 lib/subtitle-style-normalize
  // 便于单测（含此前漏掉的 animation 字段 + 自由默认位置 defaultX/defaultY）。
  const normalizedSubtitleStyle = normalizeSubtitleStyle(src.subtitleStyle);
  if (normalizedSubtitleStyle) {
    out.subtitleStyle = normalizedSubtitleStyle;
  }
  // 商标水印：校验后整体放行
  if (src.watermark && typeof src.watermark === "object") {
    const wm = src.watermark as Record<string, unknown>;
    const wmPos = ["tl", "tr", "bl", "br", "center"];
    out.watermark = {
      enabled: wm.enabled === true,
      imageUrl:
        typeof wm.imageUrl === "string" && wm.imageUrl.length <= 2048
          ? wm.imageUrl
          : "",
      position:
        typeof wm.position === "string" && wmPos.includes(wm.position)
          ? wm.position
          : "br",
      opacity:
        typeof wm.opacity === "number" ? clampNumber(wm.opacity, 0, 1) : 0.8,
      scale:
        typeof wm.scale === "number" ? clampNumber(wm.scale, 0.02, 0.5) : 0.12,
    };
  }
  // 贴图列表：校验每个贴图后放行（最多 50 个）
  if (Array.isArray(src.stickers)) {
    out.stickers = src.stickers
      .slice(0, 50)
      .filter(
        (st): st is Record<string, unknown> => !!st && typeof st === "object"
      )
      .map((st) => ({
        id: typeof st.id === "string" ? st.id.slice(0, 64) : "",
        imageUrl:
          typeof st.imageUrl === "string" && st.imageUrl.length <= 2048
            ? st.imageUrl
            : "",
        sceneId: typeof st.sceneId === "string" ? st.sceneId.slice(0, 64) : "",
        x: typeof st.x === "number" ? clampNumber(st.x, 0, 1) : 0.5,
        y: typeof st.y === "number" ? clampNumber(st.y, 0, 1) : 0.5,
        scale:
          typeof st.scale === "number" ? clampNumber(st.scale, 0.02, 1) : 0.2,
        ...(typeof st.startOffset === "number"
          ? { startOffset: clampNumber(st.startOffset, 0, 600) }
          : {}),
        ...(typeof st.duration === "number"
          ? { duration: clampNumber(st.duration, 0.1, 600) }
          : {}),
      }))
      .filter((st) => st.imageUrl && st.sceneId);
  }
  // 字幕逐分镜位置覆盖：校验 sceneId + 归一化坐标（上限对应分镜数上限）
  if (Array.isArray(src.subtitlePositions)) {
    out.subtitlePositions = src.subtitlePositions
      .slice(0, MAX_SCENE_KEYED_ENTRIES)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({
        sceneId: typeof p.sceneId === "string" ? p.sceneId.slice(0, 64) : "",
        x: typeof p.x === "number" ? clampNumber(p.x, 0, 1) : 0.5,
        y: typeof p.y === "number" ? clampNumber(p.y, 0, 1) : 0.88,
      }))
      .filter((p) => p.sceneId);
  }
  // 转场列表：校验每项的类型白名单 + 时长范围（与 video-synthesis XFADE_TYPES 一致）
  if (Array.isArray(src.transitions)) {
    const transitionTypes = [
      "none",
      "fade",
      "fadeblack",
      "fadewhite",
      "dissolve",
      "wipeleft",
      "wiperight",
      "wipeup",
      "wipedown",
      "slideleft",
      "slideright",
      "slideup",
      "slidedown",
      "circleopen",
      "circleclose",
      "radial",
      "smoothleft",
      "smoothright",
    ];
    out.transitions = src.transitions
      .slice(0, 200)
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        type:
          typeof t.type === "string" && transitionTypes.includes(t.type)
            ? t.type
            : "fade",
        duration:
          typeof t.duration === "number"
            ? clampNumber(t.duration, 0.1, 2)
            : 0.3,
      }));
  }
  // 分镜滤镜/变速：校验滤镜 id 白名单 + 变速范围（与 video-synthesis FX_FILTERS 一致）
  if (Array.isArray(src.sceneEffects)) {
    const effectIds = [
      "bw",
      "vivid",
      "sepia",
      "cold",
      "warm",
      "vignette",
      "blur",
      "oldfilm",
      "sharpen",
      "vintage",
      "tealorange",
      "dreampurple",
    ];
    const motionIds = ["zoomIn", "zoomOut", "panLeft", "panRight"];
    const impactIds = ["shake", "flash", "freeze"];
    out.sceneEffects = src.sceneEffects
      .slice(0, MAX_SCENE_KEYED_ENTRIES)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        sceneId: typeof e.sceneId === "string" ? e.sceneId.slice(0, 64) : "",
        effect:
          typeof e.effect === "string" && effectIds.includes(e.effect)
            ? e.effect
            : null,
        speed: typeof e.speed === "number" ? clampNumber(e.speed, 0.25, 4) : 1,
        // 运镜/冲击（批4）三态保留：字段缺席=沿用默认（图片镜默认缓推）、
        // 显式 null=关闭默认、白名单值=指定效果。缺席时不落字段，防止把
        // 「没配置」固化成「显式关闭」。
        ...(e.motion !== undefined
          ? {
              motion:
                typeof e.motion === "string" && motionIds.includes(e.motion)
                  ? e.motion
                  : null,
            }
          : {}),
        ...(e.impact !== undefined
          ? {
              impact:
                typeof e.impact === "string" && impactIds.includes(e.impact)
                  ? e.impact
                  : null,
            }
          : {}),
      }))
      .filter((e) => e.sceneId);
  }
  // 背景音乐（BGM）：校验后整体放行 —— 不加这段则前端怎么存都进不了 DB，
  // 导出永远读不到 BGM（同 ffe4928/d128149 「白存」教训）。
  if (src.backgroundMusic && typeof src.backgroundMusic === "object") {
    const bm = src.backgroundMusic as Record<string, unknown>;
    out.backgroundMusic = {
      enabled: bm.enabled === true,
      ...(typeof bm.trackId === "string" && bm.trackId.length <= 64
        ? { trackId: bm.trackId }
        : {}),
      url: typeof bm.url === "string" && bm.url.length <= 2048 ? bm.url : "",
      volume:
        typeof bm.volume === "number" ? clampNumber(bm.volume, 0, 1) : 0.25,
      fadeIn:
        typeof bm.fadeIn === "number" ? clampNumber(bm.fadeIn, 0, 10) : 1.5,
      fadeOut:
        typeof bm.fadeOut === "number" ? clampNumber(bm.fadeOut, 0, 10) : 2.0,
      loop: bm.loop !== false,
      ducking: bm.ducking === true,
    };
  }
  // 音效列表（批1）：校验 sfxId 命中音效库 + 偏移/音量范围后放行 —— 不加这段
  // 则弹窗怎么存都进不了 DB，导出/预览永远读不到音效（同 BGM「白存」教训）。
  if (Array.isArray(src.sfx)) {
    out.sfx = src.sfx
      .slice(0, 400)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        sceneId: typeof e.sceneId === "string" ? e.sceneId.slice(0, 64) : "",
        sfxId:
          typeof e.sfxId === "string" && getSfxById(e.sfxId) ? e.sfxId : "",
        offsetSec:
          typeof e.offsetSec === "number"
            ? clampNumber(e.offsetSec, 0, 600)
            : 0,
        ...(typeof e.volume === "number"
          ? { volume: clampNumber(e.volume, 0, 1) }
          : {}),
      }))
      .filter((e) => e.sceneId && e.sfxId);
  }
  // 金句花字分镜 id 列表（批6）：字符串数组，每项截 64、去重、cap 上限 ——
  // 不加这段则解析层聚合到的金句分镜怎么存都进不了 DB，导出/预览读不到花字。
  if (Array.isArray(src.emphasis)) {
    const seen = new Set<string>();
    const emphasis: string[] = [];
    for (const raw of src.emphasis) {
      if (typeof raw !== "string") continue;
      const id = raw.slice(0, 64);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      emphasis.push(id);
      if (emphasis.length >= MAX_EMPHASIS_SCENES) break;
    }
    if (emphasis.length > 0) out.emphasis = emphasis;
  }
  // 全片 LUT 调色（批6）：enabled 严格布尔 + lutId 白名单校验（resolveLutPreset
  // 判合法，非法回退默认预设）—— 不加这段则调色选择怎么存都进不了 DB，导出读不到。
  if (src.colorGrade && typeof src.colorGrade === "object") {
    const cg = src.colorGrade as Record<string, unknown>;
    const lutId =
      typeof cg.lutId === "string" && resolveLutPreset(cg.lutId)
        ? cg.lutId
        : DEFAULT_COLOR_GRADE.lutId;
    out.colorGrade = {
      enabled: cg.enabled === true,
      lutId,
    };
  }
  // 片头/片尾卡开关（批6）：title/end 仅当为 boolean 时收录（缺省由导出端按
  // resolveTitleCardsEnabled 契约解析，系列默认开、非系列默认关）—— 不加这段则
  // 弹窗里的卡片开关怎么存都进不了 DB。
  if (src.titleCards && typeof src.titleCards === "object") {
    const tc = src.titleCards as Record<string, unknown>;
    const titleCards: Record<string, boolean> = {};
    if (typeof tc.title === "boolean") titleCards.title = tc.title;
    if (typeof tc.end === "boolean") titleCards.end = tc.end;
    out.titleCards = titleCards;
  }
  // 制片人审阅态（一键 AI 制片人 3.1）：白名单归一化后整体放行 —— 不加这段则
  // 前端逐项确认怎么存都进不了 DB，审阅进度静默丢失（同 subtitleStyle 白存教训）。
  const normalizedProducerReview = normalizeProducerReview(src.producerReview);
  if (normalizedProducerReview) {
    out.producerReview = normalizedProducerReview;
  }
  // 混合出片策略（成本路由）：仅接受 "full" / "hybrid" 两个枚举值 —— 不加这段则
  // 编辑器「混合出片（经济模式）」开关怎么存都进不了 DB，一键管线读不到策略。
  if (src.renderStrategy === "full" || src.renderStrategy === "hybrid") {
    out.renderStrategy = src.renderStrategy;
  }

  // 防漏机制：本函数是白名单【重建】——新增 GenerationParams 字段却忘了在上面挂一
  // 分支，前端怎么存都进不了 DB（历史上 subtitleStyle / BGM / SFX / 花字都踩过这个
  // 「白存」坑，见各分支注释）。这里把「压根没有对应分支」的键告警出来，配合
  // round-trip 单测形成双保险。
  //
  // 判据用 GENERATION_PARAM_KEYS 而非「out 里有没有」：后者会把「字段已挂白名单但
  // 本次入参没通过校验」（如 emphasis: []、坐标非法）也误报成漏挂。
  // 只告警不放行：静默放行等于绕过白名单，安全语义不能让步。
  const unknownKeys = Object.keys(src).filter(
    (k) => !GENERATION_PARAM_KEYS.has(k) && src[k] !== undefined
  );
  if (unknownKeys.length > 0) {
    log.warn(
      `generationParams 出现白名单外字段（值被丢弃，若为新增功能字段请挂白名单分支 + GENERATION_PARAM_KEYS + round-trip fixture）: ${unknownKeys.join(", ")}`
    );
  }

  return out;
}

function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
