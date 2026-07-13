/**
 * 视频导演增强缓存层（LLM 导演增强 · Deliverable 2）
 *
 * 与图像端的场景分析缓存（analysis-cache.ts）同款存储策略：Redis 存在→Redis，
 * 否则进程内存 Map，TTL 默认 7 天，任何异常按 miss 处理不阻断生成。
 *
 * 差异：analysis-cache 的 key 是图像专用的固定字段集（sceneDescription /
 * dialogue / emotion / shotType / characterNames）；视频导演的输入更宽（含相邻镜
 * actionBeat、角色 identity、风格、前情提要），且这些都影响导演产出，故独立
 * 一个缓存，按「完整输入的稳定序列化」哈希。
 */

import { createHash } from "crypto";
import { getRedis } from "../redis";
import { createLogger } from "../logger";
import type { VideoDirectorInput } from "@/services/generation/video-director";

const log = createLogger("lib:video-direction-cache");

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * 缓存 key 前缀带版本号。缓存 key 只哈希输入形状、不含 DIRECTOR_SYSTEM 提示词文本，
 * 故导演提示词语义变更（如 v2 注入「帧识别原则」，改变 endFrameDesc 的写法）时，
 * 老缓存会原样重放、绕过新规则。凡改动 DIRECTOR_SYSTEM 的产出语义，必须 bump 此版本号
 * 令旧缓存整体失效（miss 后按新提示词重新导演）。
 * v1→v2：注入首帧/关键帧识别原则（终态凝固态，禁「即将发生」预备态）。
 */
const KEY_PREFIX = "vdcache:scene:v2:";

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 稳定序列化：只取影响导演产出的字段，按固定顺序拼接后哈希。
 * 字段顺序固定 → 同一逻辑输入必得同一 key（对象字段顺序无关）。
 */
function buildKey(input: VideoDirectorInput): string {
  const { scene, characters, prevScene, nextScene, style, seriesRecap } = input;
  const parts = [
    normalize(scene.description),
    scene.actionBeat ? normalize(scene.actionBeat) : "",
    scene.shotType ?? "",
    scene.cameraAngle ?? "",
    scene.lighting ? normalize(scene.lighting) : "",
    scene.emotion ?? "",
    String(scene.duration),
    // 角色按 name 排序，消除数组顺序抖动
    characters
      .map((c) => `${c.name}:${normalize(c.identity)}`)
      .sort()
      .join("|"),
    prevScene
      ? `${normalize(prevScene.description)}#${prevScene.actionBeat ? normalize(prevScene.actionBeat) : ""}`
      : "",
    nextScene
      ? `${normalize(nextScene.description)}#${nextScene.actionBeat ? normalize(nextScene.actionBeat) : ""}`
      : "",
    style ?? "",
    seriesRecap ? normalize(seriesRecap) : "",
  ].join("\n");
  const hash = createHash("sha256").update(parts).digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

const memoryStore = new Map<string, { value: string; expiresAt: number }>();

/** 取缓存的导演结果（原始 JSON 字符串）；miss/异常返回 null */
export async function getVideoDirectionCache(
  input: VideoDirectorInput
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
    log.warn("getVideoDirectionCache failed, treating as miss", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 写缓存（仅成功解析后调用）；静默失败不抛 */
export async function setVideoDirectionCache(
  input: VideoDirectorInput,
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
    log.warn("setVideoDirectionCache failed, silently skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
