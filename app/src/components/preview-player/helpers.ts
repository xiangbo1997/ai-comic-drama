/**
 * PreviewPlayer 纯函数helper集合。
 *
 * 从 preview-player.tsx 原样抽出（零行为变更），便于单测覆盖：
 * 这些函数只依赖入参，不读组件状态、不碰 DOM ref，故可在 node 环境直接跑。
 */
import type { ScenePreview } from "@/types";
import type {
  SceneEffect,
  SceneEffectId,
  SceneMotion,
  SceneImpact,
  Transition,
  TransitionType,
  Sticker,
} from "@/types/export-style";
import {
  TITLE_CARD_SCENE_ID,
  END_CARD_SCENE_ID,
  type CardSpec,
} from "@/lib/title-cards";
import { isStickerVisibleAt } from "../preview-sticker-window";

/**
 * 把 aspectRatio 字符串（"9:16" / "1:1" / "16:9"）转成 CSS aspect-ratio 值。
 * 用于「画面框」声明式锁定成片比例——框即成片画布，字幕拖拽以此为坐标基准，
 * 与导出 ASS \pos(x*W,y*H) 像素级对齐（W/H 同比例，归一化坐标落点一致）。
 * 非法值回退 16/9。
 */
export function aspectRatioToCss(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map((n) => Number(n));
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return "16 / 9";
}

/**
 * 空态占位的 Tailwind 比例类（与 aspectRatioToCss 同一组比例的类名映射）。
 */
export function emptyAspectClass(aspectRatio: string): string {
  return aspectRatio === "9:16"
    ? "aspect-[9/16]"
    : aspectRatio === "1:1"
      ? "aspect-square"
      : "aspect-video";
}

/**
 * 解析某分镜的滤镜 id / 变速 / 运镜 / 冲击（与导出侧 resolveSceneEffect 等价）。
 * motion 保留 undefined（未配置）与 null（显式关）区分：图片分镜的默认 zoomIn
 * 契约由渲染处按 isImage && motion===undefined 兜底（对齐导出端 sceneToVideoClip）。
 */
export function resolveEffect(
  sceneId: string,
  effects?: SceneEffect[]
): {
  effect: SceneEffectId | null;
  speed: number;
  motion: SceneMotion | null | undefined;
  impact: SceneImpact | null;
} {
  const found = effects?.find((e) => e.sceneId === sceneId);
  const speed =
    found?.speed != null && !isNaN(Number(found.speed))
      ? Math.min(4, Math.max(0.25, Number(found.speed)))
      : 1;
  return {
    effect: found?.effect ?? null,
    speed,
    motion: found ? (found.motion ?? null) : undefined,
    impact: found?.impact ?? null,
  };
}

/**
 * 解析某衔接的转场类型与时长（与导出端 video-synthesis.resolveTransition 同源）。
 *
 * 剪辑节奏回归（批2）：无任何存储转场配置时默认硬切（none），而非旧 fade 0.3s
 * ——与导出端「无存储配置默认硬切」保持一致（预览必须反映导出效果的铁律）。
 * 一旦有存储配置就逐项尊重（缺项回落 fade，存量兼容）。"none" 视为无转场。
 */
export function resolveTransition(
  index: number,
  transitions?: Transition[]
): { type: TransitionType; duration: number } {
  const hasStored = Array.isArray(transitions) && transitions.length > 0;
  const t = transitions?.[index];
  // 缺省转场：有存储配置回落 fade（兼容），无存储配置回落 none（硬切）。
  const type = t?.type ?? (hasStored ? "fade" : "none");
  const duration =
    type === "none"
      ? 0
      : Math.min(2, Math.max(0.1, Number(t?.duration ?? 0.3)));
  return { type, duration };
}

/**
 * 片头/片尾卡注入：把非 null 的卡片包成「虚拟图片分镜」，intro 前置、outro 后置。
 * 卡片底图 → ScenePreview.imageUrl（走既有图片渲染 + Ken Burns 缓推），
 * durationSec → duration；无对白/旁白 → 天然不出普通字幕。
 * 用保留 sceneId（__title-card__/__end-card__）关联卡片文字层。
 */
export function injectTitleCards(
  rawScenes: ScenePreview[],
  titleCards?: { intro: CardSpec | null; outro: CardSpec | null }
): { scenes: ScenePreview[]; cardSpecById: Map<string, CardSpec> } {
  const intro = titleCards?.intro ?? null;
  const outro = titleCards?.outro ?? null;
  if (!intro && !outro) {
    return { scenes: rawScenes, cardSpecById: new Map<string, CardSpec>() };
  }
  const cardMap = new Map<string, CardSpec>();
  const list: ScenePreview[] = [];
  if (intro) {
    cardMap.set(TITLE_CARD_SCENE_ID, intro);
    list.push({
      id: TITLE_CARD_SCENE_ID,
      order: -1,
      duration: intro.durationSec,
      imageUrl: intro.imageUrl,
      videoUrl: null,
      audioUrl: null,
      dialogue: null,
      narration: null,
    });
  }
  list.push(...rawScenes);
  if (outro) {
    cardMap.set(END_CARD_SCENE_ID, outro);
    list.push({
      id: END_CARD_SCENE_ID,
      order: rawScenes.length,
      duration: outro.durationSec,
      imageUrl: outro.imageUrl,
      videoUrl: null,
      audioUrl: null,
      dialogue: null,
      narration: null,
    });
  }
  return { scenes: list, cardSpecById: cardMap };
}

/**
 * 有效时长查表化（perf a2 P1-1）：一次性算好每镜有效时长 + 前缀和，
 * 渲染期只做 O(1) 数组下标查（原逐次 sceneEffects.find 在 33fps 下每秒上千次）。
 */
export function computeDurations(
  scenes: ScenePreview[],
  sceneEffects: SceneEffect[] | undefined,
  measuredDurs: Record<string, number>
): { effDurs: number[]; prefixDurations: number[]; totalDuration: number } {
  // sceneId → speed 查表，消除逐镜 find
  const speedById = new Map<string, number>();
  for (const e of sceneEffects ?? []) {
    const raw = Number(e.speed);
    speedById.set(
      e.sceneId,
      raw && raw > 0 ? Math.min(4, Math.max(0.25, raw)) : 1
    );
  }
  const durs = scenes.map((s) => {
    const speed = speedById.get(s.id) ?? 1;
    // 有视频的分镜用「真实时长」（onLoadedMetadata 实测），回退 DB 声明值；
    // 图片分镜无真实媒体长度，仍用 s.duration。真实时长同样受变速影响。
    const base = s.videoUrl ? (measuredDurs[s.id] ?? s.duration) : s.duration;
    return base / speed;
  });
  // 前缀和：prefix[i] = 前 i 个镜的有效时长之和（用于整体进度，去掉内层循环）
  const prefix: number[] = [0];
  for (let i = 0; i < durs.length; i++) prefix.push(prefix[i] + durs[i]);
  return {
    effDurs: durs,
    prefixDurations: prefix,
    totalDuration: prefix[prefix.length - 1] ?? 0,
  };
}

/**
 * 整体进度（0-1）：已完成镜的累计时长直接读前缀和（O(1)），不再内层循环累加。
 */
export function overallProgressAt(
  prefixDurations: number[],
  effDurs: number[],
  currentIndex: number,
  progress: number,
  totalDuration: number,
  hasCurrentScene: boolean
): number {
  const elapsedBefore = prefixDurations[currentIndex] ?? 0;
  const elapsed =
    elapsedBefore +
    (hasCurrentScene ? (effDurs[currentIndex] ?? 0) * progress : 0);
  return totalDuration > 0 ? elapsed / totalDuration : 0;
}

/**
 * 整片已播时刻（秒）= 前缀和(已完成镜) + 当前镜有效时长 × progress。
 * BGM 包络与 SFX 调度共用同一时钟（与整体进度条同源）。
 */
export function elapsedAt(
  prefixDurations: number[],
  effDurs: number[],
  currentIndex: number,
  progress: number
): number {
  return (
    (prefixDurations[currentIndex] ?? 0) +
    (effDurs[currentIndex] ?? 0) * progress
  );
}

/** 播放时间显示 m:ss */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 当前分镜可见的贴图：时间窗判定与导出端 prepareStickers 同源
 * （仅当「当前镜内播放时刻」落在 [startOffset, startOffset+duration) 内）。
 */
export function visibleStickers(
  stickers: Sticker[] | undefined,
  sceneId: string,
  tInScene: number,
  sceneDuration: number
): Sticker[] {
  return (
    stickers?.filter(
      (st) =>
        st.sceneId === sceneId &&
        st.imageUrl &&
        isStickerVisibleAt(st, tInScene, sceneDuration)
    ) ?? []
  );
}

/**
 * 水印定位类名（与导出 overlay 位置一致）。
 */
export function watermarkPositionClass(position: string | undefined): string {
  return position === "tl"
    ? "top-3 left-3"
    : position === "tr"
      ? "top-3 right-3"
      : position === "bl"
        ? "bottom-3 left-3"
        : position === "center"
          ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          : "right-3 bottom-3";
}

/**
 * 描边/卡片文字宽度随画面高等比缩放的系数（stage 未测得时回退 1080 基准高）。
 */
export function stageScale(stageHeight: number, baseHeight: number): number {
  return (stageHeight > 0 ? stageHeight : baseHeight) / baseHeight;
}
