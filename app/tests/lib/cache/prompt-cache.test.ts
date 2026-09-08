import { describe, it, expect } from "vitest";
import {
  buildCacheKey,
  getPromptCache,
  setPromptCache,
  invalidatePromptCache,
} from "@/lib/cache/prompt-cache";

describe("buildCacheKey()", () => {
  it("produces identical key for semantically equal inputs (whitespace/case normalized)", () => {
    const a = buildCacheKey({ prompt: "  Hello World  ", model: "m1" });
    const b = buildCacheKey({ prompt: "hello   world", model: "m1" });
    expect(a).toBe(b);
  });

  it("produces distinct key when reference images differ", () => {
    const a = buildCacheKey({
      prompt: "x",
      referenceImages: ["https://a/1.png"],
    });
    const b = buildCacheKey({
      prompt: "x",
      referenceImages: ["https://a/1.png", "https://a/2.png"],
    });
    expect(a).not.toBe(b);
  });

  it("sorts reference images before hashing (顺序不影响 key)", () => {
    const a = buildCacheKey({
      prompt: "x",
      referenceImages: ["https://a/1.png", "https://a/2.png"],
    });
    const b = buildCacheKey({
      prompt: "x",
      referenceImages: ["https://a/2.png", "https://a/1.png"],
    });
    expect(a).toBe(b);
  });

  // 多候选付费正确性：同 prompt 不同 seed 必须是不同 key，否则第 2..N 张
  // 候选会命中第 1 张的缓存，用户按 N 张付费只得到 1 张不同的图。
  it("seed 不同 → key 不同（多候选不共用缓存）", () => {
    const a = buildCacheKey({ prompt: "x", model: "m", seed: 1 });
    const b = buildCacheKey({ prompt: "x", model: "m", seed: 2 });
    expect(a).not.toBe(b);
  });

  it("seed 相同 → key 相同（命中路径与写入路径同构）", () => {
    const a = buildCacheKey({ prompt: "x", model: "m", seed: 42 });
    const b = buildCacheKey({ prompt: "x", model: "m", seed: 42 });
    expect(a).toBe(b);
  });

  it("缺省 seed 与显式 seed=0 分属不同 key", () => {
    const none = buildCacheKey({ prompt: "x", model: "m" });
    const zero = buildCacheKey({ prompt: "x", model: "m", seed: 0 });
    expect(none).not.toBe(zero);
  });
});

describe("getPromptCache / setPromptCache (memory fallback)", () => {
  it("returns null on miss", async () => {
    const r = await getPromptCache({
      prompt: "miss-" + Date.now(),
      model: "m",
    });
    expect(r).toBeNull();
  });

  it("roundtrips value: set then get returns same imageUrl", async () => {
    const input = { prompt: "roundtrip-" + Date.now(), model: "m" };
    await setPromptCache(input, {
      imageUrl: "https://cdn/x.png",
      strategy: "prompt_only",
    });
    const r = await getPromptCache(input);
    expect(r?.imageUrl).toBe("https://cdn/x.png");
    expect(r?.strategy).toBe("prompt_only");
    await invalidatePromptCache(input);
  });
});
