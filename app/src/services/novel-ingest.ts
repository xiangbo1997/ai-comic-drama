/**
 * 长篇小说摄取：分块压缩管线
 *
 * 借鉴 HKUDS ViMax 的 NovelCompressor（chunked compress + aggregate），适配本项目：
 * 长篇小说/长章节喂给剧本解析前，先做「分块 → 并行 LLM 压缩（保情节保对白）→ 聚合去重叠」，
 * 把体量压到解析可承受的范围，同时保住主线情节与关键对白。
 *
 * 分层：本文件调用 services/ai 的 chatCompletion，按 services→lib 单向依赖约定放在
 * services 层（不放 lib，避免 lib 反向依赖 services）。
 */

import { chatCompletion } from "./ai";
import type { AIServiceConfig } from "@/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:novel-ingest");

/** 超过该字符数才触发压缩；短文本原样透传，避免无谓 LLM 往返 */
export const NOVEL_COMPRESS_THRESHOLD = 6000;

/** 硬上限：超过直接拒绝（对应 20 万字），防止极端输入拖垮压缩管线 */
export const MAX_NOVEL_INPUT = 200_000;

/** 单块目标字符数（分块粒度，约对应 LLM 单次可稳定处理的量） */
export const CHUNK_SIZE = 8000;

/** 相邻块重叠字符数：跨块情节不因边界被割裂，聚合时按语义去重 */
export const CHUNK_OVERLAP = 400;

/** 并行压缩并发上限：控制同时在飞的 LLM 请求数，避免打爆上游配额 */
export const COMPRESS_CONCURRENCY = 4;

/** 聚合去重叠触发阈值：拼接后总长超过此值才做一次轻量 LLM 聚合 */
const AGGREGATE_THRESHOLD = 12000;

/** 单块压缩失败的重试次数（首次失败后重试 1 次，仍失败则原文降级） */
const CHUNK_RETRY = 1;

export interface CompressNovelResult {
  /** 压缩后（或原样）的文本 */
  text: string;
  /** 是否实际执行了压缩（短文本为 false） */
  compressed: boolean;
  /** 原始字符数 */
  originalLength: number;
  /** 产出字符数（未压缩时等于原始） */
  compressedLength: number;
}

export interface CompressNovelOptions {
  /** 进度回调：done 为已完成块数，total 为总块数 */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 段落感知分块。
 *
 * 策略：
 * 1. 优先在段落边界（\n\n 或单个 \n）切，保住段落完整性；
 * 2. 若单段本身超过 chunkSize，段内再按句号/换行硬切，避免单块无限膨胀；
 * 3. 相邻块带 overlap 尾部重叠（从上一块结尾截取 overlap 字符作为下一块开头），
 *    让跨块情节有上下文衔接，聚合阶段再做语义去重。
 *
 * 纯函数、无副作用，供路由与单测引用。
 */
export function splitNovelText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  // 第一步：把文本切成「段落感知的原子片段」——优先 \n\n，其次 \n；
  // 单段超长时按句末标点/换行硬切成不超过 chunkSize 的小片。
  const segments = toAtomicSegments(trimmed, chunkSize);

  // 第二步：贪心装箱——把原子片段依次塞进当前块，超过 chunkSize 就开新块。
  const rawChunks: string[] = [];
  let current = "";
  for (const seg of segments) {
    if (current.length === 0) {
      current = seg;
      continue;
    }
    // 段落间用 \n\n 复原自然分隔
    if (current.length + seg.length + 2 <= chunkSize) {
      current = `${current}\n\n${seg}`;
    } else {
      rawChunks.push(current);
      current = seg;
    }
  }
  if (current.length > 0) rawChunks.push(current);

  // 第三步：给相邻块补 overlap——从上一块结尾截取 overlap 字符前置到下一块。
  // 首块不加。overlap<=0 时直接返回原始块。
  if (overlap <= 0 || rawChunks.length <= 1) return rawChunks;

  return rawChunks.map((chunk, idx) => {
    if (idx === 0) return chunk;
    const prev = rawChunks[idx - 1];
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    return `${tail}${chunk}`;
  });
}

/**
 * 把文本拆成不超过 chunkSize 的原子片段：
 * 先按段落边界（\n\n / \n）拆，任何超长段再按句末标点/换行硬切。
 */
function toAtomicSegments(text: string, chunkSize: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const result: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= chunkSize) {
      result.push(para);
      continue;
    }
    // 段落仍超长：先尝试按单换行拆
    const lines = para
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      if (line.length <= chunkSize) {
        result.push(line);
      } else {
        // 单行仍超长：按句末标点硬切成不超过 chunkSize 的片段
        result.push(...hardSplitBySentence(line, chunkSize));
      }
    }
  }
  return result;
}

/**
 * 按句末标点（。！？.!? 及其后引号）硬切超长文本；
 * 若单句仍超过 chunkSize，则按 chunkSize 定长兜底切分，绝不产出超限片段。
 */
function hardSplitBySentence(text: string, chunkSize: number): string[] {
  // 在句末标点后插入切点：保留标点，标点后可跟中/英右引号
  const sentences = text
    .split(/(?<=[。！？.!?][」』"'）)]?)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    // 单句本身超限：定长兜底切
    if (sentence.length > chunkSize) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += chunkSize) {
        result.push(sentence.slice(i, i + chunkSize));
      }
      continue;
    }
    if (current.length + sentence.length <= chunkSize) {
      current += sentence;
    } else {
      if (current.length > 0) result.push(current);
      current = sentence;
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * 单块压缩 system prompt（借鉴 ViMax NovelCompressor 并强化对白保真）。
 *
 * 核心取舍：下游分镜/TTS 直接消费原文对白，因此对白必须逐字保留，
 * 只压叙述/描写/内心戏；主线情节、转折、因果链、出场角色行为一个不能丢。
 */
const COMPRESS_SYSTEM_PROMPT = `你是专业的小说浓缩编辑，为「小说转漫剧」流水线预处理长文。请对用户提供的小说片段做无损情节的浓缩改写。

【必须保留】
- 全部主线情节、关键转折、因果链，以及每一处推动剧情的角色行为与决定；
- 所有出场角色及其在本片段中的关键动作；
- 【关键对白逐字保留】——凡是引号内的人物台词，原封不动照抄，一个字都不能改写、删减或转述（下游要用原文对白配音和分镜）。

【可压缩】
- 场景与外貌描写：压到最具画面感的要点（谁、在哪、什么氛围、关键视觉特征）；
- 人物内心独白：压成一句关键决意或情绪；
- 铺垫与过渡叙述：保留信息骨架，删去修辞堆砌。

【必须删除】
- 与叙事无关的水字、重复表述、凑字数内容；
- 作者注、求关注、求订阅、章节预告等非正文内容。

【输出要求】
- 输出连贯的叙述段落，不要加章节标题、小标题或任何标记；
- 不要输出任何解释、前言或"以下是浓缩版"之类的话，直接给浓缩后的正文；
- 语言与原文保持一致（中文原文输出中文）；
- 目标篇幅：压到原文的三分之一左右（对白部分不计入压缩，据实保留）。`;

/**
 * 聚合去重叠 system prompt：仅处理相邻块因 overlap 产生的重复表述，其余原样保留。
 */
const AGGREGATE_SYSTEM_PROMPT = `你是小说浓缩稿的拼接校对。用户提供的文本由多个片段顺序拼接而成，相邻片段之间可能因重叠而出现重复的句子或情节。请做以下处理：

- 识别并合并相邻片段间语义重复的表述，只保留一处；
- 其余内容一律原样保留，不要额外压缩、改写或删减；
- 引号内的人物台词绝对不动；
- 输出连贯正文，不加任何标题或说明文字。`;

/**
 * 压缩单个文本块：失败重试 CHUNK_RETRY 次，仍失败则原文降级（保情节优先）。
 */
async function compressChunk(
  chunk: string,
  index: number,
  llmConfig: AIServiceConfig
): Promise<string> {
  for (let attempt = 0; attempt <= CHUNK_RETRY; attempt++) {
    try {
      const compressed = await chatCompletion(
        [
          { role: "system", content: COMPRESS_SYSTEM_PROMPT },
          { role: "user", content: chunk },
        ],
        {
          config: llmConfig,
          temperature: 0.3,
          // 输出目标约为输入的 1/3，但对白逐字保留会撑高下限，给足余量。
          maxTokens: 4096,
        }
      );
      const result = compressed.trim();
      // LLM 偶发返回空/极短：视为失败走重试/降级，避免丢块。
      if (result.length === 0) {
        throw new Error("压缩结果为空");
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < CHUNK_RETRY) {
        log.warn(
          `块 ${index} 压缩失败（第 ${attempt + 1} 次），重试：${message}`
        );
        continue;
      }
      // 仍失败：宁可保留原文也不丢情节
      log.warn(`块 ${index} 压缩最终失败，原文降级保留：${message}`);
      return chunk;
    }
  }
  // 理论不可达（循环内必 return）；保守兜底返回原文
  return chunk;
}

/**
 * 简单并发池：以 concurrency 为上限并行执行 tasks，返回与输入等长、按序对齐的结果数组。
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onEach?: () => void
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await tasks[current]();
      onEach?.();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * 压缩长篇小说文本。
 *
 * 流程：
 * - text ≤ THRESHOLD：原样返回（compressed:false），零 LLM 消耗；
 * - 否则分块 → 并发压缩（限 COMPRESS_CONCURRENCY，单块失败重试 1 次仍失败则原文降级）；
 * - 聚合：按序拼接。仅当拼接后总长 > AGGREGATE_THRESHOLD 时，做一次轻量 LLM 聚合去重叠；
 *   否则直接拼接——overlap 仅 400 字，相邻块重复代价很小，为省一次 LLM 往返直接跳过聚合。
 *
 * 任何异常都不抛给上层：整体失败时原文降级，保证解析链路不中断。
 */
export async function compressNovel(
  text: string,
  llmConfig: AIServiceConfig,
  opts?: CompressNovelOptions
): Promise<CompressNovelResult> {
  const originalLength = text.length;

  if (originalLength <= NOVEL_COMPRESS_THRESHOLD) {
    return {
      text,
      compressed: false,
      originalLength,
      compressedLength: originalLength,
    };
  }

  const chunks = splitNovelText(text, CHUNK_SIZE, CHUNK_OVERLAP);
  log.info(`小说压缩启动：原文 ${originalLength} 字，切分 ${chunks.length} 块`);

  let done = 0;
  const total = chunks.length;
  opts?.onProgress?.(0, total);

  const compressedChunks = await runWithConcurrency(
    chunks.map((chunk, index) => () => compressChunk(chunk, index, llmConfig)),
    COMPRESS_CONCURRENCY,
    () => {
      done += 1;
      opts?.onProgress?.(done, total);
    }
  );

  let joined = compressedChunks.join("\n\n");

  // 聚合去重叠：只在拼接后仍较长时做一次，权衡「一次额外 LLM 往返」vs「400 字重叠冗余」。
  if (joined.length > AGGREGATE_THRESHOLD) {
    try {
      const aggregated = await chatCompletion(
        [
          { role: "system", content: AGGREGATE_SYSTEM_PROMPT },
          { role: "user", content: joined },
        ],
        { config: llmConfig, temperature: 0.2, maxTokens: 8192 }
      );
      const result = aggregated.trim();
      if (result.length > 0) {
        joined = result;
      } else {
        log.warn("聚合去重叠返回空，保留拼接结果");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`聚合去重叠失败，保留拼接结果：${message}`);
    }
  }

  const compressedLength = joined.length;
  const ratio =
    originalLength > 0
      ? ((compressedLength / originalLength) * 100).toFixed(1)
      : "0";
  log.info(
    `小说压缩完成：${originalLength} → ${compressedLength} 字（${ratio}%），${total} 块`
  );

  return {
    text: joined,
    compressed: true,
    originalLength,
    compressedLength,
  };
}
