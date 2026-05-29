/**
 * Vision Reviewer (P1-C2)
 *
 * 让 ObserverAgent 真正"看到"生成图像。
 *
 * 背景：ObserverAgent 原先用 `chatCompletion`（content 仅 string，不支持多模态 parts）做评审，
 * 生成图的 imageUrl 被完全丢弃 —— "角色一致性"评分实际只评了提示词是否完整，而非图像是否真的一致。
 * 这是角色一致性自纠错闭环失效的根因之一。
 *
 * 方案：复用 face-validator.ts 的做法 —— 绕过 chatCompletion，直接 fetch OpenAI 兼容端点，
 * messages.content 用 parts 数组携带 image_url。让模型对真实图像做 5 维评分。
 *
 * 设计取舍：
 * - 走 OpenAI chat completions 兼容协议（proxy-unified / openai 协议可用，与 face-validator 一致）。
 * - 任何失败都抛出，由调用方（observer-agent）降级到纯文本评审，保持可回滚。
 */

import type { AIServiceConfig } from "@/types";
import type { ObserverVerdict } from "./types";
import {
  OBSERVER_SYSTEM,
  buildImageReviewPrompt,
} from "@/lib/prompts/agent-prompts";

export interface VisionReviewArgs {
  imageUrl: string;
  sceneDescription: string;
  characterDescriptions: string;
  expectedEmotion: string;
  expectedShotType: string;
  llmConfig: AIServiceConfig;
}

/**
 * 用多模态模型对生成图像做 5 维评审，返回完整 ObserverVerdict。
 * 失败时抛出，由调用方降级。
 */
export async function reviewImageWithVision(
  args: VisionReviewArgs
): Promise<ObserverVerdict> {
  const {
    imageUrl,
    sceneDescription,
    characterDescriptions,
    expectedEmotion,
    expectedShotType,
    llmConfig,
  } = args;

  const baseUrl = llmConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = llmConfig.model || "gpt-4o-mini";

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1024,
    messages: [
      { role: "system", content: OBSERVER_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildImageReviewPrompt(
              sceneDescription,
              characterDescriptions,
              expectedEmotion,
              expectedShotType
            ),
          },
          { type: "image_url", image_url: { url: imageUrl } },
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
    throw new Error(`Vision reviewer LLM HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseVerdict(text);
}

/** 从 LLM 回复中抽取 ObserverVerdict JSON；失败抛出由调用方降级 */
function parseVerdict(text: string): ObserverVerdict {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch
    ? codeBlockMatch[1].trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    throw new Error("Vision reviewer: no JSON in response");
  }
  return JSON.parse(jsonText) as ObserverVerdict;
}
