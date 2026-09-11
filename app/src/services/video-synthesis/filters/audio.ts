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
// BGM 分段的交叉淡化时长（与 planBgmSegments 同源常量，避免两边写死不同值）
import { BGM_CROSSFADE_SEC } from "@/lib/bgm-segments";

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
 * 一段已就绪的 BGM 分段：ffmpeg 输入索引 + 该段在全片时间轴上的时间窗。
 *
 * 由调用方（video-synthesis）把 planBgmSegments 的规划结果逐段下载曲目后构造：
 * 每段一首曲 = 一个独立 `-i` 输入，故各段各有 inputIndex。
 */
export interface BgmSegmentInput {
  /** 该段曲目在 ffmpeg -i 列表中的输入索引 */
  inputIndex: number;
  /** 段起始（全片绝对秒） */
  startSec: number;
  /** 段结束（全片绝对秒） */
  endSec: number;
}

/**
 * 构建 BGM（背景音乐）混音滤镜片段。
 *
 * 两个合成分支（有水印 / 无水印）共用，避免重复。
 *
 * ## 单曲路径（segments 缺省 / 长度 ≤1，存量项目零回归）
 *   [bgm]volume → (loop ? aloop+atrim) → afade in → afade out → [bgmout]
 *
 * ## 分段路径（segments 长度 ≥2）
 * 每段各自 volume/aloop/atrim/afade，再用 acrossfade 链式串成单条 [bgmout]。
 * 段内不再各自淡入淡出（交给 acrossfade 处理衔接），仅全片首端 fadeIn、
 * 末端 fadeOut 保留——中间段若各自淡出再淡入，会听到明显的「音乐断一下」。
 *
 * ⚠️ **acrossfade 的时长会吞掉重叠部分**（overlap 默认 true）：
 * 实测 10s+10s+10s 经两次 `d=2` 串联后总长 26s 而非 30s。故非末段的 atrim
 * 必须补偿 +d，末段不补——实测 trim 14/10/10 经两次 d=2 串联恰得 30s。
 * 该补偿是本函数正确对齐成片总时长的关键，改动时勿删。
 *
 * 串好的 [bgmout] 之后的 ducking / 权重逻辑两条路径完全共用（它们只消费
 * [bgmout] 这一个标签，不关心它是一首还是多首拼的）。
 *
 * @param bgm BGM 配置（已确保 enabled && url）；分段路径下 volume/fadeIn/fadeOut 仍生效
 * @param bgmInputIndex 单曲路径下 BGM 在 ffmpeg -i 列表中的输入索引（分段路径忽略）
 * @param totalDuration 成片总时长（秒），用于 atrim 截断和 afade out 起点
 * @param voiceLabels 对白配音轨标签数组（如 ["[a0]","[a1]"]），可空
 * @param segments 分段列表（≥2 段时走分段路径）；缺省即单曲，保证向后兼容
 * @returns { filters: 滤镜片段[], outLabel: 最终音频输出标签 }
 */
export function buildBgmFilter(
  bgm: BackgroundMusic,
  bgmInputIndex: number,
  totalDuration: number,
  voiceLabels: string[],
  segments?: BgmSegmentInput[]
): { filters: string[]; outLabel: string } {
  const filters: string[] = [];
  const vol = Math.min(1, Math.max(0, bgm.volume ?? 0.25));
  const fadeOutStart = Math.max(0, totalDuration - (bgm.fadeOut ?? 2));

  if (segments && segments.length >= 2) {
    filters.push(
      ...buildSegmentedBgmChain(bgm, segments, totalDuration, vol, fadeOutStart)
    );
  } else {
    // ── 单曲路径：volume → (aloop) → atrim → afade（原行为，逐字保留）──
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
  }

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
    // 1) 对白先 amix 成一条 sidechain key，再 asplit 成两路。
    //
    // ⚠️ asplit 不可省：ffmpeg 的滤镜图里**每个标签只能被消费一次**，而对白
    // 在这里要用两次——一次作为 sidechaincompress 的侧链 key（压 BGM），一次
    // 作为最终 amix 的音源（成片里得听见对白）。此前直接复用 `[voice]` 两次，
    // ffmpeg 会以 `Stream specifier 'voice' ... matches no streams` 报错并
    // 整个导出失败（凡「有 BGM + 有对白 + ducking 开」即命中，而这三者都是
    // 默认值）。已用真实 ffmpeg 复现并验证 asplit 修复。
    filters.push(
      `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voicemixed]`
    );
    filters.push(`[voicemixed]asplit=2[voice][voicedry]`);
    // 2) 用 [voice] 侧链压 [bgmout]。threshold 从 0.03 提到 0.05：0.03 太灵敏，
    //    配音底噪就能触发闪避，导致 BGM 全程被压、听感发闷。
    //    attack 从 20ms 降到 8ms：对白 ducking 的行业区间是 5-15ms，20ms 会让
    //    台词头一个字仍被 BGM 盖住一瞬（中文首字多为声母爆破音，最吃这段延迟）。
    //    release 300ms 落在 250-400ms 推荐区间内，保持不变——过短会「抽吸」。
    filters.push(
      `[bgmout][voice]sidechaincompress=threshold=0.05:ratio=8:attack=8:release=300[bgmducked]`
    );
    // 3) 压好的 BGM 与「另一路对白」再混合（用 asplit 的第二路 [voicedry]，
    //    [voice] 已被上一步的侧链消费掉）
    filters.push(`[voicedry][bgmducked]amix=inputs=2:normalize=0[aout]`);
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
 * 构建「多段 BGM 交叉淡化串联」滤镜片段，产出单条 [bgmout]。
 *
 * 每段：`[idx:a]volume,aloop,atrim=0:<trimLen>,asetpts` → `[bgmseg{i}]`
 * 串联：`[bgmseg0][bgmseg1]acrossfade=d=2[bgmx1]` → `[bgmx1][bgmseg2]acrossfade…`
 *
 * trimLen 的补偿见 buildBgmFilter 的注释：非末段 = 段长 + d，末段 = 段长。
 * 每段都无条件 aloop——内置曲库里 15s 的短曲（如 upbeat-80s-rocker）铺不满
 * 一个 30s 的情绪段，不循环就会中途静音。段长短于曲长时 atrim 自然截断，
 * aloop 不产生副作用（已实测 20s 素材截 6s 窗正常）。
 *
 * 全片首端 fadeIn 与末端 fadeOut 分别只加在第一段与最后一段上；中间衔接
 * 完全交给 acrossfade，避免「淡出到零再淡入」的断裂听感。
 */
function buildSegmentedBgmChain(
  bgm: BackgroundMusic,
  segments: BgmSegmentInput[],
  totalDuration: number,
  vol: number,
  fadeOutStart: number
): string[] {
  const filters: string[] = [];
  const d = BGM_CROSSFADE_SEC;
  const last = segments.length - 1;

  // ── 1. 逐段处理成独立音轨 [bgmseg{i}] ──────────────────────────────
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const segLen = Math.max(0, seg.endSec - seg.startSec);
    // 非末段补偿 acrossfade 吃掉的 d 秒（实测规则，见 buildBgmFilter 注释）
    const trimLen = i < last ? segLen + d : segLen;
    const chain: string[] = [
      `volume=${vol.toFixed(3)}`,
      `aloop=loop=-1:size=2000000000`,
      `atrim=0:${trimLen.toFixed(3)}`,
      `asetpts=N/SR/TB`,
    ];
    // 首段淡入（全片开头）
    if (i === 0 && (bgm.fadeIn ?? 0) > 0) {
      chain.push(`afade=t=in:st=0:d=${(bgm.fadeIn ?? 1.5).toFixed(3)}`);
    }
    // 末段淡出（全片结尾）：st 是「该段内的相对秒」——段自己的时间轴从 0 起算，
    // 而 fadeOutStart 是全片绝对秒，必须减去该段起点才落在正确位置。
    if (i === last && (bgm.fadeOut ?? 0) > 0) {
      const relStart = Math.max(0, fadeOutStart - seg.startSec);
      chain.push(
        `afade=t=out:st=${relStart.toFixed(3)}:d=${(bgm.fadeOut ?? 2).toFixed(3)}`
      );
    }
    filters.push(`[${seg.inputIndex}:a]${chain.join(",")}[bgmseg${i}]`);
  }

  // ── 2. 链式 acrossfade 串成单条 [bgmout] ───────────────────────────
  // 标签命名：中间产物用 [bgmx{i}]，与段标签 [bgmseg{i}] 不冲突；
  // 最后一次串联直接输出 [bgmout]，供下游 ducking/权重消费。
  let cur = "[bgmseg0]";
  for (let i = 1; i < segments.length; i += 1) {
    const out = i === last ? "[bgmout]" : `[bgmx${i}]`;
    filters.push(`${cur}[bgmseg${i}]acrossfade=d=${d}:c1=tri:c2=tri${out}`);
    cur = out;
  }

  // 防御：单段不该走到这里（buildBgmFilter 已拦 length>=2），
  // 万一走到则补一条恒等重命名，保证 [bgmout] 一定存在。
  if (segments.length === 1) {
    filters.push(`[bgmseg0]atrim=0:${totalDuration.toFixed(3)}[bgmout]`);
  }

  return filters;
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
 * 人声预处理链 —— 在配音进混音前单独处理，loudnorm 替代不了它。
 *
 * loudnorm 做的是**整片响度归一**，解决不了「同一句话内强弱差 15dB」：
 * 激动台词爆音、轻声台词在手机外放时被 BGM 淹没。专业流程里人声进混音前
 * 必须单独走一遍处理，这是「能听」和「像专业配的」的分界。
 *
 * 四段（顺序不可换）：
 * 1. `highpass=f=80` —— 切掉 80Hz 以下，TTS 合成音的低频隆隆声与直流偏移
 * 2. `acompressor` —— 把动态收到 6-8dB 内。threshold 的原生量纲是线性值
 *    （取值域 0.000976563–1），但 ffmpeg 选项解析器支持 `dB` 后缀并自动换算，
 *    `0.126` 与 `-18dB` 等价（已用 volumedetect 实测比对：二者输出 -21.7/-21.8 dB，
 *    而 0.9 明显不同为 -21.1 dB）。这里写线性值，与下方 sidechaincompress 的
 *    threshold（同一套 AVOptions）书写风格保持一致。
 *    ratio=3 是对白常用值（上限 20）。attack/release 单位 ms。
 *    makeup 是**增益倍数**（1–64），2 ≈ +6dB 补回压掉的响度。
 * 3. `deesser` —— 齿音抑制。i=强度、f=频点（归一化 0-1，0.5 约对应 6kHz 附近）。
 *    TTS 的 s/sh/z 音尤其刺耳，中文「四、十、是」高频集中。
 * 4. `alimiter` —— 削峰兜底，limit 是线性值（0.0625–1），0.95 ≈ -0.45dBFS。
 *
 * ⚠️ 必须插在 `adelay` **之前**：adelay 会给流加静音前缀，压缩器的阈值判断
 * 会把这段静音算进 RMS 检测窗口，导致开头几百毫秒压缩不准。
 * 与 `atempo` 的关系：放在 atempo **之后**——变速改变的是时间轴，
 * 压缩器的 attack/release 是绝对毫秒数，先变速后压缩才能拿到成片里真实的包络。
 */
export const VOICE_CHAIN = [
  "highpass=f=80",
  "acompressor=threshold=0.126:ratio=3:attack=5:release=80:makeup=2:detection=rms",
  "deesser=i=0.35:f=0.5",
  "alimiter=limit=0.95:attack=5:release=50",
].join(",");

/**
 * 构建「最终混音链」——统一收口 对白 + BGM + SFX 三层，末尾套 loudnorm 归一化。
 *
 * 混音层级 voice > SFX > BGM > ambient：对白权重最高，SFX 次之（叠加、稍低），
 * BGM 最低（已在 buildBgmFilter 内给 0.6 权重或 ducking 压低）。三层都走 amix
 * 且 normalize=0——normalize=1（默认）会把总响度按输入数拉平，导致「分镜越多、
 * 对白越小声」的逐镜漂移（此前无水印 voice-only 路径正是漏了 normalize=0 的 bug）。
 * 最后统一 loudnorm 到 -14 LUFS（见 LOUDNORM_FILTER），修「全片无统一响度」。
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
  /** BGM 情绪分段（≥2 段时走分段切换）；缺省即单曲，存量项目零回归 */
  bgmSegments?: BgmSegmentInput[];
}): { filters: string[]; outLabel: string } | null {
  const {
    voiceLabels,
    bgm,
    bgmInputIndex,
    bgmTotalDuration,
    sfxLabels,
    bgmSegments,
  } = params;
  const filters: string[] = [];

  // ── 1. 对白 + BGM 基混音 ──────────────────────────────────────────
  let baseLabel: string | null = null;
  // 分段路径下 bgmInputIndex 可为 -1（BGM 不占独立输入，各段自带索引），
  // 故判据要放行「有 ≥2 段」的情形，否则分段配乐会被整条跳过。
  const hasSegmented = (bgmSegments?.length ?? 0) >= 2;
  if (bgm && (bgmInputIndex >= 0 || hasSegmented)) {
    const bgmBuilt = buildBgmFilter(
      bgm,
      bgmInputIndex,
      bgmTotalDuration,
      voiceLabels,
      bgmSegments
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

  // ── 3. loudnorm 归一化（目标见 LOUDNORM_FILTER）────────────────────
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
  /**
   * 触发模式，缺省 "oneshot"。ambient 时 durationSec 必定有值，
   * 表示从 triggerSec 起持续铺底的时长（循环填满 + 淡入淡出）。
   */
  mode?: "oneshot" | "ambient";
  /** ambient 模式的铺底时长（秒）；oneshot 时为 undefined */
  durationSec?: number;
}

/** 环境底噪的淡入/淡出时长（秒）——场景切换处交叉，不硬切 */
export const AMBIENT_FADE_SEC = 0.8;

/**
 * 环境底噪默认音量（相对 SfxEntry.defaultVolume 的覆盖值）。
 *
 * 从 0.35 降到 0.2：真正的 room tone 应「察觉不到、去掉就发空」，
 * 行业电平 -35~-30 dBFS。0.35 在竖屏小喇叭上已经能被明确听见，
 * 会与对白抢注意力——环境音一旦「听得见」就不再是底噪而是音效了。
 */
export const AMBIENT_DEFAULT_VOLUME = 0.2;

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
 *
 * ## ambient 模式（mode="ambient"）
 * 不产出点触发，而是**场景级持续铺底**：把「同一 locationKey 的连续分镜」合并成
 * 一个时间窗，同一音效在同一窗内只产出一条（durationSec = 窗长）。同地点的多个
 * 连续镜共享一条 room tone，换镜不断——断了观众会察觉空间跳变。
 * 需要 sceneDurations 与 sceneLocationKeys 才能算窗；二者缺省时 ambient 退化为
 * oneshot（保证老调用方不因缺参数而出错）。
 */
export function buildSfxSchedule(
  sfx: SceneSfx[] | undefined,
  sceneStarts: number[],
  sceneIds: string[],
  transitionSfx: number[] = [],
  sceneDurations?: number[],
  sceneLocationKeys?: (string | null | undefined)[]
): SfxScheduleItem[] {
  const startById = new Map<string, number>();
  const indexById = new Map<string, number>();
  for (let i = 0; i < sceneIds.length; i += 1) {
    startById.set(sceneIds[i], sceneStarts[i]);
    indexById.set(sceneIds[i], i);
  }

  const items: SfxScheduleItem[] = [];
  // ambient 去重：同一「音效 + 地点窗」只产出一条，避免同地点每镜各配一条
  // 环境音导致 N 条雨声叠加（音量翻倍且 ffmpeg 输入暴涨）
  const ambientSeen = new Set<string>();
  const canGroupAmbient =
    Array.isArray(sceneDurations) && Array.isArray(sceneLocationKeys);

  for (const s of sfx ?? []) {
    const entry = getSfxById(s.sfxId);
    if (!entry) continue; // 音效 id 未命中库 → 跳过（降级）
    const base = startById.get(s.sceneId);
    if (base === undefined) continue; // 分镜 id 未知 → 跳过
    const offset = Number.isFinite(s.offsetSec) ? Math.max(0, s.offsetSec) : 0;
    const vol =
      typeof s.volume === "number" && Number.isFinite(s.volume)
        ? Math.min(1, Math.max(0, s.volume))
        : s.mode === "ambient"
          ? AMBIENT_DEFAULT_VOLUME
          : entry.defaultVolume;

    // ── ambient：按 locationKey 合并连续同地点分镜成一个时间窗 ──────
    if (s.mode === "ambient" && canGroupAmbient) {
      const idx = indexById.get(s.sceneId);
      if (idx === undefined) continue;
      const win = resolveLocationWindow(
        idx,
        sceneStarts,
        sceneDurations,
        sceneLocationKeys
      );
      const dedupeKey = `${s.sfxId}@${win.startSec.toFixed(3)}`;
      if (ambientSeen.has(dedupeKey)) continue;
      ambientSeen.add(dedupeKey);
      items.push({
        url: entry.file,
        // ambient 铺底从整个地点窗的起点开始，忽略镜内 offset
        //（底噪是整场的，不该因为配在第二镜就晚进来）
        triggerSec: win.startSec,
        volume: vol,
        origin: "config",
        mode: "ambient",
        durationSec: Math.max(0, win.endSec - win.startSec),
      });
      continue;
    }

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
 * 求某分镜所属的「连续同地点时间窗」（ambient 铺底的覆盖范围）。
 *
 * 从 idx 向前、向后各扩张，只要 locationKey 相同就并入。locationKey 为
 * 空/null 时不跨镜合并（只覆盖本镜）——地点未知时无从判断是否同一空间，
 * 盲目合并会把两场不同的戏铺上同一条环境音。
 */
function resolveLocationWindow(
  idx: number,
  sceneStarts: number[],
  sceneDurations: number[],
  sceneLocationKeys: (string | null | undefined)[]
): { startSec: number; endSec: number } {
  const key = sceneLocationKeys[idx];
  const endOf = (i: number) => sceneStarts[i] + Math.max(0, sceneDurations[i]);

  // 地点未知：只覆盖本镜
  if (!key || typeof key !== "string" || key.trim() === "") {
    return { startSec: sceneStarts[idx], endSec: endOf(idx) };
  }

  let lo = idx;
  while (lo - 1 >= 0 && sceneLocationKeys[lo - 1] === key) lo -= 1;
  let hi = idx;
  const n = Math.min(sceneStarts.length, sceneDurations.length);
  while (hi + 1 < n && sceneLocationKeys[hi + 1] === key) hi += 1;

  return { startSec: sceneStarts[lo], endSec: endOf(hi) };
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

    // ── ambient：循环铺满时间窗 + 淡入淡出（场景级底噪）───────────────
    if (it.mode === "ambient" && (it.durationSec ?? 0) > 0) {
      const win = it.durationSec!;
      // 淡入淡出各取 AMBIENT_FADE_SEC，但窗极短时按窗长的 1/3 收缩，
      // 否则淡入淡出重叠会把整段压得几乎无声。
      const fade = Math.min(AMBIENT_FADE_SEC, win / 3);
      const chain = [
        // aloop 的 size 单位是**采样数**（非秒），给足上限后必须 atrim 截断。
        // 素材短于窗长时靠它铺满；素材长于窗长时 atrim 自然截断，无副作用。
        `aloop=loop=-1:size=2000000000`,
        `atrim=0:${win.toFixed(3)}`,
        `asetpts=N/SR/TB`,
        `afade=t=in:st=0:d=${fade.toFixed(3)}`,
        `afade=t=out:st=${Math.max(0, win - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
        `volume=${vol}`,
        `adelay=${delayMs}|${delayMs}`,
      ];
      filters.push(`[${inputIdx}:a]${chain.join(",")}${label}`);
      labels.push(label);
      continue;
    }

    filters.push(
      `[${inputIdx}:a]volume=${vol},adelay=${delayMs}|${delayMs}${label}`
    );
    labels.push(label);
  }
  return { filters, labels };
}
