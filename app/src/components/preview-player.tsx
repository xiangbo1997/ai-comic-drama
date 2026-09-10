"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { ScenePreview } from "@/types";
import type {
  SubtitleStyle,
  SubtitlePosition,
  Watermark,
  Sticker,
  Transition,
  SceneEffect,
  SceneEffectId,
  BackgroundMusic,
  SceneSfx,
} from "@/types/export-style";
// 混合出片成本路由：图片分镜默认运镜先按导演 cameraMovement 派生（双端同构单一真源）。
import { resolveDefaultMotion } from "@/lib/render-mode";
import {
  resolveSubtitleFontPx,
  SUBTITLE_QUICK_POSITIONS,
} from "@/types/export-style";
import { typewriterDelays } from "@/lib/subtitle-segments";
import type { SubtitleAnimation } from "@/types/export-style";
// 字幕动效关键帧 + CSS 简写（与字幕样式面板共用同一实现，时序读 SUBTITLE_ANIM，
// 与导出端 ASS 标签对齐——预览=成片）。
import {
  SUBTITLE_KEYFRAMES_CSS,
  getSubtitleAnimationCss,
} from "@/lib/subtitle-css";
import { SceneFilterDefs } from "./scene-filters";
// 转场进度→样式映射 + 黑/白覆盖层（纯函数，与导出端 xfade 语义同源，抽出便于单测）
import {
  transitionCurrentLayerStyle,
  transitionOverlay,
} from "./preview-transitions";
// 冲击表现力 / Ken Burns 运镜的预览端 CSS（关键帧 + 映射函数），数值读共享常量，
// 与导出端 ffmpeg 滤镜同参数（预览=成片）。
import {
  IMPACT_KEYFRAMES_CSS,
  getMotionAnimationCss,
  getShakeAnimationCss,
  flashOverlayOpacityAt,
  isFreezeTailAt,
} from "./preview-impact-css";
import type { SceneMotion } from "@/types/export-style";
// 成片包装（批6）：字幕字体 / 金句花字 / 全片 LUT / 片头片尾卡，
// 均与导出端共用同一份契约常量（预览=成片的单一真源）。
import { EMPHASIS_STYLE } from "@/types/export-style";
import { resolveLutPreset } from "@/lib/color-grade";
import type { ColorGrade } from "@/lib/color-grade";
import { isCardSceneId } from "@/lib/title-cards";
import type { CardSpec } from "@/lib/title-cards";
// AI 生成内容提示标识（合规，广电总局令第 16 号第三十四条）：与导出端
// （ass/builder 的 AiDisclosure 样式）共用 lib/ai-disclosure 的配置解析与几何契约。
import {
  resolveAiDisclosure,
  isDisclosureVisibleAt,
  type AiDisclosure,
} from "@/lib/ai-disclosure";
// ── 抽出的纯函数 helper 与 hook（零行为变更的结构化拆分）──────────────
import {
  aspectRatioToCss,
  emptyAspectClass,
  resolveEffect,
  resolveTransition,
  injectTitleCards,
  computeDurations,
  overallProgressAt,
  watermarkPositionClass,
} from "./preview-player/helpers";
import { useMediaRegistry } from "./preview-player/use-media-registry";
import { usePlaybackClock } from "./preview-player/use-playback-clock";
import { useTransitionBuffer } from "./preview-player/use-transition-buffer";
import {
  useStageHeight,
  useStageWidth,
} from "./preview-player/use-stage-height";
import { useOverlayDrag } from "./preview-player/use-overlay-drag";
import { useBgm } from "./preview-player/use-bgm";
import { useSfxScheduler } from "./preview-player/use-sfx-scheduler";
import { useSubtitleTimeline } from "./preview-player/use-subtitle-timeline";
import { CardOverlay } from "./preview-player/card-overlay";
import { DisclosureOverlay } from "./preview-player/disclosure-overlay";
import { SubtitleOverlay } from "./preview-player/subtitle-overlay";
import { StickerLayer } from "./preview-player/sticker-layer";
import { SafeAreaOverlay } from "./preview-player/safe-area-overlay";
import { MediaLayers } from "./preview-player/media-layers";
import { PlayerControls } from "./preview-player/player-controls";

interface PreviewPlayerProps {
  scenes: ScenePreview[];
  aspectRatio: string;
  onSceneChange?: (sceneId: string) => void;
  currentSceneId?: string;
  /** 全片字幕样式（与导出保持一致的预览） */
  subtitleStyle?: SubtitleStyle;
  /**
   * 各分镜字幕位置覆盖（按 sceneId）。未含某分镜时回退 subtitleStyle.position。
   * 由编辑器从 generationParams.subtitlePositions 注入。
   */
  subtitlePositions?: SubtitlePosition[];
  /**
   * 用户拖拽 / 快捷选择字幕位置时回调（归一化中心点坐标）。
   * 上层负责落库到 generationParams.subtitlePositions（按 sceneId upsert）。
   * 缺省时字幕不可拖拽（纯预览只读，如导出弹窗内的预览）。
   */
  onSubtitlePositionChange?: (sceneId: string, x: number, y: number) => void;
  /**
   * 用户在预览里拖字幕四角改字号时回调（全片统一样式）。
   * 上层负责落库到 generationParams.subtitleStyle。与时间轴字幕样式弹窗同一数据源，
   * 保证两处一致。缺省时不显示角控点（纯预览只读）。
   */
  onSubtitleStyleChange?: (style: SubtitleStyle) => void;
  /** 全片商标水印（预览叠加 logo） */
  watermark?: Watermark;
  /** 贴图列表（预览时按当前分镜叠加） */
  stickers?: Sticker[];
  /**
   * 用户在预览里直接拖拽贴图时回调（归一化锚点坐标 x/y ∈ [0,1]）。
   * 上层负责落库到 generationParams.stickers（按 stickerId upsert x/y）。
   * 与导出端 overlay 锚点同构（left_px = x*(W-w)）。
   * 缺省时贴图不可拖（纯预览只读，保持向后兼容，如导出弹窗内的预览）。
   */
  onStickerPositionChange?: (stickerId: string, x: number, y: number) => void;
  /** 分镜间转场（第 k 项 = 第 k 与 k+1 分镜之间），双层叠化预览 */
  transitions?: Transition[];
  /** 分镜滤镜 / 变速（按 sceneId），预览用 SVG filter 精确复现 */
  sceneEffects?: SceneEffect[];
  /** 背景音乐（预览时循环播放，让用户听到导出后的 BGM 效果） */
  backgroundMusic?: BackgroundMusic;
  /**
   * 音效列表（按 sceneId + 镜内偏移触发；与导出端 buildSfxSchedule 同源语义）。
   * 预览播放跨过触发时刻时播放对应 one-shot/环境音，暂停/回退同步停止。
   */
  sfx?: SceneSfx[];
  /**
   * 金句花字分镜 id 列表（generationParams.emphasis）。命中且有对白的分镜，
   * 其字幕以 EMPHASIS_STYLE（大字 + 强调色 + pop 弹入 + 加粗描边）渲染，
   * 与导出端 ASS 专用 Emphasis 样式同源（预览=成片）。
   */
  emphasisSceneIds?: string[];
  /**
   * 全片 LUT 调色（generationParams.colorGrade）。启用时对「画面」（img/video）
   * 应用近似 CSS filter，不作用于字幕/水印/贴图覆盖层（导出端 LUT 在字幕之前）。
   * CSS filter 无法精确等价 3D LUT，UI 已明示「预览为近似效果」。
   */
  colorGrade?: ColorGrade;
  /**
   * 片头 / 片尾卡（buildTitleCards 产出）。非 null 时在时间轴首/尾注入虚拟分镜
   * （底图 + Ken Burns 缓推 + 得意黑大字覆盖层），与导出端注入成片首尾同源。
   */
  titleCards?: { intro: CardSpec | null; outro: CardSpec | null };
  /**
   * AI 生成内容提示标识（generationParams.aiDisclosure，合规）。
   *
   * ⚠️ 缺省即启用（法定要求，见 lib/ai-disclosure 的 resolveAiDisclosure 契约）——
   * 不传此 prop 的调用方预览里同样会看到标识，与导出成片一致（预览=成片铁律）。
   */
  aiDisclosure?: AiDisclosure;
}

export function PreviewPlayer({
  scenes: rawScenes,
  aspectRatio,
  onSceneChange,
  currentSceneId,
  subtitleStyle,
  subtitlePositions,
  onSubtitlePositionChange,
  onSubtitleStyleChange,
  watermark,
  stickers,
  onStickerPositionChange,
  transitions,
  sceneEffects,
  backgroundMusic,
  sfx,
  emphasisSceneIds,
  colorGrade,
  titleCards,
  aiDisclosure,
}: PreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  // 转场进度 0-1：>0 表示正在向下一镜叠化（驱动双层透明度/位移）
  const [transitionT, setTransitionT] = useState(0);
  // 快捷位置浮层开关
  const [showQuickPos, setShowQuickPos] = useState(false);
  // 平台 UI 安全区参考层开关（默认关，避免干扰常规预览；摆字幕位置时手动开）
  const [showSafeArea, setShowSafeArea] = useState(false);

  // 媒体元素登记表 + 实测时长（无 effect，故调用位置不影响 effect 顺序）
  const {
    measuredDurs,
    measuredAudioDurs,
    videoElsRef,
    audioRef,
    bgmRef,
    handleLoadedMetadata,
    handleAudioLoadedMetadata,
    getVideoRefCb,
  } = useMediaRegistry();

  // 画面框（成片比例画布）：字幕拖拽以此为坐标基准（归一化换算用其 rect），
  // 与导出端画面分辨率同坐标系，确保「拖到哪 = 导出到哪」。
  const stageRef = useRef<HTMLDivElement>(null);

  // 片头/片尾卡注入（批6）：把非 null 的卡片包成「虚拟图片分镜」，intro 前置、
  // outro 后置到时间轴。所有既有播放/计时/进度/转场逻辑都以 `scenes`（下面重绑为
  // 有效数组）为准，虚拟分镜天然融入无需改动；cardSpecById 供卡片文字覆盖层查询。
  const { scenes, cardSpecById } = useMemo(
    () => injectTitleCards(rawScenes, titleCards),
    [rawScenes, titleCards]
  );

  const currentScene = scenes[currentIndex];
  const nextScene =
    currentIndex < scenes.length - 1 ? scenes[currentIndex + 1] : null;
  // 当前镜是否为片头/片尾卡（决定是否渲染卡片文字层、抑制普通字幕/贴图工具条）
  const currentCard = currentScene
    ? (cardSpecById.get(currentScene.id) ?? null)
    : null;

  // 场景切换上抛：虚拟卡片 id 不上抛（上层 setSelectedSceneId 会因无匹配分镜
  // 而误清选中态）。真实分镜 id 照常上抛，行为与批6前完全一致。
  const emitSceneChange = useCallback(
    (sceneId: string) => {
      if (isCardSceneId(sceneId)) return;
      onSceneChange?.(sceneId);
    },
    [onSceneChange]
  );

  // 当前镜与下一镜的滤镜/变速/运镜/冲击
  const curFx = currentScene
    ? resolveEffect(currentScene.id, sceneEffects)
    : { effect: null, speed: 1, motion: undefined, impact: null };
  const nextFx = nextScene
    ? resolveEffect(nextScene.id, sceneEffects)
    : { effect: null, speed: 1, motion: undefined, impact: null };
  // 当前镜右侧转场（与下一镜之间）
  const curTransition = resolveTransition(currentIndex, transitions);

  // 全片 LUT 近似（批6）：启用且命中预设时，取其 cssFilter 串接到「画面」媒体
  // 元素（img/video），与分镜滤镜叠加共存；字幕/水印/贴图覆盖层不受染色
  // （导出端 lut3d 在字幕之前，只染画面）。CSS filter 无法精确等价 3D LUT，
  // UI 已明示「预览为近似效果」。
  const lutCssFilter =
    colorGrade?.enabled && resolveLutPreset(colorGrade.lutId)
      ? resolveLutPreset(colorGrade.lutId)!.cssFilter
      : null;

  // 是否预热下一镜视频（带宽敏感）：仅在「播放中 且 当前镜已播过 60%」时为真。
  // 此时才把下一镜 preload 升到 auto 提前拉取，覆盖切镜黑屏空档；其余时间
  // 下一镜只 preload=metadata，不与当前镜争抢有限带宽（服务器出口 ~650KB/s）。
  // 已在转场中（transitionT>0）也预热，保证叠化时下一镜有画面。
  const shouldPreheatNext = isPlaying && (progress >= 0.6 || transitionT > 0);

  // 双层媒体的「单一渲染源」：始终 [当前镜, 下一镜] 顺序，各带角色与滤镜。
  // React 按 key(scene.id) 匹配子节点：currentIndex 前进后原「下一镜」的 key
  // 出现在数组首位，其 DOM 节点被复用为新「当前镜」，播放无缝延续。
  // 末镜无 nextScene → 只渲当前镜一层。
  const mediaLayers: Array<{
    scene: ScenePreview;
    role: "current" | "next";
    effect: SceneEffectId | null;
  }> = [];
  if (currentScene) {
    mediaLayers.push({
      scene: currentScene,
      role: "current",
      effect: curFx.effect,
    });
  }
  if (nextScene) {
    mediaLayers.push({ scene: nextScene, role: "next", effect: nextFx.effect });
  }

  // 有效时长查表化（perf a2 P1-1）：播放时 setState(~30ms) 触发全量重渲，
  // 原 effDur/totalDuration/calculateOverallProgress 每次各自 O(n×m) 遍历
  // sceneEffects.find，33fps 下每秒上千次 find。改为 useMemo 一次性算好
  // 每镜有效时长 + 前缀和，渲染期只做 O(1) 数组下标查。
  const { effDurs, prefixDurations, totalDuration } = useMemo(
    () => computeDurations(scenes, sceneEffects, measuredDurs),
    [scenes, sceneEffects, measuredDurs]
  );

  // ── 冲击表现力 / Ken Burns 运镜（预览端，与导出端 ffmpeg 同参数）─────────────
  // 当前镜内已播秒数（相对镜头起点）：flash 三角脉冲与 freeze 定格判定用，与画面同源。
  const curEffDur = effDurs[currentIndex] ?? currentScene?.duration ?? 0;
  const tInScene = progress * curEffDur;
  // Ken Burns 运镜 CSS：图片分镜默认运镜先按导演 cameraMovement 派生
  // （resolveDefaultMotion，映射不到再回落 zoomIn，对齐导出端 sceneToVideoClip 契约）；
  // 视频分镜不加运镜（自带运动）。铺满整镜有效时长。
  const curIsImage = !!currentScene && !currentScene.videoUrl;
  const curMotion: SceneMotion | null = curIsImage
    ? curFx.motion === undefined
      ? (resolveDefaultMotion(currentScene?.cameraMovement) ?? "zoomIn")
      : curFx.motion
    : null;
  const curMotionCss = getMotionAnimationCss(curMotion, curEffDur);
  // 震屏 CSS：图片轻震 / 视频重震（与导出端 buildClipVideoFilter 档位一致）。
  const curShakeCss =
    curFx.impact === "shake" ? getShakeAnimationCss(curIsImage) : undefined;
  // 当前镜媒体层动画：运镜与震屏叠加时以 ", " 拼多条 animation。震屏落镜头前窗，
  // 运镜铺满整镜——两者作用不同阶段可共存（CSS 会同时跑，震屏窗结束后归位）。
  const curMediaAnimation =
    [curMotionCss, curShakeCss].filter(Boolean).join(", ") || undefined;
  // 闪白覆盖层 opacity：progress 落在闪白窗内按三角脉冲（与导出端 flashIntensityAt 同源）。
  const curFlashOpacity =
    curFx.impact === "flash" && isPlaying ? flashOverlayOpacityAt(tInScene) : 0;
  // 定格：镜尾 tailSec 内暂停视频画面（近似导出端镜内定格；图片本就静止天然成立）。
  const curFreezeActive =
    curFx.impact === "freeze" && isFreezeTailAt(tInScene, curEffDur);

  // 同步外部选中的场景
  const sceneIndex = currentSceneId
    ? scenes.findIndex((s) => s.id === currentSceneId)
    : -1;

  // SFX 已触发集合的重置入口：计时器播完归零时需要清空，但 useSfxScheduler
  // 的三个 effect 必须留在 effect 序列最后（顺序即时序契约），故经这个恒定 ref
  // 做前向引用；ref 只在 effect / 计时器回调里读写，不在渲染期访问。
  const resetSfxProgressRef = useRef<() => void>(() => {});
  const resetSfxProgress = useCallback(() => {
    resetSfxProgressRef.current();
  }, []);

  // ── effect 1~4：外部选中同步 / 时长镜像 ref / 30ms 计时器 / 手动切镜重置转场 ──
  usePlaybackClock({
    scenes,
    currentScene,
    currentIndex,
    setCurrentIndex,
    progress,
    setProgress,
    transitionT,
    setTransitionT,
    isPlaying,
    setIsPlaying,
    sceneIndex,
    curEffDuration: effDurs[currentIndex] ?? currentScene?.duration ?? 0,
    curTransitionDuration: curTransition.duration,
    curSpeed: curFx.speed,
    emitSceneChange,
    videoElsRef,
    audioRef,
    bgmRef,
    backgroundMusic,
    resetSfxProgress,
  });

  // ── effect 5~6：镜尾定格 / 转场预播下一镜 ──
  useTransitionBuffer({
    currentScene,
    nextScene,
    isPlaying,
    transitionT,
    nextSpeed: nextFx.speed,
    curFreezeActive,
    videoElsRef,
  });

  // ── effect 7：ResizeObserver 跟踪画面框高 ──
  const stageHeight = useStageHeight(stageRef);
  // ── effect 7b：ResizeObserver 跟踪画面框宽（AI 标识边距按画面宽换算，
  //    与导出端 disclosureAssPos 的 margin 同基准）──
  const stageWidth = useStageWidth(stageRef);

  // ── effect 8~12：拖拽乐观值收尾 ×3 + 切镜清 dragXY + 滚轮计时器卸载清理 ──
  const {
    dragXY,
    dragSticker,
    dragFontSize,
    subtitleBoxRef,
    subtitleEditable,
    stickerEditable,
    subtitleResizable,
    currentSubtitleXY,
    handleSubtitleDragStart,
    handleSubtitleResizeStart,
    handleSubtitleResizeMove,
    handleSubtitleResizeEnd,
    handleSubtitleWheel,
    handleStickerDragStart,
    applyQuickPosition,
  } = useOverlayDrag({
    currentScene,
    subtitleStyle,
    subtitlePositions,
    stickers,
    onSubtitlePositionChange,
    onSubtitleStyleChange,
    onStickerPositionChange,
    stageRef,
    setShowQuickPos,
  });

  // ── effect 13：静音命令式管理（据 videoElsRef 表按角色取节点）──
  //
  // 必须命令式设置 muted：React 的 muted JSX 属性对「已挂载 <video>」更新不
  // 可靠，且双层媒体经 keyed 复用后同一 <video> 节点会在「当前镜 / 下一镜」
  // 两角色间流转，JSX 属性无法跟随角色互换。
  // - 当前镜视频：muted = isMuted（跟随用户静音开关）
  // - 下一镜视频：恒 muted（转场预播时不能出声，避免双声）
  useEffect(() => {
    const curEl = currentScene?.videoUrl
      ? videoElsRef.current.get(currentScene.id)
      : undefined;
    const nextEl = nextScene?.videoUrl
      ? videoElsRef.current.get(nextScene.id)
      : undefined;
    if (curEl) curEl.muted = isMuted;
    if (nextEl) nextEl.muted = true;
    if (audioRef.current) audioRef.current.muted = isMuted;
    if (bgmRef.current) bgmRef.current.muted = isMuted;
    // videoElsRef / audioRef / bgmRef 均为恒定 ref 容器，依赖数组与拆分前一致。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isMuted, currentScene, nextScene]);

  // ── effect 14：BGM 音量包络 ──
  useBgm({
    backgroundMusic,
    bgmRef,
    prefixDurations,
    effDurs,
    currentIndex,
    progress,
    totalDuration,
    currentScene,
    isPlaying,
  });

  // ── effect 15~17：SFX 调度 / 起播重置 / 卸载停止 ──
  const { resetSfxProgress: sfxReset } = useSfxScheduler({
    sfx,
    scenes,
    prefixDurations,
    effDurs,
    transitions,
    currentIndex,
    progress,
    isPlaying,
    isMuted,
  });
  // 前向引用回填（effect 18，序列末位）：sfxReset 为恒定 identity 的
  // useCallback，本 effect 只在挂载后跑一次；计时器的 wrap-around 分支
  // 只可能在挂载之后触发，故不存在「尚未回填就被调用」的空窗。
  useEffect(() => {
    resetSfxProgressRef.current = sfxReset;
  }, [sfxReset]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setProgress(0);
      emitSceneChange(scenes[currentIndex - 1].id);
    }
  };

  const goToNext = () => {
    if (currentIndex < scenes.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setProgress(0);
      emitSceneChange(scenes[currentIndex + 1].id);
    }
  };

  const calculateOverallProgress = () =>
    overallProgressAt(
      prefixDurations,
      effDurs,
      currentIndex,
      progress,
      totalDuration,
      !!currentScene
    );

  /**
   * 计算转场叠化时「当前镜（上层）」的视觉样式。
   * 委托给 preview-transitions 纯函数——覆盖全部 17 种 xfade 类型（fade、dissolve、
   * slide 四向、wipe 四向、circleopen、circleclose、radial、smooth 双向），
   * fadeblack/fadewhite 的中间黑/白场由下方独立覆盖层（transitionOverlay）承接。
   */
  const transitionLayerStyle = (): React.CSSProperties =>
    transitionCurrentLayerStyle(curTransition.type, transitionT);

  // 转场黑/白覆盖层：仅 fadeblack/fadewhite 有值——前半程画面淡入纯色，后半程
  // 纯色淡出露新画面（两段式）。z-10 契约：必须显式高于媒体层（zIndex 1/2）。
  const overlay = transitionOverlay(curTransition.type, transitionT);

  // 字幕预览字号：把 fontSize(1080 基准) 按画面框实际高等比缩放，与导出端
  // ASS Fontsize 共用 resolveSubtitleFontPx → 预览所见字号 ≈ 成片字号。
  // stageHeight 未测得(初始 0)时函数内部回退基准高，避免首帧字号异常。
  // 拖角改字号时优先用本地乐观值 dragFontSize（即时跟手，不被 refetch 刷回）。
  const effectiveFontSize = dragFontSize ?? subtitleStyle?.fontSize;
  const subtitleFontPx = resolveSubtitleFontPx(effectiveFontSize, stageHeight);

  // 金句花字（批6）：当前分镜命中 emphasisSceneIds 且有对白 → 字幕以
  // EMPHASIS_STYLE 渲染（字号 ×fontScale、强调色、pop 弹入、描边 ×outlineScale）。
  // 与导出端 ASS 专用 Emphasis 样式同源；其余分镜行为不变。
  const isEmphasisScene =
    !!currentScene &&
    !!currentScene.dialogue &&
    (emphasisSceneIds?.includes(currentScene.id) ?? false);
  // 花字字号：正文字号 ×fontScale（在已按画面高缩放的 subtitleFontPx 上再放大）。
  const emphasisFontPx = isEmphasisScene
    ? Math.round(subtitleFontPx * EMPHASIS_STYLE.fontScale)
    : subtitleFontPx;

  // ── AI 生成内容提示标识（合规，广电总局令第 16 号第三十四条）────────────
  // 配置解析与导出端共用 resolveAiDisclosure（缺省即启用），可见性判据共用
  // isDisclosureVisibleAt——两端读同一份时间窗语义，预览所见即成片所见。
  const resolvedDisclosure = useMemo(
    () => resolveAiDisclosure(aiDisclosure),
    [aiDisclosure]
  );
  // 成片轴已播秒数 = 本镜之前的前缀时长 + 镜内已播（与导出端 ASS 时间轴同源）。
  // mode="head" 时据此判断是否已过片头窗口；mode="always" 时恒可见。
  const elapsedSec =
    (prefixDurations[currentIndex] ?? 0) +
    progress * (effDurs[currentIndex] ?? 0);
  const disclosureVisible = isDisclosureVisibleAt(
    resolvedDisclosure,
    elapsedSec,
    totalDuration
  );

  // 逐句字幕时间窗 + 当前生效句（纯 memo，无副作用，故不影响 effect 顺序）
  const { activeSubtitleIndex, activeSubtitleText, activeSubtitleDuration } =
    useSubtitleTimeline({
      currentScene,
      measuredAudioDurs,
      effDurs,
      currentIndex,
      progress,
    });

  // 入场动效：缺省 fade（与旧行为、导出端解析规则一致）。
  // 金句花字强制走 pop（视觉签名统一，忽略全局 animation，与 EMPHASIS_STYLE 一致）。
  const subtitleAnimation: SubtitleAnimation = isEmphasisScene
    ? EMPHASIS_STYLE.animation
    : (subtitleStyle?.animation ?? "fade");

  // 非 typewriter 动效映射为 <p> 的 CSS animation 简写（时序读共享常量，
  // 与导出端 libass 标签对齐）。typewriter 返回 undefined——它由逐字符 span
  // 各自带 subtitleCharReveal 动画驱动，<p> 本身不加整体动画。
  // 逻辑抽到 lib/subtitle-css 与字幕样式面板共用。
  const subtitleAnimationCss = getSubtitleAnimationCss(subtitleAnimation);

  // typewriter：把当前句拆成逐字符 + 各自显现延迟（与导出端 typewriterDelays 同源，
  // 换行规则一致：换行也占一个延迟槽）。仅 typewriter 动效时计算，避免无谓开销。
  const typewriterChars =
    subtitleAnimation === "typewriter" ? Array.from(activeSubtitleText) : null;
  const typewriterCharDelays =
    subtitleAnimation === "typewriter"
      ? typewriterDelays(activeSubtitleText, activeSubtitleDuration)
      : null;

  if (scenes.length === 0) {
    const emptyAspect = emptyAspectClass(aspectRatio);
    return (
      <div
        className={`bg-card flex ${emptyAspect} items-center justify-center rounded-xl`}
      >
        <p className="text-muted-foreground">暂无可预览的内容</p>
      </div>
    );
  }

  return (
    <div className="bg-card flex h-full w-full flex-col overflow-hidden rounded-xl">
      {/* Video/Image Display — 外层黑色容器：flex-1 占据除控制条外的剩余高度，
          min-h-0 允许收缩，居中承载「画面框」。仅放与画面无关的 UI 角标。 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {/* 画面框（stage）—— 按 aspectRatio 声明式锁定成片比例并自适应内缩。
            框 = 成片画布：媒体/水印/贴图/字幕全部以此为坐标基准，
            字幕拖拽的归一化坐标与导出 ASS \pos 像素级一致（所见即所得）。
            maxH/maxW 二选一受限，保证框完整落在黑色容器内（多余处留黑边）。 */}
        <div
          ref={stageRef}
          className="relative max-h-full max-w-full overflow-hidden bg-black"
          style={{
            aspectRatio: aspectRatioToCss(aspectRatio),
            height: "100%",
            // aspect-ratio + height:100% 会让宽度按比例算；若算出的宽超过容器，
            // max-w-full 收回宽度、高度随之按比例缩（横屏在窄容器里也完整可见）。
          }}
        >
          {/* SVG 滤镜定义（精确复现 FFmpeg FX_FILTERS），仅注入一次 */}
          <SceneFilterDefs />

          {/* 逐句字幕入场动效关键帧（与导出端 libass 标签时序一一对齐），仅注入一次。
              关键帧定义抽到 lib/subtitle-css，与字幕样式面板共用同一份。 */}
          <style>{SUBTITLE_KEYFRAMES_CSS}</style>
          <style>{IMPACT_KEYFRAMES_CSS}</style>

          {/* 双层媒体从「单一 keyed 数组」渲染（key=scene.id）——
              currentIndex 前进时，原「下一镜」层的 DOM 节点被 React 依 key 复用
              为「当前镜」，同一 <video> 播放不中断（消除切镜 remount 的黑屏/卡顿）。
              渲染细节抽到 preview-player/media-layers（纯展示组件，无 hook）。 */}
          <MediaLayers
            layers={mediaLayers}
            lutCssFilter={lutCssFilter}
            curMediaAnimation={curMediaAnimation}
            isPlaying={isPlaying}
            shouldPreheatNext={shouldPreheatNext}
            transitionT={transitionT}
            transitionLayerStyle={transitionLayerStyle}
            getVideoRefCb={getVideoRefCb}
            handleLoadedMetadata={handleLoadedMetadata}
          />

          {/* 转场黑/白覆盖层（仅 fadeblack/fadewhite）——两段式：画面先淡到纯色，
              再由纯色淡出露新画面。z-10 高于媒体层（zIndex 1/2），不吃指针。 */}
          {overlay && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                backgroundColor: overlay.color,
                opacity: overlay.opacity,
              }}
            />
          )}

          {/* 闪白冲击覆盖层（批4）——三角脉冲 opacity，与导出端 flashIntensityAt
              同源参数。z-10 契约同转场覆盖层。 */}
          {curFlashOpacity > 0 && (
            <div
              className="pointer-events-none absolute inset-0 z-10 bg-white"
              style={{ opacity: curFlashOpacity }}
            />
          )}

          {/* 片头/片尾卡文字层（批6）——当前镜为卡片时渲染得意黑大字覆盖层
              （底图 = 卡片虚拟分镜的 imageUrl，已由媒体层带 Ken Burns 缓推渲染）。 */}
          {currentCard && (
            <CardOverlay
              card={currentCard}
              subtitleFontPx={subtitleFontPx}
              stageHeight={stageHeight}
            />
          )}

          {/* Audio */}
          {currentScene?.audioUrl && (
            <audio
              ref={audioRef}
              src={currentScene.audioUrl}
              onLoadedMetadata={(e) =>
                handleAudioLoadedMetadata(
                  currentScene.id,
                  e.currentTarget as HTMLAudioElement
                )
              }
            />
          )}

          {/* 背景音乐（循环，预览反映导出后的 BGM） */}
          {backgroundMusic?.enabled && backgroundMusic.url && (
            <audio ref={bgmRef} src={backgroundMusic.url} loop />
          )}

          {/* Watermark — 全片商标水印预览（与导出 overlay 一致位置）。
              z-10：媒体层带显式 zIndex(1/2) 形成层叠序，所有覆盖元素必须
              显式高于它，否则会被画面盖住（DOM 顺序不再决定叠放）。 */}
          {watermark?.enabled && watermark.imageUrl && (
            <img
              src={watermark.imageUrl}
              alt=""
              className={`pointer-events-none absolute z-10 ${watermarkPositionClass(
                watermark.position
              )}`}
              style={{
                width: `${(watermark.scale ?? 0.12) * 100}%`,
                opacity: watermark.opacity ?? 0.8,
              }}
            />
          )}

          {/* 防呆：水印开关已开启但未上传 Logo —— 显式提示，
            避免“静默不渲染”被误判为功能失效（此前空 imageUrl 时整块短路不显示）。 */}
          {watermark?.enabled && !watermark.imageUrl && (
            <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border border-amber-400/60 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 backdrop-blur-sm">
              水印已开启，但未上传 Logo
            </div>
          )}

          {/* AI 生成内容提示标识（合规：广电总局令第 16 号第三十四条「每集明显
              位置添加提示标识」）。缺省即显示——与导出端 resolveAiDisclosure
              同一缺省契约，保证「预览所见 = 成片所见」。
              z-10：同水印/卡片层，显式高于带 zIndex 的媒体层。 */}
          {disclosureVisible && (
            <DisclosureOverlay
              disclosure={resolvedDisclosure}
              subtitleFontPx={subtitleFontPx}
              stageHeight={stageHeight}
              stageWidth={stageWidth}
            />
          )}

          {/* Stickers — 当前分镜的贴图预览（与导出 overlay 位置一致）。
              渲染细节抽到 preview-player/sticker-layer（纯展示组件，无 hook）。 */}
          {currentScene && (
            <StickerLayer
              stickers={stickers}
              sceneId={currentScene.id}
              tInScene={progress * (effDurs[currentIndex] ?? 0)}
              effDur={effDurs[currentIndex] ?? 0}
              dragSticker={dragSticker}
              stickerEditable={stickerEditable}
              handleStickerDragStart={handleStickerDragStart}
            />
          )}

          {/* Subtitles — 绝对定位到归一化坐标（中心点），支持逐分镜拖拽。
            与导出 ASS \pos(x*W,y*H) 用同一坐标系，确保预览=成片。
            渲染细节抽到 preview-player/subtitle-overlay（纯展示组件，无 hook）。 */}
          {showSubtitles &&
            (currentScene?.dialogue || currentScene?.narration) && (
              <SubtitleOverlay
                sceneId={currentScene.id}
                subtitleStyle={subtitleStyle}
                currentSubtitleXY={currentSubtitleXY}
                activeSubtitleIndex={activeSubtitleIndex}
                activeSubtitleText={activeSubtitleText}
                emphasisFontPx={emphasisFontPx}
                isEmphasisScene={isEmphasisScene}
                stageHeight={stageHeight}
                subtitleAnimationCss={subtitleAnimationCss}
                typewriterChars={typewriterChars}
                typewriterCharDelays={typewriterCharDelays}
                isPlaying={isPlaying}
                subtitleEditable={subtitleEditable}
                subtitleResizable={subtitleResizable}
                dragXY={dragXY}
                subtitleBoxRef={subtitleBoxRef}
                handleSubtitleDragStart={handleSubtitleDragStart}
                handleSubtitleWheel={handleSubtitleWheel}
                handleSubtitleResizeStart={handleSubtitleResizeStart}
                handleSubtitleResizeMove={handleSubtitleResizeMove}
                handleSubtitleResizeEnd={handleSubtitleResizeEnd}
              />
            )}

          {/* 平台 UI 安全区参考层 —— 标出抖音/快手会盖住的区域。
              放在字幕/贴图之下渲染顺序无关（都是 z-10 + pointer-events-none），
              仅作视觉参考，不参与导出。 */}
          <SafeAreaOverlay visible={showSafeArea} />

          {/* 字幕位置工具条 —— 仅可编辑时显示：快捷九宫格 + 安全区开关 + 拖拽提示 */}
          {subtitleEditable &&
            showSubtitles &&
            (currentScene?.dialogue || currentScene?.narration) && (
              <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSafeArea((v) => !v)}
                  className={`rounded-md px-2 py-1 text-xs backdrop-blur-sm transition ${
                    showSafeArea
                      ? "bg-red-500/70 text-white"
                      : "bg-black/60 text-white hover:bg-black/80"
                  }`}
                  title="显示抖音/快手等竖屏平台的 UI 遮挡区域，避免字幕被盖住"
                >
                  安全区
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickPos((v) => !v)}
                  className="rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm transition hover:bg-black/80"
                  title="拖动字幕可自由定位；点此快捷选择九宫格位置"
                >
                  字幕位置
                </button>
                {showQuickPos && (
                  <div className="mt-2 rounded-lg border border-white/15 bg-black/80 p-2 backdrop-blur-sm">
                    <div className="grid grid-cols-3 gap-1">
                      {SUBTITLE_QUICK_POSITIONS.map((pos) => (
                        <button
                          key={pos.label}
                          type="button"
                          onClick={() => applyQuickPosition(pos.x, pos.y)}
                          className="hover:bg-primary rounded px-2 py-1.5 text-[11px] text-white/80 transition hover:text-white"
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-center text-[10px] text-white/40">
                      或直接拖动字幕
                    </p>
                  </div>
                )}
              </div>
            )}
        </div>
        {/* ── 画面框（stage）结束 ── */}

        {/* Scene indicator —— 播放器角标，定位于外层黑色容器（不属于画面，不参与导出） */}
        <div className="absolute top-4 left-4 rounded bg-black/50 px-2 py-1 text-xs">
          {currentIndex + 1} / {scenes.length}
        </div>
      </div>

      {/* Controls — 控制条抽到 preview-player/player-controls（纯展示组件，无 hook） */}
      <PlayerControls
        overallProgress={calculateOverallProgress()}
        totalDuration={totalDuration}
        isPlaying={isPlaying}
        isMuted={isMuted}
        showSubtitles={showSubtitles}
        atFirst={currentIndex === 0}
        atLast={currentIndex === scenes.length - 1}
        onPrevious={goToPrevious}
        onTogglePlay={togglePlay}
        onNext={goToNext}
        onToggleMuted={() => setIsMuted(!isMuted)}
        onToggleSubtitles={() => setShowSubtitles(!showSubtitles)}
      />
    </div>
  );
}
