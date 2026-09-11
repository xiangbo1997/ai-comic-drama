/**
 * 音画时长协调（A/V duration reconcile）—— 图片镜专用。
 *
 * ## 为什么需要
 *
 * 专业剪辑里**声音是主时间轴，画面服从声音**（audio-led editing）：对白镜的
 * 时长 = 配音实长 + 头尾呼吸空隙。截断台词是绝对禁止的。
 *
 * 而本项目的图片镜用 `-t declaredDuration` 直接钉死时长，`scene.duration` 来自
 * `shot-timing.ts` 的 2.5 字/秒估算。多数情况估算偏长（实际 TTS 约 4.5-5 字/秒），
 * 画面有余；但三种情况会反过来把台词切掉半句：
 *   1. 用户手动把 scene.duration 调短
 *   2. 用户把 ttsSpeed 调慢（0.7x 时配音长 1.5 倍）
 *   3. 情绪语速系数让实际配音变长（sad=0.90）
 *
 * ## 为什么只管图片镜
 *
 * 视频镜分支**明确不截断**（见 sceneToVideoClip 注释：「不再用 -t scene.duration
 * 截断——DB 声明时长常短于真实视频长度」），且 provider 普遍返回 5-8s 而
 * scene.duration 多为 2-4s——它的问题是「画面拖尾静默」，是反向问题，不在此处理。
 *
 * ## 硬约束：结果必须真实体现在片段文件里
 *
 * `effDurations` 的语义契约是「片段文件的真实时长」，xfade 的 offset 与 tpad
 * 补垫都建立在这个契约上。只改数组不改文件，xfade 会在 offset 处取到黑帧。
 * 图片镜天然满足——它本来就是「凭空生成指定时长的视频」，改 `-t` 的值即可，
 * 零新增滤镜、零 tpad、零 xfade 风险。
 */

/** 台词前的呼吸空隙（秒）：画面先到、人再开口 */
export const LEAD_IN_SEC = 0.15;

/** 台词后的留白（秒）：说完不立刻切走，给观众消化 */
export const TAIL_SEC = 0.35;

/**
 * 画面相对声音的最大延长倍率。
 *
 * 不设上限的话，一句超长台词会把单镜拉到十几秒——那违背短剧节奏
 * （ASL 目标 2.0-2.8s），也说明该镜本就该拆成两镜。超出部分交给
 * 建议提速（由调用方决定是否采纳），而不是无限延长画面。
 */
export const MAX_STRETCH_RATIO = 1.25;

/** 配音提速上限：超过 1.15 人耳可察觉失真（金属感 / 卡顿） */
export const MAX_SPEEDUP = 1.15;

export interface ReconcileResult {
  /** 协调后的画面时长（秒），调用方用它做 `-t` 参数 */
  duration: number;
  /**
   * 建议的配音额外提速倍率。1 = 无需提速。
   * 仅在「配音太长，画面即便延长到上限也装不下」时 > 1，且钳到 MAX_SPEEDUP。
   */
  suggestedSpeedup: number;
  /** 是否发生了延长（供调用方留痕/告警） */
  stretched: boolean;
}

/**
 * 协调画面时长与配音时长。
 *
 * @param clipDuration 画面声明时长（秒），即 scene.duration / speed
 * @param voiceDuration 配音实测时长（秒）；无配音或探测失败传 undefined
 * @returns 协调结果；无配音时原样返回 clipDuration（零回归）
 */
export function reconcileDuration(
  clipDuration: number,
  voiceDuration?: number
): ReconcileResult {
  const noop: ReconcileResult = {
    duration: clipDuration,
    suggestedSpeedup: 1,
    stretched: false,
  };

  if (!voiceDuration || voiceDuration <= 0 || clipDuration <= 0) return noop;

  const needed = voiceDuration + LEAD_IN_SEC + TAIL_SEC;

  // 画面本就够长：保持原样，多出来的是正常留白
  if (needed <= clipDuration) return noop;

  const maxDuration = clipDuration * MAX_STRETCH_RATIO;

  // 延长到刚好装下
  if (needed <= maxDuration) {
    return {
      duration: roundSec(needed),
      suggestedSpeedup: 1,
      stretched: true,
    };
  }

  // 装不下：延长到上限 + 建议提速补足差额（钳到人耳可接受范围）
  const speedup = Math.min(MAX_SPEEDUP, needed / maxDuration);
  return {
    duration: roundSec(maxDuration),
    suggestedSpeedup: speedup,
    stretched: true,
  };
}

/** 统一到毫秒精度，避免浮点尾数污染 ffmpeg 参数与后续前缀和 */
function roundSec(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}
