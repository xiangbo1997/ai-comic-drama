/**
 * 场景分析缓存层（2026-07-05，a7 审计 P1-4）
 *
 * 背景：图像生成每次都无条件跑一次 LLM 场景分析（buildSceneAnalysisPrompt +
 * chatCompletion，~1024 tokens）。同一分镜「重新生成」时场景描述/景别/情绪
 * 通常不变，这次 LLM 往返纯浪费（图像 prompt-cache 只缓存最终图，救不了
 * 分析这一步）。
 *
 * 按「场景内容 + 角色名」哈希缓存分析结果 JSON。命中即跳过 LLM 调用。
 * 复用 prompt-cache 同款存储策略：Redis 存在→Redis，否则进程内存 Map。
 * TTL 默认 7 天。任何异常按 miss 处理，不阻断生成。
 */

import { createHash } from "crypto";
import { getRedis } from "../redis";
import { createLogger } from "../logger";

const log = createLogger("lib:analysis-cache");

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = "acache:scene:";

export interface AnalysisCacheKeyInput {
  sceneDescription: string;
  dialogue?: string;
  emotion?: string;
  shotType?: string;
  /** 角色名列表（有序，影响多角色互动分析） */
  characterNames: string[];
  /** 相邻镜画面描述（连续性记忆）：变化会改变连续性指令，故纳入 key */
  prevSceneDescription?: string;
  nextSceneDescription?: string;
  /**
   * 系列记忆 digest（续集时注入分析 prompt）：圣经更新会改变既定设定指令，
   * 必须纳入 key，否则圣经变化后仍命中旧分析（stale）。
   */
  seriesContext?: string;
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildKey(input: AnalysisCacheKeyInput): string {
  const parts = [
    normalize(input.sceneDescription),
    input.dialogue ? normalize(input.dialogue) : "",
    input.emotion ?? "",
    input.shotType ?? "",
    input.characterNames.join("|"),
    input.prevSceneDescription ? normalize(input.prevSceneDescription) : "",
    input.nextSceneDescription ? normalize(input.nextSceneDescription) : "",
    input.seriesContext ? normalize(input.seriesContext) : "",
  ].join("\n");
  const hash = createHash("sha256").update(parts).digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

const memoryStore = new Map<string, { value: string; expiresAt: number }>();

/** 取缓存的分析结果（原始 JSON 字符串）；miss/异常返回 null */
export async function getAnalysisCache(
  input: AnalysisCacheKeyInput
): Promise<string | null> {
  const key = buildKey(input);
  const redis = await getRedis();
  if (!redis) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  }
  try {
    return await redis.get(key);
  } catch (err) {
    log.warn("getAnalysisCache failed, treating as miss", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 写缓存（仅成功解析后调用）；静默失败不抛 */
export async function setAnalysisCache(
  input: AnalysisCacheKeyInput,
  value: string
): Promise<void> {
  const key = buildKey(input);
  const redis = await getRedis();
  if (!redis) {
    memoryStore.set(key, {
      value,
      expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000,
    });
    return;
  }
  try {
    await redis.set(key, value, "EX", DEFAULT_TTL_SECONDS);
  } catch (err) {
    log.warn("setAnalysisCache failed, silently skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
