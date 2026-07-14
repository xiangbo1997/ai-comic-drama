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

import { readFile, stat } from "fs/promises";
import path from "path";
import type { AIServiceConfig } from "@/types";
import type { ObserverVerdict } from "./types";
import type {
  ContinuityPairIssue,
  ContinuityDimension,
  ContinuitySeverity,
} from "@/services/continuity-check";
import {
  OBSERVER_SYSTEM,
  buildImageReviewPrompt,
} from "@/lib/prompts/agent-prompts";

// 本地存储约定（与 services/storage.ts / uploads/[...path] 路由同源）
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || "public/uploads";
const LOCAL_STORAGE_URL_PREFIX =
  process.env.LOCAL_STORAGE_URL_PREFIX || "/uploads";

/** 内联为 data URL 的单图上限（超过则跳过该对，不塞超大 payload） */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

/**
 * 把一张分镜图 URL 解析成 VLM 可直接消费的形式：
 * - http(s)://：外部可达，原样返回；
 * - 以 / 开头的相对路径（本地存储降级模式下 Scene.imageUrl 形如 /uploads/...）：
 *   外部 VLM 够不到，读磁盘内联成 base64 data URL（OpenAI 兼容多模态 image_url 接受
 *   data: URL）；文件不存在 / 超过 4MB / 非图片扩展名 → 返回 null（该对跳过，不发垃圾）。
 * - 其他（无法识别）→ null。
 *
 * 导出供单测覆盖（http 透传 / 缺失文件 / 超限）。
 */
export async function resolveImageUrlForVision(
  url: string
): Promise<string | null> {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("data:")) return url;
  if (!url.startsWith("/")) return null;

  // 仅接受本地存储前缀（/uploads/...）；其余相对路径不猜测
  if (!url.startsWith(LOCAL_STORAGE_URL_PREFIX)) return null;
  const relative = url
    .slice(LOCAL_STORAGE_URL_PREFIX.length)
    .replace(/^\/+/, "");

  const baseDir = path.resolve(process.cwd(), LOCAL_STORAGE_DIR);
  const target = path.resolve(baseDir, relative);
  // 路径穿越防护：解析后必须仍在存储根内
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return null;

  const mime = MIME_BY_EXT[path.extname(target).toLowerCase()];
  if (!mime) return null; // 非图片扩展名不内联

  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_INLINE_IMAGE_BYTES) return null;
    const buffer = await readFile(target);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    // 文件缺失 / 读失败 → 跳过该对（返回 null，由调用方记 skipped）
    return null;
  }
}

export interface VisionReviewArgs {
  imageUrl: string;
  sceneDescription: string;
  characterDescriptions: string;
  expectedEmotion: string;
  expectedShotType: string;
  /** 全片统一主色板（来自圣经 colorScript）；有值时评「色调一致性」维度 */
  expectedPalette?: string;
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
    expectedPalette,
    llmConfig,
  } = args;

  // 协议守卫：本评审走 OpenAI chat completions 多模态格式（content parts +
  // image_url）。claude / gemini 协议的端点格式不同，拼 /chat/completions 会
  // 失败。与其发一个注定 404 的请求再降级（日志只剩无意义的 HTTP 4xx），不如
  // 在入口诚实抛出明确原因，由调用方（observer-agent）降级到纯文本预评审。
  const protocol = llmConfig.protocol || "openai";
  if (protocol === "claude" || protocol === "gemini") {
    throw new Error(
      `视觉评审暂不支持 ${protocol} 协议（需 OpenAI 兼容的多模态端点），降级纯文本评审`
    );
  }

  const baseUrl = llmConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  // 视觉一致性评审对模型视觉能力要求高，gpt-4o-mini 细节识别偏弱，
  // 默认升级到 gpt-4o（用户可在 config.model 显式覆盖）。
  const model = llmConfig.model || "gpt-4o";

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
              expectedShotType,
              expectedPalette
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

/**
 * 已知【纯文本 / 无视觉】的模型关键词（保守 deny-list）。
 *
 * 背景（假绿 A 根因之一）：DeepSeek 走 openai 协议、model=deepseek-chat，能通过
 * 「协议非 claude/gemini」的粗门禁，但其 chat API 根本不识别 image_url part——
 * 每对比对必然失败被记为 skipped，最终 0 问题被 computeGrade 误判为 A。
 * 这里对已确证无视觉的模型直接拒绝；未知的 openai 协议模型仍放行（由「诚实报告」
 * 兜底：全跳过时 grade=null，不会伪装成通过）。
 *
 * 说明：gpt-4o / gpt-4.1 等虽含 "gpt-4" 也是多模态，不在此列；只列确证无视觉的。
 */
const TEXT_ONLY_MODEL_KEYWORDS = [
  "deepseek", // deepseek-chat / deepseek-reasoner 均无视觉
  "gpt-3.5", // 无视觉
  "moonshot", // Kimi 文本档
  "text-embedding", // 嵌入模型（防误配）
];

/**
 * 视觉评审能力探测：当前 LLM 配置是否支持 OpenAI 兼容多模态端点。
 * 与 reviewImageWithVision / compareImagePairWithVision 的协议守卫同源
 * （claude / gemini 不支持），并额外用 deny-list 拒绝已知纯文本模型（DeepSeek 等）。
 * 路由用它在建任务前做硬门禁（不出假报告）。
 */
export function supportsVisionReview(config: AIServiceConfig): boolean {
  const protocol = config.protocol || "openai";
  if (protocol === "claude" || protocol === "gemini") return false;

  // 模型名带明确视觉标记（vision / -vl）时优先放行——避免 deny-list 关键词误伤
  // 同厂多模态型号（如 moonshot-v1-8k-vision-preview、deepseek-vl 走中转站的情形）。
  const model = (config.model || "").toLowerCase();
  if (/vision|-vl\b|-vl-/.test(model)) return true;

  // 已确证无视觉的模型直接拒绝（保守 deny-list；未知模型放行 + 诚实报告兜底）
  if (TEXT_ONLY_MODEL_KEYWORDS.some((kw) => model.includes(kw))) return false;

  return true;
}

// ============ 场记：相邻镜连贯性对比（计划 §5 · 2.3）============

/** 相邻镜对比的紧凑上下文（前镜/后镜的锚定信息，供 VLM 判断哪些维度算问题） */
export interface ComparePairArgs {
  prevImageUrl: string;
  nextImageUrl: string;
  prevOrder: number;
  nextOrder: number;
  /** 前镜地点标签（与后镜相同才把「环境背景」跳变算问题） */
  prevLocationKey?: string | null;
  nextLocationKey?: string | null;
  /** 两镜共同出场角色名（服装/发型维度的对齐对象） */
  characterNames?: string[];
  /** 期望色板（来自系列圣经 colorScript / 画风基线），有值时评「色调」维度 */
  expectedPalette?: string;
  llmConfig: AIServiceConfig;
}

const CONTINUITY_SYSTEM =
  "你是专业的漫剧「场记 / 连续性检查员」，负责比对相邻两个镜头的画面是否存在连贯性跳变。" +
  "仅在以下 5 个维度检查：角色服装、发型、环境背景、光线、色调。" +
  "重要规则：\n" +
  "1. 「环境背景」维度——仅当两镜标注为【同一地点】时，背景不一致才算问题；异地点属正常切换，不报。\n" +
  "2. 「色调」维度——对照给定的期望色板判断整体色调是否偏离；未给期望色板时按两镜相互一致性判断。\n" +
  "3. 服装/发型——仅比对同一角色跨镜是否一致。\n" +
  "只输出通过检查【发现问题】的维度，连贯的维度不要输出（精简）。无任何问题时输出空数组。\n" +
  "严格只输出如下 JSON（不要任何解释或 markdown 代码块标记）：\n" +
  '{"issues":[{"dimension":"角色服装","severity":"严重","description":"问题描述≤60字","fixNote":"可直接喂给重生成的中文修复指令≤40字"}]}\n' +
  "dimension 只能取：角色服装 / 发型 / 环境背景 / 光线 / 色调；severity 只能取：严重 / 中等 / 轻微。";

/** 构建相邻镜对比的用户 prompt（紧凑上下文 + 两图前后顺序说明） */
function buildComparePrompt(args: ComparePairArgs): string {
  const sameLocation =
    Boolean(args.prevLocationKey) &&
    Boolean(args.nextLocationKey) &&
    args.prevLocationKey === args.nextLocationKey;

  const chars =
    args.characterNames && args.characterNames.length > 0
      ? args.characterNames.join("、")
      : "未标注";

  const locationLine = sameLocation
    ? `两镜为【同一地点】（${args.prevLocationKey}）——请检查环境背景是否一致。`
    : "两镜地点不同或未标注——不要把背景差异算作问题。";

  const paletteLine = args.expectedPalette
    ? `期望色板（全片统一）：${args.expectedPalette}`
    : "无指定色板——按两镜相互一致性评色调。";

  return [
    `以下是相邻的两个镜头画面：第一张为【前镜（镜${args.prevOrder}）】，第二张为【后镜（镜${args.nextOrder}）】。`,
    `出场角色：${chars}`,
    locationLine,
    paletteLine,
    "请比对两镜在 角色服装 / 发型 / 环境背景 / 光线 / 色调 上是否有跳变，按系统要求只输出发现问题的维度（JSON）。",
  ].join("\n");
}

/**
 * 用多模态模型对比【相邻两镜】的连贯性，返回问题清单。
 *
 * 与 reviewImageWithVision 同端点/同协议/同降级形态，区别是 content 携带【两张】image_url。
 * 降级契约（与 reviewImageWithVision 一致但更宽松——不阻塞体检整体）：
 * claude/gemini 协议、HTTP 失败、解析失败一律返回 null（由调用方记为「跳过」，不抛错）。
 */
export async function compareImagePairWithVision(
  args: ComparePairArgs
): Promise<ContinuityPairIssue[] | null> {
  const { llmConfig } = args;

  // 协议守卫：仅 OpenAI 兼容多模态端点支持 content parts + image_url。
  const protocol = llmConfig.protocol || "openai";
  if (protocol === "claude" || protocol === "gemini") {
    return null;
  }

  // 本地存储降级模式下 imageUrl 是 /uploads/... 相对路径，外部 VLM 够不到——
  // 读盘内联成 data URL。任一图无法解析（缺失/超限/非图片）→ 跳过该对（返回 null）。
  const [prevUrl, nextUrl] = await Promise.all([
    resolveImageUrlForVision(args.prevImageUrl),
    resolveImageUrlForVision(args.nextImageUrl),
  ]);
  if (!prevUrl || !nextUrl) return null;

  const baseUrl = llmConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = llmConfig.model || "gpt-4o";

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1024,
    messages: [
      { role: "system", content: CONTINUITY_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: buildComparePrompt(args) },
          { type: "image_url", image_url: { url: prevUrl } },
          { type: "image_url", image_url: { url: nextUrl } },
        ],
      },
    ],
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return parsePairIssues(text);
  } catch {
    // 网络 / 解析等任何异常一律降级为「跳过」，绝不阻塞整体体检
    return null;
  }
}

const VALID_DIMENSIONS: ReadonlySet<string> = new Set<ContinuityDimension>([
  "角色服装",
  "发型",
  "环境背景",
  "光线",
  "色调",
]);
const VALID_SEVERITIES: ReadonlySet<string> = new Set<ContinuitySeverity>([
  "严重",
  "中等",
  "轻微",
]);

function clampText(text: unknown, max: number): string {
  const t = typeof text === "string" ? text.trim() : "";
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * 防御式解析 VLM 输出为问题清单。
 * - 找不到 JSON / 非法结构 → 返回 null（调用方记为跳过）。
 * - 空 issues 数组 → 返回 []（此对无问题，非跳过）。
 * - 单条 issue 维度/严重度非法 → 丢弃该条（不整体失败）。
 *
 * 导出供单测覆盖（valid / malformed / empty）。
 */
export function parsePairIssues(text: string): ContinuityPairIssue[] | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch
    ? codeBlockMatch[1].trim()
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const rawIssues = (parsed as { issues?: unknown }).issues;
  if (!Array.isArray(rawIssues)) return null;

  const issues: ContinuityPairIssue[] = [];
  for (const item of rawIssues) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const dimension = record.dimension;
    const severity = record.severity;
    if (typeof dimension !== "string" || !VALID_DIMENSIONS.has(dimension)) {
      continue;
    }
    if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity)) {
      continue;
    }
    const description = clampText(record.description, 60);
    const fixNote = clampText(record.fixNote, 40);
    if (!description || !fixNote) continue;

    issues.push({
      dimension: dimension as ContinuityDimension,
      severity: severity as ContinuitySeverity,
      description,
      fixNote,
    });
  }
  return issues;
}
