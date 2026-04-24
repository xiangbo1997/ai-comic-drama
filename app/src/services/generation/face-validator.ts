/**
 * Face Validator
 *
 * Stage 1.6：用 LLM 多模态（Vision）做同一性判断，替换原先的 stub。
 * 流程：
 *   1. 从角色取参考图（canonicalImageUrl）；若无或无 LLM config 则降级 stub 放行。
 *   2. 构造 OpenAI / Claude 兼容的多模态 messages：reference + generated。
 *   3. 请求模型判断相似度（0-1）并要求 JSON 输出。
 *   4. 阈值由景别决定（特写/近景严格，远景放行）。
 *
 * 设计取舍：
 * - 绕过 `chatCompletion`（当前 `LLMMessage.content` 是 string，不支持 multimodal parts）。
 *   直接 fetch OpenAI 兼容端点；Claude 路径暂未覆盖（大多数中转站走 OpenAI schema，因此
 *   `proxy-unified` / `openai` 协议可用）。
 * - 成本控制：仅特写/近景做验证；不重试失败场景。
 * - 可回滚：任何步骤失败都返回 `passed: true, shouldRetry: false`，保持 stub 行为。
 */

import type { AIServiceConfig } from "@/types";
import type { SceneCharacterInfo, ValidationResult } from "./types";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:generation:face-validator");

/** 景别 → 验证严格程度映射 */
const SHOT_TYPE_CONFIG: Record<
  string,
  { requireFace: boolean; threshold: number }
> = {
  特写: { requireFace: true, threshold: 0.8 },
  近景: { requireFace: true, threshold: 0.75 },
  中景: { requireFace: true, threshold: 0.65 },
  远景: { requireFace: false, threshold: 0 },
  全景: { requireFace: false, threshold: 0 },
};

const DEFAULT_CONFIG = { requireFace: false, threshold: 0 };

/** 与 stub 行为一致的放行结果 */
function passthrough(reason: string): ValidationResult {
  return {
    passed: true,
    faceCount: 0,
    scores: {},
    shouldRetry: false,
    reason,
  };
}

export interface FaceValidatorOptions {
  /** LLM 多模态 config；未提供则降级为 stub 放行 */
  llmConfig?: AIServiceConfig;
}

/**
 * 验证生成图像的角色一致性
 */
export async function validateFaceConsistency(
  imageUrl: string,
  characters: SceneCharacterInfo[],
  shotType?: string,
  options?: FaceValidatorOptions
): Promise<ValidationResult> {
  const config = SHOT_TYPE_CONFIG[shotType ?? ""] ?? DEFAULT_CONFIG;

  // 非人脸场景：直接放行
  if (!config.requireFace) {
    return passthrough("validation_skipped_for_shot_type");
  }

  const primary = characters.find((c) => c.role === "primary");
  const referenceUrl = primary?.canonicalImageUrl;
  if (!primary || !referenceUrl) {
    return passthrough("no_primary_reference_image");
  }

  if (!options?.llmConfig) {
    return passthrough("llm_config_missing");
  }

  try {
    const score = await llmSimilarityScore({
      referenceUrl,
      generatedUrl: imageUrl,
      characterName: primary.name,
      llmConfig: options.llmConfig,
    });

    const passed = score >= config.threshold;
    return {
      passed,
      faceCount: 1,
      scores: { [primary.name]: score },
      shouldRetry: !passed,
      reason: passed ? "llm_similarity_ok" : "llm_similarity_below_threshold",
    };
  } catch (err) {
    // 任何异常都降级放行，避免验证器本身阻塞生成
    log.warn("LLM face validation failed, passing through", {
      error: err instanceof Error ? err.message : String(err),
      shotType,
    });
    return passthrough("llm_validation_error");
  }
}

interface SimilarityArgs {
  referenceUrl: string;
  generatedUrl: string;
  characterName: string;
  llmConfig: AIServiceConfig;
}

/**
 * 调用 LLM 多模态 API 返回 0-1 的同一性分数。
 * 走 OpenAI chat completions 兼容协议：content 为 parts 数组。
 */
async function llmSimilarityScore(args: SimilarityArgs): Promise<number> {
  const { referenceUrl, generatedUrl, characterName, llmConfig } = args;
  const baseUrl = llmConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = llmConfig.model || "gpt-4o-mini";

  const body = {
    model,
    temperature: 0,
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content:
          'You are a strict character consistency checker. Compare two images and judge whether they depict the same character (face, hairstyle, outfit, overall appearance). Reply ONLY with JSON: {"same": boolean, "score": number between 0 and 1, "reason": string}. Higher score = more similar.',
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Character name: ${characterName}. The first image is the canonical reference; the second is a newly generated scene. Judge whether they depict the same character.`,
          },
          { type: "image_url", image_url: { url: referenceUrl } },
          { type: "image_url", image_url: { url: generatedUrl } },
        ],
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Face validator LLM HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return extractScore(text);
}

/** 从 LLM 回复中抽取 0-1 的 score；健壮解析各种格式 */
function extractScore(text: string): number {
  // 优先从 JSON 块提取
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { score?: number };
      if (typeof parsed.score === "number") {
        return clamp01(parsed.score);
      }
    } catch {
      // 回退
    }
  }
  // 退化：匹配第一个 0-1 浮点
  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    return clamp01(n > 1 ? n / 100 : n);
  }
  return 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
