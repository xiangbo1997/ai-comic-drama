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
