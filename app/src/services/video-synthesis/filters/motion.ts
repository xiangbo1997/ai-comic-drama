/**
 * 视频合成 —— 运镜 / 冲击表现力滤镜构建器（纯函数）
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）：Ken Burns 运镜、
 * 震屏 / 闪白 / 定格三种冲击重音、以及片段视频滤镜链的拼装。
 * 全部为纯字符串构建，不触碰进程与文件系统，便于单测。
 */

import type { SceneMotion, SceneImpact } from "@/types/export-style";
// 冲击表现力 / Ken Burns 运镜的共享参数（导出端与预览端读同一份，保证预览=成片）。
import {
  SHAKE_PARAMS,
  FLASH_PARAMS,
  FREEZE_PARAMS,
  KEN_BURNS_PARAMS,
  CLIP_FPS,
} from "@/lib/impact-effect-params";

/**
 * 构建图片分镜的 Ken Burns 运镜 zoompan 表达式（缓慢推拉/平移，杀「-loop 1 死图」）。
 *
 * 输入图片先放大（scale 到画面 2 倍）供 zoompan 采样，再按 motion 生成 z/x/y 表达式，
 * 最后输出回画面尺寸。d = 时长 × fps，fps 与 CLIP_FPS 对齐。
 *   - zoomIn   z 从 1 线性增到 maxScale（缓慢推近），画面居中
 *   - zoomOut  z 从 maxScale 线性回到 1（缓慢拉远），画面居中
 *   - panLeft  z 固定 maxScale，x 从右向左移（画面向左扫）
 *   - panRight z 固定 maxScale，x 从左向右移
 *
 * @param width         成片画面宽
 * @param height        成片画面高
 * @param motion        运镜类型
 * @param durationSec   分镜时长（秒），决定 d 帧数
 * @returns zoompan 滤镜片段（含前置 scale 上采样与后置 scale 归位）
 */
export function buildKenBurnsFilter(
  width: number,
  height: number,
  motion: SceneMotion,
  durationSec: number
): string {
  const fps = KEN_BURNS_PARAMS.fps;
  const maxScale = KEN_BURNS_PARAMS.maxScale;
  // 帧数（至少 1 帧，防 d=0）
  const d = Math.max(1, Math.round(durationSec * fps));
  // 上采样倍数：留足 zoompan 采样与平移余量（放大 2 倍避免边缘露黑）
  const upW = width * 2;
  const upH = height * 2;
  // 归一化进度 on/(d-1)（on 为 zoompan 当前帧序号），d=1 时退化为 0 防除零
  const denom = d > 1 ? d - 1 : 1;
  const progress = `(on/${denom})`;

  // z 表达式（推拉）与 x/y 表达式（平移/居中）
  let zExpr: string;
  let xExpr: string;
  let yExpr: string;
  // 居中：把放大后的采样窗对齐画面中心
  const centerX = `(iw-iw/zoom)/2`;
  const centerY = `(ih-ih/zoom)/2`;
  switch (motion) {
    case "zoomOut":
      zExpr = `${maxScale}-(${maxScale}-1)*${progress}`;
      xExpr = centerX;
      yExpr = centerY;
      break;
    case "panLeft":
      // z 固定放大；x 从最大偏移线性回到 0（采样窗自右向左 → 画面向左扫）
      zExpr = `${maxScale}`;
      xExpr = `(iw-iw/zoom)*(1-${progress})`;
      yExpr = centerY;
      break;
    case "panRight":
      zExpr = `${maxScale}`;
      xExpr = `(iw-iw/zoom)*${progress}`;
      yExpr = centerY;
      break;
    case "zoomIn":
    default:
      zExpr = `1+(${maxScale}-1)*${progress}`;
      xExpr = centerX;
      yExpr = centerY;
      break;
  }
  // 前置放大 → zoompan（按帧推进）→ 归位到画面尺寸，末尾 fps 归一
  return (
    `scale=${upW}:${upH},` +
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${d}:s=${width}x${height}:fps=${fps}`
  );
}

/**
 * ── 冲击滤镜的时间坐标系约定（变速 × 冲击窗对齐，务必先读）──
 *
 * buildClipVideoFilter 的链序是：画面(scale/pad 或 KenBurns) → FX → 冲击 → setpts=PTS/speed
 * → fps。冲击滤镜挂在 setpts **之前**，其表达式里的 `t`（以及 enable 的 `t`）读的是
 * **源时间轴**；setpts 之后源时刻 t 会出现在成片时刻 t/speed。
 *
 * 所以「源轴窗口 D 秒」在成片里只持续 D/speed 秒。预览端按成片轴计时
 * （preview-player 的 tInScene = progress × effDur，effDur 已除过 speed），窗口是常量
 * SHAKE/FLASH_PARAMS.durationSec。要让两端一致，源轴窗口必须写成 durationSec × speed
 * ——这样成片轴上表现出的窗口恰为 durationSec，与预览相同。
 *
 * 因此本组 build*Filter 一律接收 speed 并把窗口秒数（及频率相位）换算到源轴：
 *   - 窗长：dur × speed（衰减/脉冲/enable 区间都用它）
 *   - 频率：f / speed（源轴上放慢频率，成片轴回到 f Hz，震屏手感不随倍速漂移）
 * speed=1 时所有换算为恒等，行为与改动前完全一致（零回归）。
 */

/**
 * 构建冲击「震屏」滤镜片段：放大 + 裁剪窗按共享正弦公式抖动（落在镜头前 durationSec）。
 *
 * 与预览端 CSS 读同一份 SHAKE_PARAMS（幅度/频率/衰减），逐帧位移用与 shakeOffsetAt
 * 相同的正弦×线性衰减公式表达（ffmpeg 用 t 时间变量）。窗外（t≥窗长）位移
 * 表达式自然归 0（衰减因子 max(0,1-t/dur) 为 0），画面归位。
 *
 * @param width      画面宽
 * @param height     画面高
 * @param intensity  档位（light/heavy）
 * @param speed      该镜倍速（窗长/频率按源轴换算，见上方坐标系约定）
 * @returns scale + crop 抖动滤镜片段
 */
export function buildShakeFilter(
  width: number,
  height: number,
  intensity: "light" | "heavy",
  speed: number
): string {
  const cfg = SHAKE_PARAMS[intensity];
  // 源轴窗长 = 成片轴窗长 × speed（setpts 之后被压缩回 durationSec）
  const dur = SHAKE_PARAMS.durationSec * speed;
  const pad = SHAKE_PARAMS.zoomPad;
  // 源轴频率 = 目标频率 / speed（变速后回到目标 Hz，抖动手感不随倍速变化）
  const freqHz = cfg.frequencyHz / speed;
  // 振幅按画面高相对 1080 基准缩放（参数以 @1080 定义），跨分辨率视觉一致
  const ampPx = (cfg.amplitudePx * height) / 1080;
  const upW = Math.round(width * pad);
  const upH = Math.round(height * pad);
  // 衰减因子：max(0,1-t/dur)，窗外为 0；正弦项 sin(2π f t)（t/dur/f 均为源轴量）
  const decay = `max(0\\,1-t/${dur.toFixed(4)})`;
  const sine = `sin(2*PI*${freqHz.toFixed(4)}*t)`;
  const offset = `(${ampPx.toFixed(2)})*${decay}*${sine}`;
  // 裁剪窗中心 = 放大余量中点 ± 抖动位移；x/y 各自抖动（y 用 cos 相位差制造二维晃动）
  const cosine = `cos(2*PI*${freqHz.toFixed(4)}*t)`;
  const offsetY = `(${ampPx.toFixed(2)})*${decay}*${cosine}`;
  return (
    `scale=${upW}:${upH},` +
    `crop=${width}:${height}:'(iw-${width})/2+${offset}':'(ih-${height})/2+${offsetY}'`
  );
}

/**
 * 构建冲击「闪白」滤镜片段：镜头前 durationSec 内亮度三角脉冲（骤亮再回落）。
 *
 * 与预览端白色覆盖层读同一份 FLASH_PARAMS。用 eq=brightness 配 enable 时间窗；
 * brightness 表达式用「三角脉冲 × 峰值」，与 flashIntensityAt 同形（前半升后半降）。
 *
 * @param speed 该镜倍速——窗长按源轴换算（见上方坐标系约定），使成片轴脉冲恒为
 *   FLASH_PARAMS.durationSec，与预览端一致。
 */
export function buildFlashFilter(speed: number): string {
  // 源轴窗长 = 成片轴窗长 × speed（eq 的 enable/brightness 都读源轴 t）
  const dur = FLASH_PARAMS.durationSec * speed;
  const half = dur / 2;
  const peak = FLASH_PARAMS.peakBrightness;
  // 三角脉冲：t<half 时 t/half，否则 1-(t-half)/half；乘峰值亮度
  const halfExpr = half.toFixed(4);
  const tri = `if(lt(t\\,${halfExpr})\\,t/${halfExpr}\\,1-(t-${halfExpr})/${halfExpr})`;
  const bright = `${peak}*${tri}`;
  return `eq=brightness='${bright}':enable='between(t,0,${dur.toFixed(4)})'`;
}

/**
 * 构建冲击「定格」滤镜片段：镜尾冻结最后一帧 tailSec，且总时长不变（在镜内定格）。
 *
 * 契约（见 FREEZE_PARAMS 注释）：不延长镜头。做法 = 先 trim 掉镜尾 tailSec 的动态
 * 内容，再用 tpad 克隆末帧补回 tailSec，净时长守恒。分镜过短（≤ tailSec×2）时跳过定格
 * （返回空串，调用方不拼），避免把整镜冻死。
 *
 * 坐标系（见上方约定）：trim/tpad 挂在 setpts 之前，其秒数是**源轴**量，故源轴上
 * 定格 tail×speed 秒，经 setpts 压缩后成片轴恰为 tailSec（与预览端 isFreezeTailAt
 * 的常量 tailSec 一致）。入参 durationSec 是成片轴有效时长，先乘回 speed 换算源轴。
 *
 * @param durationSec 分镜成片轴有效时长（秒，= scene.duration / speed）
 * @param speed       该镜倍速
 * @returns trim+tpad 滤镜片段；分镜过短时返回空串
 */
export function buildFreezeFilter(durationSec: number, speed: number): string {
  // 源轴量：镜长与定格段都乘回 speed（trim/tpad 在 setpts 之前，读源轴秒数）
  const srcDuration = durationSec * speed;
  const tail = FREEZE_PARAMS.tailSec * speed;
  // 定格段需小于镜长，且留出至少 tail 的动态铺垫，否则整镜近乎全冻，跳过。
  // 该判据在源轴与成片轴上等价（两边同乘 speed），阈值语义不随倍速漂移。
  if (srcDuration <= tail * 2) return "";
  const keep = srcDuration - tail;
  // 保留前 keep 秒动态 → tpad 克隆末帧补 tail 秒 → 源轴净时长回到 srcDuration
  return `trim=0:${keep.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${tail.toFixed(3)}`;
}

/** 单片段滤镜链的运镜/冲击参数（Ken Burns 仅图片分镜生效，冲击两者通用） */
export interface ClipMotionImpactParams {
  /** 是否图片分镜（决定是否走 Ken Burns zoompan） */
  isImage: boolean;
  /** Ken Burns 运镜；null=不加运镜（图片分镜由调用方兜底默认 zoomIn） */
  motion: SceneMotion | null;
  /** 单镜冲击重音；null=无冲击 */
  impact: SceneImpact | null;
  /** 分镜有效时长（秒）：Ken Burns 帧数与 freeze 定格判定用 */
  durationSec: number;
}

/**
 * 构建片段视频滤镜链：
 *   (图片分镜且有运镜 ? Ken Burns zoompan : scale+pad 统一画幅)
 *   → 可选 FX 滤镜 → 可选冲击（shake/flash/freeze）→ 可选变速 → fps 归一(30)。
 *
 * 帧率归一（fps=30）恒挂链尾：让所有片段帧率一致，消除 xfade 因帧率不齐的抖动，
 * 也与 Ken Burns 的 zoompan fps 对齐。变速用 setpts=PTS/speed 改变视频流时长。
 *
 * Ken Burns 内部已含 scale+zoompan 输出到目标尺寸（不再叠加 scale+pad）；
 * 无运镜（视频分镜 / 图片显式关运镜）走原 scale+pad 统一画幅路径。
 */
export function buildClipVideoFilter(
  width: number,
  height: number,
  effect: string | null,
  speed: number,
  motionImpact?: ClipMotionImpactParams
): string {
  const useKenBurns =
    !!motionImpact?.isImage &&
    motionImpact.motion !== null &&
    !!motionImpact.motion;

  const parts: string[] = [];
  if (useKenBurns && motionImpact) {
    // Ken Burns 自带 scale 上采样 + zoompan 输出到 width×height（已统一画幅）
    parts.push(
      buildKenBurnsFilter(
        width,
        height,
        motionImpact.motion as SceneMotion,
        motionImpact.durationSec
      )
    );
  } else {
    parts.push(
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
    );
  }

  if (effect) parts.push(effect);

  // 冲击重音（在滤镜之后、变速之前）：shake/flash 落镜头前窗；freeze 在镜尾定格。
  // 三者都挂在 setpts 之前 → 表达式读源时间轴，故窗口秒数须按 speed 换算到源轴
  // （见 build*Filter 上方的坐标系约定），使成片轴上的窗口与预览端常量窗一致。
  const impact = motionImpact?.impact ?? null;
  if (impact === "shake") {
    // 图片轻震、视频重震：图片是静止画，轻震即够；视频动态画配重震更有力
    const intensity = motionImpact?.isImage ? "light" : "heavy";
    parts.push(buildShakeFilter(width, height, intensity, speed));
  } else if (impact === "flash") {
    parts.push(buildFlashFilter(speed));
  } else if (impact === "freeze") {
    const freeze = buildFreezeFilter(motionImpact?.durationSec ?? 0, speed);
    if (freeze) parts.push(freeze);
  }

  if (speed !== 1) parts.push(`setpts=PTS/${speed.toFixed(4)}`);
  // 帧率归一恒挂链尾（Ken Burns 已在 zoompan 里设 fps，这里再显式统一无副作用）
  parts.push(`fps=${CLIP_FPS}`);
  return parts.join(",");
}
