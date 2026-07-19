/**
 * 字幕分句与时间窗分配（纯函数，无 Node API）
 *
 * 供预览端（preview-player.tsx 客户端组件）与导出端（video-synthesis.ts
 * 服务端）共用，保证「逐句字幕」的切分与时轴分配在两端完全一致——
 * 预览是导出的调试窗口，任何时轴/切句差异都会让用户看到「预览≠成片」。
 *
 * 两个能力：
 *   1) splitSubtitleSegments：把整段对白/旁白切成「逐句显示」的短句数组
 *   2) allocateSubtitleWindows：把分镜时长按各句视觉宽度比例分给每句
 */

/**
 * 单字符的视觉宽度：CJK 全角计 1，ASCII 半角计 0.5。
 *
 * 与 video-synthesis.ts 的 wrapSubtitleText 折行宽度启发式同源，
 * 抽到此处作为单一权威，避免两处各自实现导致行为漂移。
 * 判据：ASCII 范围（\x00-\xff）视为半角，其余（中日韩全角）视为全角。
 *
 * @param ch 单个字符
 * @returns 视觉宽度（0.5 或 1）
 */
export function charWidth(ch: string): number {
  return /[\x00-\xff]/.test(ch) ? 0.5 : 1;
}

/**
 * 计算整串文本的视觉宽度（各字符 charWidth 之和）。
 *
 * @param text 文本
 * @returns 视觉宽度总和（CJK 计 1、ASCII 计 0.5）
 */
export function textVisualWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w;
}

/** 句末标点（一级切分点）：中英文句号/问号/感叹号/省略号 */
const SENTENCE_ENDINGS = /([。！？!?…]+)/;
/** 次级切分点（逗号/顿号/分号/冒号，中英文）：仅超长句才用 */
const CLAUSE_SEPARATORS = /([，,、；;：:]+)/;
/** 一句字幕的目标最大视觉宽度（约 30 个全角字）；超过才做次级切分 */
const MAX_SEGMENT_WIDTH = 30;
/**
 * 过短碎片阈值（视觉宽度）：低于此值的碎片并入前一句，避免闪烁式短字幕。
 *
 * 取 2（≈1 个全角字，或标点残片）而非更大的值：像「走吧？」「好的。」这类
 * 3 字的正常短句是「逐句字幕」要突出的对象，绝不能被并进邻句而消失；真正
 * 需要吸收的是标点残片（如切分残留的孤立「。」）或单字叹词（「哦」「嗯」），
 * 这些视觉宽度 ≤ 2。阈值定得越高越会吞掉正常短句，与「字幕活起来」相悖。
 */
const MIN_FRAGMENT_WIDTH = 2;

/**
 * 把整段字幕文本切成「逐句显示」的短句数组。
 *
 * 切分规则（层层递进）：
 *   1) 一级：在句末标点（。！？!?…）与显式换行处切分，标点保留在所属句尾。
 *   2) 二级：某句视觉宽度超过 MAX_SEGMENT_WIDTH（≈30 全角字）时，
 *      在逗号/顿号/分号/冒号处再切，让长句不至于一次刷满屏。
 *   3) 合并：视觉宽度 < MIN_FRAGMENT_WIDTH（2）的碎片并入前一句，
 *      仅吸收标点残片 / 单字叹词，正常短句（「走吧？」）保持独立。
 *   4) 去空：trim 后为空的片段丢弃。
 *
 * 无句末标点的文本 → 返回单元素数组（整段作为一句）。
 * 空/纯空白文本 → 返回空数组。
 *
 * @param text 整段对白或旁白文本
 * @returns 逐句短句数组（按原顺序）
 */
export function splitSubtitleSegments(text: string): string[] {
  if (!text || !text.trim()) return [];

  // ── 1) 一级切分：先按显式换行分段，再在句末标点后切句 ──
  const roughPieces: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) continue;
    // 用捕获分组 split：标点被单独切出，随后拼回到所属句尾
    const parts = paragraph.split(SENTENCE_ENDINGS);
    let buffer = "";
    for (const part of parts) {
      if (part === "") continue;
      if (SENTENCE_ENDINGS.test(part)) {
        // 标点：拼回当前句尾，成句入队
        buffer += part;
        if (buffer.trim()) roughPieces.push(buffer.trim());
        buffer = "";
      } else {
        buffer += part;
      }
    }
    if (buffer.trim()) roughPieces.push(buffer.trim());
  }

  // ── 2) 二级切分：对超长句在次级标点处再切 ──
  const splitPieces: string[] = [];
  for (const piece of roughPieces) {
    if (textVisualWidth(piece) <= MAX_SEGMENT_WIDTH) {
      splitPieces.push(piece);
      continue;
    }
    splitPieces.push(...splitLongPiece(piece));
  }

  // ── 3) 合并过短碎片到前一句 ──
  return mergeShortFragments(splitPieces);
}

/**
 * 对「超过目标宽度的长句」在次级标点（逗号/顿号/分号/冒号）处再切分。
 * 标点保留在所属子句尾；若切完仍有子句超宽，也原样返回（不强行按字数硬切，
 * 保留语义完整，长句的换行交给下游 wrapSubtitleText 处理）。
 *
 * @param piece 单个超长句
 * @returns 子句数组
 */
function splitLongPiece(piece: string): string[] {
  const parts = piece.split(CLAUSE_SEPARATORS);
  const result: string[] = [];
  let buffer = "";
  for (const part of parts) {
    if (part === "") continue;
    if (CLAUSE_SEPARATORS.test(part)) {
      buffer += part;
      if (buffer.trim()) result.push(buffer.trim());
      buffer = "";
    } else {
      buffer += part;
    }
  }
  if (buffer.trim()) result.push(buffer.trim());
  // 无次级标点可切（result 只有原句）时，原样返回避免死循环
  return result.length > 0 ? result : [piece];
}

/**
 * 把视觉宽度过短的碎片并入「前一句」，避免一闪而过的短字幕。
 * 首句即过短时无前句可并，保留为独立句（否则会整段丢失）。
 *
 * @param pieces 切分后的句子数组
 * @returns 合并后的句子数组
 */
function mergeShortFragments(pieces: string[]): string[] {
  const merged: string[] = [];
  for (const piece of pieces) {
    if (merged.length > 0 && textVisualWidth(piece) < MIN_FRAGMENT_WIDTH) {
      // 并入前一句（直接拼接，标点已随句保留）
      merged[merged.length - 1] += piece;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/**
 * 字幕入场动效的共享时序常量（预览端 CSS 与导出端 ASS 读同一份，保证两端节奏一致）。
 *
 * 命名与单位说明：
 *   - fadeMs               淡入动效时长（毫秒）。对齐旧 \fad(200,200) 的淡入段。
 *   - slideUpMs            上滑动效时长（毫秒）：从下方偏移滑到位。
 *   - slideUpOffsetRatio   上滑起始纵向偏移，相对「画面高」的比例（0.04 ≈ 画面高的 4%）。
 *                          导出端换算为像素 dy=round(height*ratio)；预览端换算为 em 近似
 *                          （见 preview-player，用固定 em 值贴合视觉）。
 *   - popMs                弹跳（缩放）动效时长（毫秒）。
 *   - popStartScale        弹跳起始缩放比例（0.6 = 从 60% 放大到 100%）。
 *   - typewriterCharMs     打字机每个可见字符的名义显现间隔（毫秒/字）。
 *   - typewriterMaxRevealRatio  打字机「整体显现耗时」相对该句时间窗时长的上限比例
 *                          （0.5 = 最迟末字须在窗口前一半内显现完毕，长句自动压缩间隔）。
 */
export const SUBTITLE_ANIM = {
  fadeMs: 200,
  slideUpMs: 220,
  slideUpOffsetRatio: 0.04,
  popMs: 180,
  popStartScale: 0.6,
  typewriterCharMs: 60,
  typewriterMaxRevealRatio: 0.5,
} as const;

/**
 * 计算打字机效果下「每个字符的显现起始偏移」（秒，相对该句时间窗起点）。
 *
 * 规则（预览端与导出端共用此单一实现，保证逐字节奏两端完全一致）：
 *   1) 用 Array.from 做 Unicode 安全遍历，返回数组长度 === Array.from(text).length，
 *      与逐字符位置一一对应（含换行符：换行也占一个延迟槽，让下游按同一 index
 *      对齐——这是两端统一采用的换行规则，切勿在某一端跳过换行的槽位）。
 *   2) 名义间隔 typewriterCharMs 毫秒/字：第 i 个字符起始 = i × charMs。
 *   3) 压缩上限：若「名义总显现耗时」((n-1) × charMs) 超过
 *      windowDurationSec × typewriterMaxRevealRatio，则按比例压缩间隔，
 *      使末字起始恰好落在该上限，避免长句在窗口内还没显现完就被切走。
 *
 * @param text               该句字幕文本（若含换行，换行同样占槽位）
 * @param windowDurationSec  该句的时间窗时长（秒）
 * @returns 每字符显现起始偏移（秒）数组，索引与 Array.from(text) 对齐
 */
export function typewriterDelays(
  text: string,
  windowDurationSec: number
): number[] {
  const chars = Array.from(text);
  const n = chars.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const nominalStepSec = SUBTITLE_ANIM.typewriterCharMs / 1000;
  // 名义显现耗时 = 从第 0 字到第 n-1 字的总间隔
  const nominalTotal = (n - 1) * nominalStepSec;
  // 允许的最长显现耗时（窗口时长的一定比例）；窗口非正时退化为 0（全部同帧显现）
  const cap =
    windowDurationSec > 0
      ? windowDurationSec * SUBTITLE_ANIM.typewriterMaxRevealRatio
      : 0;
  // 超过上限则等比压缩每字间隔，使末字起始恰为 cap
  const stepSec =
    nominalTotal > cap && nominalTotal > 0 ? cap / (n - 1) : nominalStepSec;

  const delays: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) delays[i] = i * stepSec;
  return delays;
}

/** 单句字幕的时间窗（全部相对分镜起点，秒） */
export interface SubtitleWindow {
  /** 句子文本 */
  text: string;
  /** 起始秒（相对分镜起点） */
  start: number;
  /** 结束秒（相对分镜起点） */
  end: number;
}

/** 每句字幕的最小可读时长（秒），时长充裕时保证不低于此值 */
const MIN_WINDOW_DURATION = 0.8;

/**
 * 把分镜的总时长按「各句视觉宽度」比例分配给每句，得到逐句时间窗。
 *
 * 分配语义（纯函数、确定性）：
 *   - 每句时长 ∝ 其视觉宽度（charWidth：CJK=1、ASCII=0.5），
 *     宽句显示更久、短句更快，节奏贴合朗读。
 *   - 最小窗保障：时长充裕（span ≥ 句数 × MIN_WINDOW_DURATION）时，
 *     每句至少 MIN_WINDOW_DURATION 秒；把剩余时长按宽度比例再分给各句。
 *   - 兜底：时长过短（放不下所有最小窗）时退化为「纯比例分配」，
 *     不强行拉满最小窗（否则总和会超过 span）。
 *   - 连续且闭合：窗口首尾相接（window[k].end === window[k+1].start），
 *     start 从 0 开始，最后一句 end 恰为 totalDuration（浮点累积由末句兜正）。
 *
 * 配音时长对齐（批3）：若传入 voiceDuration（该镜配音的真实音频秒长）且它
 * 短于 totalDuration，则「逐句朗读节奏」按 voiceDuration 分配（字幕随语音走完，
 * 不再摊到语音结束后的静默画面里），但末句 end 停驻到 totalDuration（末句停驻，
 * 让最后一句一直显示到分镜结束）。voiceDuration 缺省 / ≤0 / ≥totalDuration 时
 * 退化为原「按 totalDuration 分配」，行为完全等价（零回归）。
 *
 * @param segments      逐句短句数组（splitSubtitleSegments 的输出）
 * @param totalDuration 分镜总时长（秒），应为正数
 * @param voiceDuration 该镜配音真实音频秒长（可选）；短于 totalDuration 时字幕节奏
 *                      按它分配 + 末句停驻到分镜末
 * @returns 逐句时间窗数组；segments 为空时返回空数组
 */
export function allocateSubtitleWindows(
  segments: string[],
  totalDuration: number,
  voiceDuration?: number
): SubtitleWindow[] {
  if (segments.length === 0) return [];
  const total = totalDuration > 0 ? totalDuration : 0;

  // 逐句朗读节奏的分配跨度 span：有有效配音时长且短于总时长时用配音时长，
  // 否则用总时长（原行为）。末句仍停驻到 total（见下方 end 计算）。
  const span =
    typeof voiceDuration === "number" &&
    voiceDuration > 0 &&
    voiceDuration < total
      ? voiceDuration
      : total;

  // 各句视觉宽度（最小 0.5 防止空句权重为 0 导致除零 / 分不到时长）
  const widths = segments.map((s) => Math.max(0.5, textVisualWidth(s)));
  const widthSum = widths.reduce((acc, w) => acc + w, 0);

  // 决定是否启用「最小窗保障」：仅当 span 足以让每句都不低于最小窗
  const canGuaranteeMin = span >= segments.length * MIN_WINDOW_DURATION;

  // 计算每句时长（按 span 分配）
  let durations: number[];
  if (canGuaranteeMin) {
    // 先给每句垫最小窗，剩余时长按宽度比例再分
    const reserved = segments.length * MIN_WINDOW_DURATION;
    const remain = span - reserved;
    durations = widths.map(
      (w) => MIN_WINDOW_DURATION + (remain * w) / widthSum
    );
  } else {
    // 时长不够垫最小窗 → 纯比例分配（可能有句 < 最小窗，但总和守恒到 span）
    durations = widths.map((w) => (span * w) / widthSum);
  }

  // 累加成连续闭合的时间窗；末句 end 停驻到 total（消除浮点累积误差，且实现
  // 「末句停驻到分镜末」——span < total 时最后一句从语音结束一直显示到画面结束）。
  const windows: SubtitleWindow[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const start = cursor;
    const end = i === segments.length - 1 ? total : cursor + durations[i];
    windows.push({ text: segments[i], start, end });
    cursor = end;
  }
  return windows;
}
