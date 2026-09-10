import { describe, it, expect } from "vitest";
import { resolveStrategy } from "@/services/generation/strategy-resolver";
import {
  getImageProviderCapability,
  describeImageCapabilityOverride,
} from "@/services/ai/provider-factory";

describe("A1 能力覆盖表 + 告知链", () => {
  const variants = [
    "grok-imagine-image",
    "grok-2-image",
    "grok-2-image-1212",
    "GROK-IMAGINE",
    "xai/grok-imagine-image:latest",
  ];
  it.each(variants)("%s 判定为不支持参考图", (model) => {
    const cap = getImageProviderCapability("openai", model);
    expect(cap.supportsReferenceImage).toBe(false);
    expect(cap.maxReferenceImages).toBe(0);
    expect(describeImageCapabilityOverride("openai", model)).toContain("grok");
  });

  it("不命中的模型保持 openai 协议能力（零回归）", () => {
    const cap = getImageProviderCapability("openai", "gpt-image-1");
    expect(cap.supportsReferenceImage).toBe(true);
    expect(cap.maxReferenceImages).toBe(4);
    expect(describeImageCapabilityOverride("openai", "gpt-image-1")).toBeNull();
  });

  it("不传 model 时与旧行为完全一致", () => {
    expect(getImageProviderCapability("openai")).toEqual(
      getImageProviderCapability("openai", undefined)
    );
    expect(getImageProviderCapability("openai").supportsReferenceImage).toBe(
      true
    );
  });

  it("告知文案包含模型名/后果/下一步", () => {
    const d = resolveStrategy(
      [
        {
          id: "c1",
          name: "林烬",
          role: "primary" as const,
          canonicalImageUrl: "https://x/a.png",
          referenceImages: [],
        },
      ],
      "walking",
      {
        apiKey: "k",
        baseUrl: "b",
        model: "grok-imagine-image",
        protocol: "openai",
      }
    );
    expect(d.strategy).toBe("prompt_only");
    const w = d.warnings?.[0] ?? "";
    expect(w).toContain("grok-imagine-image");
    expect(w).toContain("角色一致性无法保证");
    expect(w).toContain("AI 模型设置");
  });
});
