/**
 * 预览端 BGM 音量包络（纯函数）—— 近似导出端 buildBgmFilter 的
 * fadeIn / fadeOut / ducking 效果，让用户在预览里听到成片 BGM 的动态。
 *
 * 导出端（buildBgmFilter）用 ffmpeg 滤镜实现：
 *   - afade=t=in:st=0:d=fadeIn       → 起播 fadeIn 秒内线性渐入
 *   - afade=t=out:st=total-fadeOut:d=fadeOut → 整片结束前 fadeOut 秒线性渐出
 *   - ducking：sidechaincompress，对白响时压低 BGM
 *
 * 预览端无法跑 ffmpeg，改为在播放进度回调里对 <audio>.volume 做线性 ramp +
 * 固定系数 ducking。语义近似（视觉/听觉可辨），不追求与 sidechaincompress 等同。
 */

/** BGM 包络计算所需的配置子集（与 BackgroundMusic 对齐） */
export interface BgmEnvelopeConfig {
  /** 基础音量 0-1（导出端 volume 字段） */
  volume: number;
  /** 淡入秒数 */
  fadeIn: number;
  /** 淡出秒数 */
  fadeOut: number;
  /** 对白时压低 BGM */
  ducking: boolean;
}

/** ducking 生效时 BGM 音量的衰减系数（对白响时乘以此值，简化 sidechaincompress） */
export const BGM_DUCKING_FACTOR = 0.3;

/**
 * 按「整片已播时刻」计算 BGM 当前应有音量。
 *
 * @param cfg BGM 包络配置（volume/fadeIn/fadeOut/ducking）
 * @param elapsed 整片已播时刻（秒），= 整体进度 × 整片总时长
 * @param totalDuration 整片总时长（秒）
 * @param voiceActive 当前是否有对白/旁白配音在播（用于 ducking）
 * @returns 应设到 <audio>.volume 的值（0-1）
 */
export function bgmVolumeAt(
  cfg: BgmEnvelopeConfig,
  elapsed: number,
  totalDuration: number,
  voiceActive: boolean
): number {
  const base = Math.min(1, Math.max(0, cfg.volume));
  let vol = base;

  // 淡入：起播 fadeIn 秒内线性从 0 升到 base
  if (cfg.fadeIn > 0 && elapsed < cfg.fadeIn) {
    vol = base * (elapsed / cfg.fadeIn);
  }

  // 淡出：整片结束前 fadeOut 秒内线性从 base 降到 0（取与淡入的更小值，
  // 极短片头尾重叠时不会互相抬高）
  if (cfg.fadeOut > 0 && totalDuration > 0) {
    const fadeOutStart = Math.max(0, totalDuration - cfg.fadeOut);
    if (elapsed >= fadeOutStart) {
      const remain = Math.max(0, totalDuration - elapsed);
      vol = Math.min(vol, base * (remain / cfg.fadeOut));
    }
  }

  // ducking：对白/旁白在播时按固定系数压低（叠加在淡入淡出之后）
  if (cfg.ducking && voiceActive) {
    vol *= BGM_DUCKING_FACTOR;
  }

  return Math.min(1, Math.max(0, vol));
}
