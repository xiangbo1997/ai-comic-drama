/**
 * AI 服务相关类型定义
 */

/** 认证方式 */
export type AuthType = "API_KEY" | "CHATGPT_TOKEN" | "OAUTH";

/** AI 服务配置（用户的 provider 配置） */
export interface AIServiceConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol: string;
  authType?: AuthType;
}

/** LLM 消息 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** LLM 调用选项 */
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  config?: AIServiceConfig;
  /**
   * 单次调用超时（毫秒）。Hotfix2 引入：
   * 上游 LLM 中转站偶发卡住到 100+ 秒会导致 Cloudflare 524。
   * 在 chatCompletion facade 层用 Promise.race 实现，对所有 provider 通用。
   * 超时不会取消底层 fetch（无法跨 provider 注入 signal），但能让上层快速进入重试。
   */
  timeoutMs?: number;
}

/** 图像生成选项 */
export interface ImageGenerationOptions {
  prompt: string;
  /** 单张参考图（向后兼容；若提供 referenceImages 则优先用后者） */
  referenceImage?: string;
  /** 多张参考图（Stage 1.4 引入，用于 IP-Adapter 类多 reference 场景） */
  referenceImages?: string[];
  /** 负向提示词（Stage 1.4 引入；provider 能支持则传递，否则降级拼到 prompt 中） */
  negativePrompt?: string;
  aspectRatio?: "1:1" | "9:16" | "16:9";
  style?: string;
  /**
   * 随机种子；同一角色跨镜头复用同一 seed，可显著提升外貌一致性。
   * provider 不支持时会被透传忽略（OpenAI DALL-E 等），不影响功能。
   */
  seed?: number;
  config?: AIServiceConfig;
}

/** 视频生成选项 */
export interface VideoGenerationOptions {
  imageUrl: string;
  prompt?: string;
  duration?: 5 | 10;
  /** 画幅；与图像端一致，便于 i2v provider 路由（flow2api/Veo 横/竖屏）。 */
  aspectRatio?: "1:1" | "9:16" | "16:9";
  /** 参考图 URL 列表（首尾帧 / R2V 多参考图；目前 flow2api-video 使用） */
  referenceImages?: string[];
  /**
   * 随机种子（v2 引入）；与图像端共用同一 identitySeed = FNV-1a(characterId)。
   * provider 不支持时透传忽略；目前 flow2api-video 在 message 元数据中携带。
   */
  seed?: number;
  /**
   * 身份维持前缀（v2 引入）：从 CharacterBible.canonicalPrompt 截取的核心外貌片段（≤200 字符）。
   * Provider 在拼最终 prompt 时会前置注入，强制视频模型遵循角色 DNA。
   * 与 image 端 openai-compatible.ts 的 FACE_ANCHOR_SUFFIX 互补：图像锁脸，视频锁身份。
   */
  identityPrompt?: string;
  /** 生成超时（毫秒）；默认 5 分钟，防止上游 API 卡死导致请求无限挂起。 */
  timeoutMs?: number;
  config?: AIServiceConfig;
}

/** TTS 合成选项 */
export interface TTSOptions {
  text: string;
  voiceId?: string;
  speed?: number;
  config?: AIServiceConfig;
}

/** AI 服务类别 — 与 Prisma enum AICategory 对齐 */
export type AICategory = "LLM" | "IMAGE" | "VIDEO" | "TTS";

/** AI Provider 协议类型 */
export type AIProviderProtocol =
  | "openai"
  | "claude"
  | "gemini"
  | "grok"
  | "replicate"
  | "fal"
  | "siliconflow"
  | "proxy-unified"
  | "volcengine"
  | "elevenlabs";
