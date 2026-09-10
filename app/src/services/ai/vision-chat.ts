/**
 * 多协议视觉对话（OpenAI 兼容 / Claude / Gemini）
 *
 * 为什么需要本文件：
 * 门面 `chatCompletion()` 的 `LLMMessage.content` 是 `string`，结构上无法承载
 * 多模态 parts —— 所有需要「让模型看图」的场景（face-validator / vision-reviewer /
 * 场记对比）都只能绕过门面自己 fetch。此前这些实现都只拼了 OpenAI 的
 * `/chat/completions`，对 claude / gemini 协议直接抛错降级；用户 LLM 配成 Claude 时
 * 校验在所有路径上 100% 空转（审计 D1-3）。
 *
 * 本文件把「一段文字 + N 张图 → 一段文字回复」这件事按协议收口成一个函数，
 * 三种协议各自拼自己的请求体与取值路径：
 *   - openai / proxy-unified / grok 等 OpenAI 兼容：messages[].content = parts 数组
 *   - claude：messages[].content = [{type:"text"},{type:"image",source:{...}}]，
 *     且 Claude 只接受 base64 source（不收任意外链 URL），故 http(s) 图需先抓成 base64
 *   - gemini：contents[].parts = [{text},{inline_data:{mime_type,data}}]
 *
 * 失败语义：任何不可用（协议不支持 / HTTP 失败 / 无法取图）一律抛错，由调用方
 * 决定降级行为；本文件不做静默放行。
 */

import type { AIServiceConfig } from "@/types";
import { trimUrl } from "./providers/base";
import { assertSafeUrl } from "@/lib/url-guard";

/** 单张图的可消费形态：data URL 或 http(s) 外链 */
export interface VisionImage {
  url: string;
}

/**
 * 已知【纯文本 / 无视觉】的模型关键词（保守 deny-list）。
 *
 * 与协议无关的第二道门：DeepSeek 走 openai 协议、model=deepseek-chat，协议门禁
 * 放得过，但其 chat API 根本不识别 image_url part —— 每次必失败，最终表现就是
 * 「校验器异常放行」的空转。这里提前拒绝并让调用方显式记录原因。
 * 未知模型仍放行（由调用方的「无法校验」诚实报告兜底）。
 */
const TEXT_ONLY_MODEL_KEYWORDS = [
  "deepseek", // deepseek-chat / deepseek-reasoner 均无视觉
  "gpt-3.5",
  "moonshot", // Kimi 文本档
  "text-embedding",
];

/**
 * 视觉能力探测：当前配置能否走带图对话。
 *
 * 与 `agents/vision-reviewer.supportsVisionReview` 的差别：那个函数服务于只实现了
 * OpenAI 端点的旧评审路径，因此把 claude / gemini 一律判为 false。本函数服务于
 * `visionChat` —— 三协议都真正实现了，所以只按「模型是否有视觉」判断。
 */
export function supportsVisionChat(config: AIServiceConfig): boolean {
  const model = (config.model || "").toLowerCase();
  // 模型名带明确视觉标记时优先放行，避免 deny-list 关键词误伤同厂多模态型号
  if (/vision|-vl\b|-vl-/.test(model)) return true;
  return !TEXT_ONLY_MODEL_KEYWORDS.some((kw) => model.includes(kw));
}

export interface VisionChatArgs {
  system: string;
  /** 用户侧文字 */
  text: string;
  /** 按序附加的图片（语义顺序由调用方的 prompt 约定，如「第一张是参考图」） */
  images: VisionImage[];
  config: AIServiceConfig;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** 拆解 data URL → { mime, base64 }；非 data URL 返回 null */
function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const m = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * 把图片统一取成 base64（Claude / Gemini 的内联格式要求）。
 * data URL 直接拆；http(s) 则先抓回来 —— 抓取前过 SSRF 闸门（图片 URL 可能来自
 * 用户上传/第三方回包，属「用户可影响的 URL」）。
 */
async function toInlineBase64(
  url: string,
  signal?: AbortSignal
): Promise<{ mime: string; base64: string }> {
  const direct = parseDataUrl(url);
  if (direct) return direct;

  await assertSafeUrl(url);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`视觉校验取图失败 HTTP ${res.status}`);
  }
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mime, base64: buffer.toString("base64") };
}

/**
 * 发一次带图的对话，返回模型的文字回复。
 * 三协议均支持；不支持的协议抛错（调用方降级并记录原因）。
 */
export async function visionChat(args: VisionChatArgs): Promise<string> {
  const protocol = args.config.protocol || "openai";
  switch (protocol) {
    case "claude":
      return claudeVisionChat(args);
    case "gemini":
      return geminiVisionChat(args);
    default:
      // openai / proxy-unified / grok / siliconflow 等 OpenAI 兼容端点
      return openaiVisionChat(args);
  }
}

/** OpenAI 兼容：content parts + image_url（data URL 与外链均可直传） */
async function openaiVisionChat(args: VisionChatArgs): Promise<string> {
  const baseUrl = trimUrl(args.config.baseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  // 视觉判别对细节识别要求高，未显式配置时默认 gpt-4o
  const model = args.config.model || "gpt-4o";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.config.apiKey}`,
    },
    signal: args.signal,
    body: JSON.stringify({
      model,
      temperature: args.temperature ?? 0,
      max_tokens: args.maxTokens ?? 600,
      messages: [
        { role: "system", content: args.system },
        {
          role: "user",
          content: [
            { type: "text", text: args.text },
            ...args.images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: img.url },
            })),
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`视觉校验 LLM HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Claude Messages API：image source 必须是 base64（不收外链 URL） */
async function claudeVisionChat(args: VisionChatArgs): Promise<string> {
  const baseUrl =
    trimUrl(args.config.baseUrl) || "https://api.anthropic.com/v1";
  const model = args.config.model || "claude-sonnet-5";

  const inlined = await Promise.all(
    args.images.map((img) => toInlineBase64(img.url, args.signal))
  );

  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: args.signal,
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? 600,
      temperature: args.temperature ?? 0,
      system: args.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: args.text },
            ...inlined.map((i) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: i.mime,
                data: i.base64,
              },
            })),
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`视觉校验 Claude HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  return data.content?.[0]?.text ?? "";
}

/** Gemini generateContent：parts 内联 inline_data（base64） */
async function geminiVisionChat(args: VisionChatArgs): Promise<string> {
  const baseUrl =
    trimUrl(args.config.baseUrl) ||
    "https://generativelanguage.googleapis.com/v1beta";
  const model = args.config.model || "gemini-2.5-flash";
  const url = `${baseUrl}/models/${model}:generateContent?key=${args.config.apiKey}`;

  const inlined = await Promise.all(
    args.images.map((img) => toInlineBase64(img.url, args.signal))
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      generationConfig: {
        temperature: args.temperature ?? 0,
        maxOutputTokens: args.maxTokens ?? 600,
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: args.text },
            ...inlined.map((i) => ({
              inline_data: { mime_type: i.mime, data: i.base64 },
            })),
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`视觉校验 Gemini HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
