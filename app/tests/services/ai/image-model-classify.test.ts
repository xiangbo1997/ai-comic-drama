import { describe, it, expect } from "vitest";
import { isLLMModel } from "@/services/ai/providers/openai-compatible";

/**
 * 回归：grok2api 的 Imagine 系列图像模型被误判为文本模型。
 *
 * 线上故障（2026-09-10）：用户在图像生成里配 grok2api + grok-imagine-image，
 * 该模型不在 SUPPORTED_IMAGE_MODELS 白名单里，被静默替换为 dall-e-3，
 * grok2api 不认识 dall-e-3 → 「模型«dall-e-3»不可用」。
 *
 * isLLMModel 是三处消费方的共同判据（openai-compatible 生成前拦截、
 * grok.ts 生成前拦截、connectivity-test-probes 连通性探测），
 * 判错会导致「测试显示已连接、真正生成却失败」的不一致。
 */
describe("grok Imagine 系列识别为图像模型", () => {
  const imagineModels = [
    "grok-imagine-image",
    "grok-imagine-image-2.0",
    "grok-imagine-image-quality",
    "grok-imagine-image-edit",
    "grok-imagine-image-lite",
  ];

  it.each(imagineModels)("%s 不应被判定为文本模型", (model) => {
    expect(isLLMModel(model)).toBe(false);
  });

  it("grok 文本模型仍正确判定为文本模型", () => {
    expect(isLLMModel("grok-4.6")).toBe(true);
    expect(isLLMModel("grok-4.5")).toBe(true);
    expect(isLLMModel("grok-2")).toBe(true);
  });

  it("其他图像模型不受影响", () => {
    expect(isLLMModel("dall-e-3")).toBe(false);
    expect(isLLMModel("gpt-image-2")).toBe(false);
    expect(isLLMModel("flux-schnell")).toBe(false);
    // 含 LLM 关键字但实为图像模型
    expect(isLLMModel("gemini-3-pro-image")).toBe(false);
  });

  it("常见文本模型仍正确判定", () => {
    expect(isLLMModel("gpt-4o")).toBe(true);
    expect(isLLMModel("claude-sonnet-5")).toBe(true);
    expect(isLLMModel("deepseek-chat")).toBe(true);
  });

  it("上游未来新增的未知图像模型名不会被误判为文本模型", () => {
    // 白名单必然滞后：这类名字既不在图像白名单、也不含 LLM 关键字，
    // 应判 false（不拦截），由上游给出权威结论。
    expect(isLLMModel("grok-imagine-image-3.0")).toBe(false);
    expect(isLLMModel("some-brand-new-image-model")).toBe(false);
  });
});
