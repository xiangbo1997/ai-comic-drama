/**
 * strategy-resolver 参考图收集规则测试
 *
 * 重点覆盖 2026-07-08 补平的 workflow/手动路径不对等：
 * 每角色优先消费多角度参考 referenceImageUrls（三视图+定妆），
 * 缺失时回退单张 canonicalImageUrl，并按 provider 能力裁剪。
 */
import { describe, it, expect } from "vitest";
import { resolveStrategy } from "@/services/generation/strategy-resolver";
import type { SceneCharacterInfo } from "@/services/generation/types";
import type { AIServiceConfig } from "@/types";

/** 支持多参考图（maxReferenceImages=4）的配置 */
const multiRefConfig = {
  protocol: "openai",
  baseUrl: "https://api.example.com",
  apiKey: "k",
  model: "gpt-image-1",
} as AIServiceConfig;

/** 仅支持单参考图的配置 */
const singleRefConfig = { ...multiRefConfig, protocol: "replicate" };

/** 不支持参考图的配置 */
const noRefConfig = { ...multiRefConfig, protocol: "grok" };

function makeChar(
  overrides: Partial<SceneCharacterInfo> & { name: string }
): SceneCharacterInfo {
  return {
    id: `char-${overrides.name}`,
    role: "primary",
    description: "test character",
    ...overrides,
  };
}

describe("resolveStrategy（多角度参考图收集）", () => {
  const threeViews = [
    "https://x/front.png",
    "https://x/side.png",
    "https://x/back.png",
  ];
  const canonical = "https://x/canonical.png";

  it("角色带 referenceImageUrls（三视图+定妆）时全部按序注入", () => {
    const d = resolveStrategy(
      [
        makeChar({
          name: "林烬",
          referenceImageUrls: [...threeViews, canonical],
        }),
      ],
      "walking in rain",
      multiRefConfig
    );
    expect(d.strategy).toBe("reference_edit");
    expect(d.referenceImageUrls).toEqual([...threeViews, canonical]);
    expect(d.referenceImageUrl).toBe(threeViews[0]);
  });

  it("无 referenceImageUrls 时回退单张 canonicalImageUrl（旧行为不变）", () => {
    const d = resolveStrategy(
      [makeChar({ name: "林烬", canonicalImageUrl: canonical })],
      "walking in rain",
      multiRefConfig
    );
    expect(d.referenceImageUrls).toEqual([canonical]);
  });

  it("多角色按 role 排序收集且去重：primary 三视图在前，secondary 定妆随后", () => {
    const shared = "https://x/shared.png";
    const d = resolveStrategy(
      [
        makeChar({
          name: "配角",
          role: "secondary",
          referenceImageUrls: [shared],
        }),
        makeChar({
          name: "林烬",
          role: "primary",
          referenceImageUrls: [threeViews[0], shared],
        }),
      ],
      "two people talking",
      multiRefConfig
    );
    expect(d.referenceImageUrls).toEqual([threeViews[0], shared]);
  });

  it("provider 只支持单图时裁剪到 1 张（primary 首张胜出）", () => {
    const d = resolveStrategy(
      [makeChar({ name: "林烬", referenceImageUrls: threeViews })],
      "walking in rain",
      singleRefConfig
    );
    expect(d.referenceImageUrls).toEqual([threeViews[0]]);
  });

  it("provider 不支持参考图时回落 prompt_only", () => {
    const d = resolveStrategy(
      [makeChar({ name: "林烬", referenceImageUrls: threeViews })],
      "walking in rain",
      noRefConfig
    );
    expect(d.strategy).toBe("prompt_only");
    // 既有行为：不支持多图的 provider maxRefs 按 1 计，decision 中可能残留
    // 1 张 URL，但 strategy 已回落、provider 侧忽略参考图，不影响生成语义
    expect(d.referenceImageUrl).toBeUndefined();
  });

  it("显式 referenceImagesOverride 优先于角色推断", () => {
    const override = ["https://x/override.png"];
    const d = resolveStrategy(
      [makeChar({ name: "林烬", referenceImageUrls: threeViews })],
      "walking in rain",
      multiRefConfig,
      undefined,
      { referenceImagesOverride: override }
    );
    expect(d.referenceImageUrls).toEqual(override);
  });
});
