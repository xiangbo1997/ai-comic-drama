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
  config?: AIServiceConfig;
}

/** 视频生成选项 */
export interface VideoGenerationOptions {
  imageUrl: string;
  prompt?: string;
  duration?: 5 | 10;
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
