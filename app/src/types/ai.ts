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
  /**
   * provider 特有的扩展配置：来自 UserAIConfig.extraConfig（jsonb）。
   * 承载各家非标准字段，如 GPT-SoVITS 的参考音频路径 refAudioPath / promptText 等。
   * 仅收窄为字符串键值对（非字符串值在装配层被过滤）。
   */
  extraConfig?: Record<string, string>;
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
  /** 单次生成超时（毫秒）；缺省用 facade 层默认（3 分钟） */
  timeoutMs?: number;
}

/** 视频生成选项 */
export interface VideoGenerationOptions {
  imageUrl: string;
  prompt?: string;
  /**
   * 请求时长（秒）。语义：调用方期望的单段时长。
   * - 接受 duration 参数的 provider（runway/fal/proxy-unified）会在内部就近吸附
   *   到自家档位（5/10/15），保证下发给上游 API 的是合法值。
   * - 忽略 duration 的 provider（flow2api/Veo）透传忽略。
   * 分段生成（segmented-video）会为每段传入已规划好的档位或 undefined。
   */
  duration?: number;
  /** 画幅；与图像端一致，便于 i2v provider 路由（flow2api/Veo 横/竖屏）。 */
  aspectRatio?: "1:1" | "9:16" | "16:9";
  /** 参考图 URL 列表（R2V 多参考图语义；目前 flow2api-video 使用） */
  referenceImages?: string[];
  /**
   * 尾帧图 URL（首尾帧衔接）：与 imageUrl（首帧）配对时 provider 路由到
   * FL（首尾帧插值）模型；通常传下一分镜的图片，实现相邻镜头无缝衔接。
   * 与 referenceImages 互斥消费：有尾帧时角色参考图不再混入图片输入。
   */
  lastFrameImage?: string;
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
  /**
   * 情绪（批3 引入）：项目内部情绪枚举
   * neutral|happy|sad|angry|surprised|fear。provider 各自映射到自家情绪能力
   * （火山 emotion 参数 / ElevenLabs voice_settings）；neutral/未知/缺省不做调整。
   */
  emotion?: string;
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
  | "elevenlabs"
  | "gpt-sovits";
