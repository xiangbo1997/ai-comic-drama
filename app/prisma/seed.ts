import { PrismaClient, AICategory } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

// 创建 Prisma 客户端（使用 pg adapter）
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// AI 服务提供商预置数据
const providers = [
  // ============ LLM ============
  {
    slug: "deepseek",
    name: "DeepSeek",
    category: AICategory.LLM,
    description: "高性价比中文大模型，适合剧本拆解",
    baseUrl: "https://api.deepseek.com",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", costPerUnit: 0.001 },
      { id: "deepseek-coder", name: "DeepSeek Coder", costPerUnit: 0.001 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 1,
  },
  {
    slug: "openai",
    name: "OpenAI",
    category: AICategory.LLM,
    description: "GPT 系列模型，全球领先",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o", costPerUnit: 0.005 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", costPerUnit: 0.0015 },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", costPerUnit: 0.01 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 2,
  },
  {
    slug: "gemini",
    name: "Google Gemini",
    category: AICategory.LLM,
    description: "Google 最新多模态模型，免费额度大",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", costPerUnit: 0.00125 },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", costPerUnit: 0.000075 },
      { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash (实验)", costPerUnit: 0 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 3,
  },
  {
    slug: "claude",
    name: "Anthropic Claude",
    category: AICategory.LLM,
    description: "Claude 系列，擅长长文本和复杂推理",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", costPerUnit: 0.003 },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", costPerUnit: 0.001 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 4,
  },

  // ============ IMAGE ============
  {
    slug: "openai-image",
    name: "OpenAI 图像",
    category: AICategory.IMAGE,
    description: "DALL-E 3 和 GPT Image 系列，高质量图像生成",
    baseUrl: "https://api.openai.com/v1",
    apiProtocol: "openai",
    models: [
      { id: "dall-e-3", name: "DALL-E 3", costPerUnit: 2, description: "最新版本，高质量" },
      { id: "dall-e-2", name: "DALL-E 2", costPerUnit: 1, description: "经典版本" },
      { id: "gpt-image-1", name: "GPT Image 1", costPerUnit: 3, description: "GPT 图像生成" },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 1,
  },
  {
    slug: "replicate",
    name: "Replicate",
    category: AICategory.IMAGE,
    description: "托管多种图像模型，包括 Flux 系列",
    baseUrl: "https://api.replicate.com/v1",
    models: [
      { id: "flux-schnell", name: "Flux Schnell", costPerUnit: 1, description: "快速生成" },
      { id: "flux-dev", name: "Flux Dev", costPerUnit: 2, description: "开发版本" },
      { id: "flux-pro", name: "Flux Pro", costPerUnit: 3, description: "专业版" },
      { id: "flux-kontext-pro", name: "Flux Kontext Pro", costPerUnit: 3, description: "角色一致性" },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Token", type: "password", required: true }],
    },
    sortOrder: 2,
  },
  {
    slug: "fal",
    name: "Fal.ai",
    category: AICategory.IMAGE,
    description: "快速图像生成平台",
    baseUrl: "https://fal.run",
    models: [
      { id: "flux-pro", name: "Flux Pro", costPerUnit: 2 },
      { id: "flux-dev", name: "Flux Dev", costPerUnit: 1 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 3,
  },
  {
    slug: "silicon-flow",
    name: "硅基流动",
    category: AICategory.IMAGE,
    description: "国内图像生成平台，价格实惠",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      { id: "flux-schnell", name: "Flux Schnell", costPerUnit: 0.5 },
      { id: "stable-diffusion-3", name: "SD 3", costPerUnit: 1 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 4,
  },

  // ============ VIDEO ============
  {
    slug: "runway",
    name: "Runway",
    category: AICategory.VIDEO,
    description: "Gen-3 Alpha，顶级图生视频效果",
    baseUrl: "https://api.dev.runwayml.com/v1",
    models: [
      { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo", costPerUnit: 10, description: "5秒视频" },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 1,
  },
  {
    slug: "luma",
    name: "Luma AI",
    category: AICategory.VIDEO,
    description: "Dream Machine，高质量视频生成",
    baseUrl: "https://api.lumalabs.ai",
    models: [
      { id: "dream-machine", name: "Dream Machine", costPerUnit: 8 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 2,
  },
  {
    slug: "kling",
    name: "可灵 Kling",
    category: AICategory.VIDEO,
    description: "快手可灵，国内顶级视频生成",
    baseUrl: "https://api.klingai.com",
    models: [
      { id: "kling-v1", name: "可灵 1.0", costPerUnit: 5 },
      { id: "kling-v1.5", name: "可灵 1.5", costPerUnit: 8 },
    ],
    configSchema: {
      fields: [
        { key: "accessKey", label: "Access Key", type: "password", required: true },
        { key: "secretKey", label: "Secret Key", type: "password", required: true },
      ],
    },
    sortOrder: 3,
  },
  {
    slug: "minimax",
    name: "MiniMax",
    category: AICategory.VIDEO,
    description: "MiniMax 视频生成，有免费额度",
    baseUrl: "https://api.minimax.chat",
    models: [
      { id: "video-01", name: "Video-01", costPerUnit: 5 },
    ],
    configSchema: {
      fields: [
        { key: "apiKey", label: "API Key", type: "password", required: true },
        { key: "groupId", label: "Group ID", type: "text", required: true },
      ],
    },
    sortOrder: 4,
  },

  // ============ TTS ============
  {
    slug: "volcengine",
    name: "火山引擎",
    category: AICategory.TTS,
    description: "字节跳动 TTS，中文效果好",
    baseUrl: "https://openspeech.bytedance.com",
    models: [
      { id: "zh_female_shuangkuaisisi_moon_bigtts", name: "中文女声-爽快思思", costPerUnit: 0.5 },
      { id: "zh_male_rap_moon_bigtts", name: "中文男声-说唱歌手", costPerUnit: 0.5 },
      { id: "zh_female_tianmeixiaoyuan_moon_bigtts", name: "中文女声-甜美小源", costPerUnit: 0.5 },
    ],
    configSchema: {
      fields: [
        { key: "appId", label: "App ID", type: "text", required: true },
        { key: "accessToken", label: "Access Token", type: "password", required: true },
      ],
    },
    sortOrder: 1,
  },
  {
    slug: "fish-audio",
    name: "Fish Audio",
    category: AICategory.TTS,
    description: "高质量中文 TTS，支持声音克隆",
    baseUrl: "https://api.fish.audio",
    models: [
      { id: "default", name: "默认音色", costPerUnit: 1 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 2,
  },
  {
    slug: "elevenlabs",
    name: "ElevenLabs",
    category: AICategory.TTS,
    description: "顶级英文 TTS，情感表达丰富",
    baseUrl: "https://api.elevenlabs.io/v1",
    models: [
      { id: "eleven_multilingual_v2", name: "Multilingual v2", costPerUnit: 2 },
      { id: "eleven_turbo_v2_5", name: "Turbo v2.5", costPerUnit: 1 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 3,
  },
  {
    slug: "openai-tts",
    name: "OpenAI TTS",
    category: AICategory.TTS,
    description: "OpenAI 语音合成",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "tts-1", name: "TTS-1", costPerUnit: 1 },
      { id: "tts-1-hd", name: "TTS-1 HD", costPerUnit: 2 },
    ],
    configSchema: {
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    },
    sortOrder: 4,
  },
];

// 预设角色标签
const defaultTags = [
  // 风格类
  { name: "动漫", category: "style", color: "#FF6B6B", order: 1 },
  { name: "真人", category: "style", color: "#4ECDC4", order: 2 },
  { name: "3D", category: "style", color: "#45B7D1", order: 3 },
  { name: "插画", category: "style", color: "#96CEB4", order: 4 },
  { name: "水墨", category: "style", color: "#2C3E50", order: 5 },
  // 性别类
  { name: "男", category: "gender", color: "#3498DB", order: 10 },
  { name: "女", category: "gender", color: "#E91E63", order: 11 },
  // 角色类型
  { name: "主角", category: "role", color: "#F39C12", order: 20 },
  { name: "配角", category: "role", color: "#9B59B6", order: 21 },
  { name: "反派", category: "role", color: "#E74C3C", order: 22 },
  // 其他
  { name: "古风", category: "other", color: "#8B4513", order: 30 },
  { name: "现代", category: "other", color: "#607D8B", order: 31 },
  { name: "科幻", category: "other", color: "#00BCD4", order: 32 },
  { name: "奇幻", category: "other", color: "#9C27B0", order: 33 },
];

async function main() {
  console.log("Seeding AI providers...");

  for (const provider of providers) {
    await prisma.aIProvider.upsert({
      where: { slug: provider.slug },
      update: {
        name: provider.name,
        category: provider.category,
        description: provider.description,
        baseUrl: provider.baseUrl,
        models: provider.models,
        configSchema: provider.configSchema,
        sortOrder: provider.sortOrder,
      },
      create: {
        slug: provider.slug,
        name: provider.name,
        category: provider.category,
        description: provider.description,
        baseUrl: provider.baseUrl,
        models: provider.models,
        configSchema: provider.configSchema,
        sortOrder: provider.sortOrder,
      },
    });
    console.log(`  ✓ ${provider.name}`);
  }

  console.log("\nSeeding character tags...");

  for (const tag of defaultTags) {
    await prisma.tag.upsert({
      where: {
        name_isSystem: {
          name: tag.name,
          isSystem: true,
        },
      },
      update: {
        category: tag.category,
        color: tag.color,
        order: tag.order,
      },
      create: {
        name: tag.name,
        category: tag.category,
        color: tag.color,
        order: tag.order,
        isSystem: true, // 系统预设标签
      },
    });
    console.log(`  ✓ ${tag.name}`);
  }

  console.log("\nSeeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
