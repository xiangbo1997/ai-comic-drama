import { Cpu, Image, Video, Volume2 } from "lucide-react";

export type AICategory = "LLM" | "IMAGE" | "VIDEO" | "TTS";

export interface APIProtocol {
  id: string;
  name: string;
  description: string;
  authHeader: string;
  defaultBaseUrl?: string;
  endpoints: {
    LLM: {
      main: string;
      list?: string;
    };
    IMAGE: {
      main: string;
      list?: string;
    };
    VIDEO: {
      main: string;
      list?: string;
    };
    TTS: {
      main: string;
      list?: string;
    };
  };
}

export const API_PROTOCOLS: APIProtocol[] = [
  {
    id: "proxy-unified",
    name: "通用中转 (统一端点)",
    description: "适用于通过 /chat/completions 统一处理所有请求的中转站",
    authHeader: "Bearer",
    defaultBaseUrl: "",
    endpoints: {
      LLM: { main: "/chat/completions", list: "/models" },
      IMAGE: { main: "/chat/completions" },
      VIDEO: { main: "/chat/completions" },
      TTS: { main: "/chat/completions" },
    },
  },
  {
    id: "openai",
    name: "OpenAI 兼容",
    description: "OpenAI API 格式，适用于 OpenAI、DeepSeek、硅基流动、Ollama 等",
    authHeader: "Bearer",
    defaultBaseUrl: "https://api.openai.com/v1",
    endpoints: {
      LLM: { main: "/chat/completions", list: "/models" },
      IMAGE: { main: "/images/generations" },
      VIDEO: { main: "/videos/generations" },
      TTS: { main: "/audio/speech" },
    },
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    description: "Anthropic Claude API 格式",
    authHeader: "x-api-key",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    endpoints: {
      LLM: { main: "/messages", list: "" },
      IMAGE: { main: "" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    description: "Google Gemini API 格式",
    authHeader: "key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    endpoints: {
      LLM: { main: "/models/{model}:generateContent", list: "/models" },
      IMAGE: { main: "" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    description: "Microsoft Azure OpenAI 服务",
    authHeader: "api-key",
    endpoints: {
      LLM: { main: "/openai/deployments/{deployment}/chat/completions", list: "/openai/models" },
      IMAGE: { main: "/openai/deployments/{deployment}/images/generations" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
  {
    id: "cohere",
    name: "Cohere",
    description: "Cohere API 格式",
    authHeader: "Bearer",
    defaultBaseUrl: "https://api.cohere.ai/v1",
    endpoints: {
      LLM: { main: "/chat", list: "/models" },
      IMAGE: { main: "" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
  {
    id: "mistral",
    name: "Mistral AI",
    description: "Mistral AI API 格式（OpenAI 兼容）",
    authHeader: "Bearer",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    endpoints: {
      LLM: { main: "/chat/completions", list: "/models" },
      IMAGE: { main: "" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    description: "xAI Grok API，支持对话和图像生成",
    authHeader: "Bearer",
    defaultBaseUrl: "https://api.x.ai/v1",
    endpoints: {
      LLM: { main: "/chat/completions", list: "/models" },
      IMAGE: { main: "/images/generations" },
      VIDEO: { main: "" },
      TTS: { main: "" },
    },
  },
];

export function getProtocolsForCategory(category: AICategory): APIProtocol[] {
  return API_PROTOCOLS.filter(protocol => {
    const endpoint = protocol.endpoints[category]?.main;
    return endpoint && endpoint.length > 0;
  });
}

const PRIMARY_PROTOCOL_IDS: Record<AICategory, string[]> = {
  LLM: ["openai", "claude", "gemini"],
  IMAGE: ["openai", "grok"],
  VIDEO: ["openai"],
  TTS: ["openai"],
};

export function getPrimaryProtocolsForCategory(category: AICategory): APIProtocol[] {
  const available = getProtocolsForCategory(category);
  const primaryIds = new Set(PRIMARY_PROTOCOL_IDS[category] || []);
  const primary = available.filter((protocol) => primaryIds.has(protocol.id));
  return primary.length > 0 ? primary : available;
}

export function getAdvancedProtocolsForCategory(category: AICategory): APIProtocol[] {
  const available = getProtocolsForCategory(category);
  const primaryIds = new Set(getPrimaryProtocolsForCategory(category).map((protocol) => protocol.id));
  return available.filter((protocol) => !primaryIds.has(protocol.id));
}

export interface CustomModel {
  id: string;
  name: string;
  protocol?: string;
}

export interface AIModel {
  id: string;
  name: string;
  costPerUnit?: number;
  description?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  slug: string;
  category: "LLM" | "IMAGE" | "VIDEO" | "TTS";
  description: string | null;
  baseUrl: string | null;
  apiProtocol: string | null;
  models: AIModel[];
  configSchema: {
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
    }>;
  } | null;
  isCustom?: boolean;
  userId?: string | null;
}

export type AuthType = "API_KEY" | "CHATGPT_TOKEN" | "OAUTH";

export interface UserConfig {
  id: string;
  providerId: string;
  provider: AIProvider;
  selectedModel: string | null;
  customBaseUrl: string | null;
  apiProtocol: string | null;
  customModels: CustomModel[] | null;
  authType: AuthType;
  tokenExpiresAt: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  testStatus: "SUCCESS" | "FAILED" | "PENDING" | null;
  lastTestedAt: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

// 各供应商支持的认证方式
export const providerAuthMethods: Record<string, AuthType[]> = {
  openai: ["API_KEY", "CHATGPT_TOKEN"],
};

export const authTypeLabels: Record<AuthType, string> = {
  API_KEY: "API Key",
  CHATGPT_TOKEN: "ChatGPT 账号",
  OAUTH: "OAuth 认证",
};

export interface Preference {
  id: string;
  concurrencyMode: "SERIAL" | "PARALLEL";
  maxConcurrent: number;
}

export const categoryIcons = {
  LLM: Cpu,
  IMAGE: Image,
  VIDEO: Video,
  TTS: Volume2,
};

export const categoryLabels: Record<AICategory, string> = {
  LLM: "大语言模型",
  IMAGE: "图像生成",
  VIDEO: "视频生成",
  TTS: "语音合成",
};

export function normalizeBaseUrl(url: string): { normalized: string; warnings: string[] } {
  const warnings: string[] = [];
  let normalized = url.trim();

  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  const lowerUrl = normalized.toLowerCase();

  const versionPatterns = ["/v1", "/v2", "/v1beta", "/v1alpha"];
  for (const pattern of versionPatterns) {
    const regex = new RegExp(`(${pattern}).*${pattern}`, "i");
    if (regex.test(normalized)) {
      warnings.push(`URL 中包含重复的版本路径 "${pattern}"`);
    }
  }

  const endpointPatterns = [
    { pattern: "/chat/completions", name: "聊天接口" },
    { pattern: "/images/generations", name: "图像生成接口" },
    { pattern: "/videos/generations", name: "视频生成接口" },
    { pattern: "/audio/speech", name: "语音合成接口" },
    { pattern: "/completions", name: "补全接口" },
    { pattern: "/models", name: "模型列表接口" },
    { pattern: "/messages", name: "消息接口" },
    { pattern: "/embeddings", name: "嵌入接口" },
  ];
  for (const { pattern, name } of endpointPatterns) {
    if (lowerUrl.includes(pattern)) {
      warnings.push(`URL 不应包含 ${name} 路径 "${pattern}"，请只填写基础地址`);
    }
  }

  return { normalized, warnings };
}

export function generateUrlPreview(
  baseUrl: string,
  protocol: APIProtocol,
  category: AICategory,
  endpointType: "main" | "list" = "main"
): string {
  const { normalized } = normalizeBaseUrl(baseUrl);
  const path = protocol.endpoints[category]?.[endpointType];
  if (!path) return normalized;
  return `${normalized}${path}`;
}

export function getDefaultProtocolForProvider(slug: string): string {
  const protocolMap: Record<string, string> = {
    "openai": "openai",
    "deepseek": "openai",
    "silicon-flow": "openai",
    "openai-tts": "openai",
    "claude": "claude",
    "gemini": "gemini",
    "mistral": "openai",
    "cohere": "cohere",
  };
  return protocolMap[slug] || "openai";
}

export type ModelAvailability = "available" | "unavailable" | "unknown";

export type ModelCapability = "text" | "image" | "video" | "audio" | "multimodal";

export interface ModelWithAvailability {
  id: string;
  name: string;
  availability: ModelAvailability;
}

export function inferModelCapability(modelId: string): ModelCapability[] {
  const id = modelId.toLowerCase();

  const imageModels = [
    "dall-e", "gpt-image", "flux", "stable-diffusion", "sd-", "sdxl",
    "midjourney", "imagen", "kandinsky", "playground", "ideogram",
    "recraft", "kolors", "cogview", "wanx", "jimeng"
  ];
  if (imageModels.some(m => id.includes(m))) {
    return ["image"];
  }

  const videoModels = [
    "runway", "gen-3", "gen3", "pika", "kling", "luma", "dream-machine",
    "sora", "vidu", "cogvideo", "animate", "video"
  ];
  if (videoModels.some(m => id.includes(m))) {
    return ["video"];
  }

  const audioModels = [
    "tts", "whisper", "speech", "voice", "audio", "eleven", "fish-audio",
    "cosyvoice", "chattts"
  ];
  if (audioModels.some(m => id.includes(m))) {
    return ["audio"];
  }

  const multimodalModels = [
    "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "claude-3", "gemini",
    "qwen-vl", "qwen2-vl", "glm-4v", "yi-vision", "internvl",
    "llava", "cogvlm", "minicpm-v"
  ];
  if (multimodalModels.some(m => id.includes(m))) {
    return ["text", "multimodal"];
  }

  return ["text"];
}
