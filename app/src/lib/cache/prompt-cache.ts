/**
 * Prompt 图像缓存层（Stage 2.7）
 *
 * 目的：重复 prompt（相同 model / 参数 / 参考图）直接命中已有图像 URL，不再花费外部 API 积分。
 *
 * 设计：
 * - Key：`sha256(normalize(prompt) + model + style + aspectRatio + refImageHash + negativeHash)`
 * - Value：`{ imageUrl, strategy, createdAt }` JSON 序列化
 * - TTL：默认 7 天（`PROMPT_CACHE_TTL` 可覆盖）
 * - 存储：Redis 存在 → Redis；否则内存 Map（进程独立，主要给开发用）
 *
 * 关键取舍：
 * - Normalize 做基础的空白/大小写压缩；太激进会降低命中率（例如 "a" vs "A" 应视作同一 prompt）
 *   但不做 LLM 语义归一化（成本太高）。
 * - 不缓存失败结果：set 只在成功路径调用。
 */

import { createHash } from "crypto";
import { getRedis } from "../redis";
import { createLogger } from "../logger";

const log = createLogger("lib:prompt-cache");

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = "pcache:img:";

function ttlSeconds(): number {
  const raw = process.env.PROMPT_CACHE_TTL;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SECONDS;
}

export interface PromptCacheKeyInput {
  prompt: string;
  model?: string;
  style?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  negativePrompt?: string;
}

export interface CachedImage {
  imageUrl: string;
  strategy?: string;
  createdAt: number;
}

/** 轻量归一化：去首尾空白 + 连续空白合一 + 全小写 */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 构造稳定的缓存 key */
export function buildCacheKey(input: PromptCacheKeyInput): string {
  const parts = [
    normalize(input.prompt),
    input.model ?? "",
    input.style ?? "",
    input.aspectRatio ?? "",
    (input.referenceImages ?? [])
      .map((u) => u.trim())
      .sort()
      .join("|"),
    input.negativePrompt ? normalize(input.negativePrompt) : "",
  ].join("\n");
  const hash = createHash("sha256").update(parts).digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

// 开发态内存 fallback
const memoryStore = new Map<
  string,
  { value: CachedImage; expiresAt: number }
>();

async function memoryGet(key: string): Promise<CachedImage | null> {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function memorySet(
  key: string,
  value: CachedImage,
  ttl: number
): Promise<void> {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
}

/**
 * 取缓存；未命中或异常返回 null（视为 miss，上游正常生成）。
 */
export async function getPromptCache(
  input: PromptCacheKeyInput
): Promise<CachedImage | null> {
  const key = buildCacheKey(input);
  const redis = await getRedis();

  if (!redis) {
    return memoryGet(key);
  }

  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedImage;
  } catch (err) {
    log.warn("getPromptCache failed, treating as miss", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 写缓存（仅成功路径调用）。静默失败，不抛出。
 */
export async function setPromptCache(
  input: PromptCacheKeyInput,
  value: Omit<CachedImage, "createdAt">
): Promise<void> {
  const key = buildCacheKey(input);
  const ttl = ttlSeconds();
  const payload: CachedImage = { ...value, createdAt: Date.now() };
  const redis = await getRedis();

  if (!redis) {
    await memorySet(key, payload, ttl);
    return;
  }

  try {
    await redis.set(key, JSON.stringify(payload), "EX", ttl);
  } catch (err) {
    log.warn("setPromptCache failed, silently skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 测试/运维用：按 key 输入删缓存 */
export async function invalidatePromptCache(
  input: PromptCacheKeyInput
): Promise<void> {
  const key = buildCacheKey(input);
  const redis = await getRedis();
  if (!redis) {
    memoryStore.delete(key);
    return;
  }
  try {
    await redis.del(key);
  } catch {
    // ignore
  }
}
