/**
 * 视频合成 —— 音频滤镜构建器（纯函数）
 *
 * 从 services/video-synthesis.ts 原样提取（零行为变更）：变速 atempo 链、
 * BGM 混音链、SFX 时间表与第三音频层、以及「对白 + BGM + SFX」三层最终混音 +
 * loudnorm 归一化。全部为纯字符串/数据构建，不触碰进程与文件系统。
 */

import type { BackgroundMusic, SceneSfx } from "@/types/export-style";
// 音效库（解析标签 → 实际音频文件 + 默认音量），与前端/解析层共用单一真源。
import { getSfxById } from "@/lib/sfx-library";

/**
 * 把任意变速倍率拆成 FFmpeg atempo 允许的 0.5–2.0 链。
 * atempo 单次只接受 0.5–2.0，超出需级联。移植自 MagicalCanvas。
 */
export function buildAtempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0) {
    parts.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 0.001) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

/**
 * 构建 BGM（背景音乐）混音滤镜片段。
 *
 * 两个合成分支（有水印 / 无水印）共用，避免重复。处理链：
 *   [bgm]volume → (loop ? aloop+atrim) → afade in → afade out → [bgmout]
 * 然后与对白配音轨混合：
 *   - 有配音：所有 [aK] 与 [bgmout] 一起 amix（normalize=0 防对白变小声，
 *     BGM 给低权重让对白突出）；ducking=true 时改走 sidechaincompress 闪避。
 *   - 无配音：[bgmout] 直接作为唯一音轨输出。
 *
 * @param bgm BGM 配置（已确保 enabled && url）
 * @param bgmInputIndex BGM 在 ffmpeg -i 列表中的输入索引
 * @param totalDuration 成片总时长（秒），用于 atrim 截断和 afade out 起点
 * @param voiceLabels 对白配音轨标签数组（如 ["[a0]","[a1]"]），可空
 * @returns { filters: 滤镜片段[], outLabel: 最终音频输出标签 }
 */
export function buildBgmFilter(
  bgm: BackgroundMusic,
  bgmInputIndex: number,
  totalDuration: number,
  voiceLabels: string[]
): { filters: string[]; outLabel: string } {
  const filters: string[] = [];
  const vol = Math.min(1, Math.max(0, bgm.volume ?? 0.25));
  const fadeOutStart = Math.max(0, totalDuration - (bgm.fadeOut ?? 2));

  // ── BGM 处理链：volume → (aloop) → atrim → afade ──
  const chain: string[] = [`volume=${vol.toFixed(3)}`];
  if (bgm.loop !== false) {
    // 无限循环；size 给足采样数上限（约 12h@44.1k），随后必须 atrim 截断
    chain.push(`aloop=loop=-1:size=2000000000`);
  }
  // 截到成片时长并重置时间戳（loop 后必须；非 loop 时 BGM 超长也截断）
  chain.push(`atrim=0:${totalDuration.toFixed(3)}`, `asetpts=N/SR/TB`);
  if ((bgm.fadeIn ?? 0) > 0) {
    chain.push(`afade=t=in:st=0:d=${(bgm.fadeIn ?? 1.5).toFixed(3)}`);
  }
  if ((bgm.fadeOut ?? 0) > 0) {
    // afade 的 st 不支持表达式，必须是常量秒数（已在 TS 算好）
    chain.push(
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(bgm.fadeOut ?? 2).toFixed(3)}`
    );
  }
  filters.push(`[${bgmInputIndex}:a]${chain.join(",")}[bgmout]`);

  // ── 无对白配音：BGM 即唯一音轨 ──
  if (voiceLabels.length === 0) {
    return { filters, outLabel: "[bgmout]" };
  }

  // ── 有对白配音 ──
  // ducking 缺省即开（`!== false` 而非 `=== true`）：漫剧混音层级
  // voice > SFX > BGM > ambient，对白清晰是刚需。DEFAULT_BACKGROUND_MUSIC.ducking
  // 已是 true，但历史落库配置 / 未经 normalize 的对象可能缺此字段，
  // 缺省落在「已闪避」一侧才不会静默出一条压着对白的 BGM。
  if (bgm.ducking !== false) {
    // ducking：对白响时自动压低 BGM（剪映"语音增强"同款 sidechaincompress）
    // 1) 对白先 amix 成一条 sidechain key [voice]
    filters.push(
      `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voice]`
    );
    // 2) 用 [voice] 侧链压 [bgmout]。threshold 从 0.03 提到 0.05：0.03 太灵敏，
    //    配音底噪就能触发闪避，导致 BGM 全程被压、听感发闷。
    filters.push(
      `[bgmout][voice]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[bgmducked]`
    );
    // 3) 压好的 BGM 与对白再混合
    filters.push(`[voice][bgmducked]amix=inputs=2:normalize=0[aout]`);
    return { filters, outLabel: "[aout]" };
  }

  // 兜底路线（仅显式 ducking:false 时走到）：weights 让对白突出 +
  // normalize=0 防整体变小声。BGM 恒定权重 0.6 → 0.45：没有闪避时 BGM 全程
  // 与对白同在，0.6 会盖住对白细节，压到 0.45 才保证人声在前。
  const allInputs = [...voiceLabels, "[bgmout]"];
  const weights = [...voiceLabels.map(() => "1"), "0.45"].join(" ");
  filters.push(
    `${allInputs.join("")}amix=inputs=${allInputs.length}:normalize=0:weights='${weights}'[aout]`
  );
  return { filters, outLabel: "[aout]" };
}

/**
 * loudnorm 目标：-14 LUFS / TP -1.0 dBFS / LRA 9。
 *
 * 为什么不是 -16：EBU R128 的 -16 LUFS 是【广播/播客】标准；抖音、快手、
 * YouTube 等短视频平台的实际归一目标是 -14 LUFS。按 -16 交片，平台会把整片
 * 再抬 2 dB（或干脆不抬，导致听感比同刷信息流里的其他片子明显偏小）。
 * TP 收到 -1.0 给平台二次转码留足削峰余量；LRA 从 11 收到 9 —— 竖屏小喇叭
 * 播放环境下动态范围过大会让轻声对白听不清。
 *
 * 单遍 loudnorm（非双遍）——导出为一次性同步管线，不便二次探测；单遍已能显著
 * 收敛「逐镜音量漂移」（此前 amix 缺 normalize=0 的老账）+ 统一全片响度。
 */
export const LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.0:LRA=9";

/**
 * 构建「最终混音链」——统一收口 对白 + BGM + SFX 三层，末尾套 loudnorm 归一化。
 *
 * 混音层级 voice > SFX > BGM > ambient：对白权重最高，SFX 次之（叠加、稍低），
 * BGM 最低（已在 buildBgmFilter 内给 0.6 权重或 ducking 压低）。三层都走 amix
 * 且 normalize=0——normalize=1（默认）会把总响度按输入数拉平，导致「分镜越多、
 * 对白越小声」的逐镜漂移（此前无水印 voice-only 路径正是漏了 normalize=0 的 bug）。
 * 最后统一 loudnorm 到 -16 LUFS，修「全片无统一响度」。
 *
 * 分支：
 *   1. 先得到「对白+BGM」的基混音标签 baseLabel：
 *      - 有 BGM：调 buildBgmFilter（含 ducking / 权重 / 无对白时 BGM 独轨）；
 *      - 无 BGM 有对白：voice amix(normalize=0)；
 *      - 无 BGM 无对白：无基轨（baseLabel=null）。
 *   2. 若有 SFX：baseLabel（如有）与所有 [sfxK] 一起 amix(normalize=0, weights
 *      对白/基轨=1、SFX=0.9)；无基轨时 SFX 自身 amix。
 *   3. 对最终标签套 loudnorm → [amaster]。全程无音频（无对白/BGM/SFX）→ 返回 null。
 *
 * @returns { filters, outLabel } 或 null（完全无音频时，调用方不 map 音频）
 */
export function buildFinalAudioChain(params: {
  voiceLabels: string[];
  bgm: BackgroundMusic | null;
  bgmInputIndex: number;
  bgmTotalDuration: number;
  sfxLabels: string[];
}): { filters: string[]; outLabel: string } | null {
  const { voiceLabels, bgm, bgmInputIndex, bgmTotalDuration, sfxLabels } =
    params;
  const filters: string[] = [];

  // ── 1. 对白 + BGM 基混音 ──────────────────────────────────────────
  let baseLabel: string | null = null;
  if (bgm && bgmInputIndex >= 0) {
    const bgmBuilt = buildBgmFilter(
      bgm,
      bgmInputIndex,
      bgmTotalDuration,
      voiceLabels
    );
    filters.push(...bgmBuilt.filters);
    baseLabel = bgmBuilt.outLabel;
  } else if (voiceLabels.length > 0) {
    // 无 BGM 有对白：normalize=0 防逐镜漂移（修 voice-only 老 bug）
    filters.push(
      `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voicemix]`
    );
    baseLabel = "[voicemix]";
  }

  // ── 2. 叠加 SFX 层 ────────────────────────────────────────────────
  let mixedLabel: string | null = baseLabel;
  if (sfxLabels.length > 0) {
    if (baseLabel) {
      const inputs = [baseLabel, ...sfxLabels];
      // 基轨（含对白/BGM）权重 1，SFX 各 0.9（叠加但略低于对白）
      const weights = ["1", ...sfxLabels.map(() => "0.9")].join(" ");
      filters.push(
        `${inputs.join("")}amix=inputs=${inputs.length}:normalize=0:weights='${weights}'[premaster]`
      );
      mixedLabel = "[premaster]";
    } else {
      // 纯 SFX（无对白无 BGM，极少见）：SFX 自身 amix
      if (sfxLabels.length === 1) {
        mixedLabel = sfxLabels[0];
      } else {
        filters.push(
          `${sfxLabels.join("")}amix=inputs=${sfxLabels.length}:normalize=0[premaster]`
        );
        mixedLabel = "[premaster]";
      }
    }
  }

  if (!mixedLabel) return null; // 完全无音频

  // ── 3. loudnorm 归一化到 -16 LUFS ────────────────────────────────
  filters.push(`${mixedLabel}${LOUDNORM_FILTER}[amaster]`);
  return { filters, outLabel: "[amaster]" };
}

/**
 * 单条已解析的 SFX 触发：静态资源 URL + 全片绝对触发时刻 + 音量。
 * 由 buildSfxSchedule（纯函数）从 options.sfx + 转场自动 whoosh 计算，
 * 供导出层下载 + adelay 混入，也供预览端复用同一时刻调度（预览=成片）。
 */
export interface SfxScheduleItem {
  /** 音效静态资源 URL（如 /sfx/whoosh/whoosh-fast-1492.mp3） */
  url: string;
  /** 全片时间轴上的触发时刻（秒） */
  triggerSec: number;
  /** 音量 0-1 */
  volume: number;
  /** 来源标记：显式配置 or 转场自动补的 whoosh（便于调试/去重） */
  origin: "config" | "transition";
}

/** 转场自动 whoosh 用的音效 id 与默认音量（转场处补一记疾风，掩盖切换硬感） */
const AUTO_TRANSITION_SFX_ID = "whoosh-fast";
const AUTO_TRANSITION_SFX_VOLUME = 0.5;

/**
 * 计算全片 SFX 触发时间表（纯函数，导出端与预览端共用）。
 *
 * 输入：
 *   - sfx           显式音效配置（按 sceneId + offsetSec）
 *   - sceneStarts   各分镜在成片时间轴上的起始秒（buildSceneStarts 产出）
 *   - sceneIds      与 sceneStarts index 对齐的分镜 id
 *   - transitionSfx 转场自动 whoosh 的触发点（全片绝对秒），可空
 *
 * 处理：
 *   1. 逐条显式 SFX：sfxId 解析到音效文件（未命中跳过，图形化降级），
 *      triggerSec = sceneStart[该 sceneId] + offsetSec，volume 缺省用 defaultVolume；
 *   2. 转场自动 whoosh：每个触发点补一条 whoosh-fast（origin=transition）；
 *   3. 按 triggerSec 升序稳定排序，便于导出/预览按序处理。
 *
 * 未命中的 sfxId / 未知 sceneId 一律跳过（不抛错、不阻断），保证「引用缺失 → 跳过」。
 */
export function buildSfxSchedule(
  sfx: SceneSfx[] | undefined,
  sceneStarts: number[],
  sceneIds: string[],
  transitionSfx: number[] = []
): SfxScheduleItem[] {
  const startById = new Map<string, number>();
  for (let i = 0; i < sceneIds.length; i += 1) {
    startById.set(sceneIds[i], sceneStarts[i]);
  }

  const items: SfxScheduleItem[] = [];

  for (const s of sfx ?? []) {
    const entry = getSfxById(s.sfxId);
    if (!entry) continue; // 音效 id 未命中库 → 跳过（降级）
    const base = startById.get(s.sceneId);
    if (base === undefined) continue; // 分镜 id 未知 → 跳过
    const offset = Number.isFinite(s.offsetSec) ? Math.max(0, s.offsetSec) : 0;
    const vol =
      typeof s.volume === "number" && Number.isFinite(s.volume)
        ? Math.min(1, Math.max(0, s.volume))
        : entry.defaultVolume;
    items.push({
      url: entry.file,
      triggerSec: base + offset,
      volume: vol,
      origin: "config",
    });
  }

  // 转场自动 whoosh
  const whoosh = getSfxById(AUTO_TRANSITION_SFX_ID);
  if (whoosh) {
    for (const t of transitionSfx) {
      if (!Number.isFinite(t) || t < 0) continue;
      items.push({
        url: whoosh.file,
        triggerSec: t,
        volume: AUTO_TRANSITION_SFX_VOLUME,
        origin: "transition",
      });
    }
  }

  // 按触发时刻升序（稳定）——保证导出 adelay 与预览调度顺序一致，便于调试
  return items.sort((a, b) => a.triggerSec - b.triggerSec);
}

/**
 * 构建 SFX（音效）混音滤镜片段——第三音频层，与 buildBgmFilter 同构。
 *
 * 每条已下载的音效：[输入]volume=v,adelay=ms|ms → [sfxK]，作为独立音轨。
 * 调用方把这些 [sfxK] 标签连同对白/BGM 一起并入最终 amix（normalize=0，
 * 保持音效为「叠加」而非「拉平」）。SFX 相对对白略低（volume 已按 defaultVolume/
 * 用户值定，环境类更低），符合 voice > SFX > BGM > ambient 层级。
 *
 * @param items           已解析且「已成功下载」的 SFX 列表（紧凑，逐条对应一个 ffmpeg 输入）
 * @param inputStartIndex SFX 在 ffmpeg -i 列表中的首个输入索引（items[0] 对应此索引）
 * @returns { filters: 滤镜片段[], labels: 生成的音轨标签[] }
 */
export function buildSfxFilters(
  items: SfxScheduleItem[],
  inputStartIndex: number
): { filters: string[]; labels: string[] } {
  const filters: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const inputIdx = inputStartIndex + i;
    const delayMs = Math.max(0, Math.round(it.triggerSec * 1000));
    const label = `[sfx${i}]`;
    const vol = Math.min(1, Math.max(0, it.volume)).toFixed(3);
    filters.push(
      `[${inputIdx}:a]volume=${vol},adelay=${delayMs}|${delayMs}${label}`
    );
    labels.push(label);
  }
  return { filters, labels };
}
