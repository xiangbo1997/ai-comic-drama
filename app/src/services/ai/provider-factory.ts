/**
 * Provider Factory
 * 根据 protocol 字段路由到对应 Provider，不再依赖 baseUrl 猜测
 */

import type {
  LLMProvider,
  ImageProvider,
  VideoProvider,
  TTSProvider,
  ImageProviderCapability,
} from "./types";

// LLM providers
import { openaiCompatibleLLM } from "./providers/openai-compatible";
import { claudeLLM } from "./providers/claude";
import { geminiLLM } from "./providers/gemini";

// Image providers
import { openaiCompatibleImage } from "./providers/openai-compatible";
import { grokImage } from "./providers/grok";
import { siliconflowImage } from "./providers/siliconflow";
import { falImage } from "./providers/fal";
import { replicateImage } from "./providers/replicate";
import { proxyUnifiedImage } from "./providers/proxy-unified";
import { flow2apiImage } from "./providers/flow2api-image";

// Video providers
import { runwayVideo } from "./providers/runway";
import { falVideo } from "./providers/fal";
import { proxyUnifiedVideo } from "./providers/proxy-unified";
import { flow2apiVideo } from "./providers/flow2api-video";

// TTS providers
import { volcengineTTS } from "./providers/tts/volcengine";
import { elevenlabsTTS } from "./providers/tts/elevenlabs";
import { openaiCompatibleTTS } from "./providers/tts/openai-compatible";
import { gptSovitsTTS } from "./providers/tts/gpt-sovits";

/** 图像 Provider 能力表 */
const IMAGE_PROVIDER_CAPABILITIES: Record<string, ImageProviderCapability> = {
  replicate: {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  fal: {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  // grok（grok2api 网关）：图片编辑走**非 OpenAI 标准**的 JSON 协议
  // （`POST /images/edits` + `images:[{url}]`，网关硬校验 1–8 张），已由
  // providers/grok.ts 实现。带参考图时该 provider 会自动把生成模型映射到
  // 上游的编辑模型（见 grok.ts 的 EDIT_MODEL_MAP），故此处声明支持参考图。
  grok: {
    supportsReferenceImage: true,
    supportsMultipleReferences: true,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 8,
  },
  siliconflow: {
    supportsReferenceImage: false,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 0,
  },
  openai: {
    supportsReferenceImage: true,
    supportsMultipleReferences: true,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 4,
  },
  "proxy-unified": {
    supportsReferenceImage: true,
    supportsMultipleReferences: false,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 1,
  },
  // flow2api（Imagen/Gemini Image）：图生图走 image_url parts，
  // 上游协议当前最多接受 3 张参考图
  flow2api: {
    supportsReferenceImage: true,
    supportsMultipleReferences: true,
    supportsFaceId: false,
    supportsInpainting: false,
    maxReferenceImages: 3,
  },
};

const DEFAULT_CAPABILITY: ImageProviderCapability = {
  supportsReferenceImage: false,
  supportsMultipleReferences: false,
  supportsFaceId: false,
  supportsInpainting: false,
  maxReferenceImages: 0,
};

/**
 * 按【模型名】的能力覆盖表——单一真源，接新网关只改这一处。
 *
 * 为什么需要：`apiProtocol` 同时承担两个职责——① 路由到哪个 Provider 实现、
 * ② 查该通道的参考图能力。当用户用「OpenAI 兼容网关」代理一个非 OpenAI 的
 * 底层模型时（例如 grok2api / 各类中转站把 grok-imagine 包成 /v1/images 接口），
 * protocol 必须填 `openai` 才能路由正确，于此同时能力表就会错判成
 * 「支持 4 张参考图」。结果：系统把角色三视图全部递过去，底层模型根本不吃
 * 参考图、静默忽略，每张分镜都退化成纯文生图 → 人物必然不一致，而日志还记
 * 着 hasReference: true，排查时完全看不出来。
 *
 * 因此在 protocol 表之上叠一层按模型名的覆盖：protocol 继续管路由，模型名
 * 管能力。匹配规则为「模型名（小写）命中 match 正则」，无匹配时回落
 * protocol 表（向后兼容，零回归）。
 *
 * 补充（2026-09-10）：覆盖项可再用 `protocols` 限定生效范围。因为真实能力是
 * 「模型 × provider 实现」的组合——同一个 grok 模型走专用 grok provider 能吃
 * 参考图，走 OpenAI 兼容通道则不能（协议不兼容）。详见各条目的 protocols 注释。
 */
const MODEL_CAPABILITY_OVERRIDES: ReadonlyArray<{
  /** 模型名匹配规则（对小写后的模型名做 test） */
  match: RegExp;
  /**
   * 仅在这些 protocol 下生效；缺省表示对所有 protocol 生效。
   *
   * 为什么需要按 protocol 区分（2026-09-10）：同一个模型名的参考图能力，
   * 取决于**由哪个 provider 实现去发请求**。`grok-imagine-image` 经
   * `protocol: "grok"` 走 providers/grok.ts 时能用上 grok2api 的 JSON 编辑协议；
   * 而经 `protocol: "openai"` 走 openai-compatible 时发的是 OpenAI 标准
   * multipart，被 grok2api 以 HTTP 415「图片编辑仅支持 application/json」拒收，
   * 参考图依然无效。所以能力判定必须同时看 protocol 与 model。
   */
  protocols?: ReadonlyArray<string>;
  /** 覆盖项：仅覆盖声明的字段，其余沿用 protocol 表 */
  capability: Partial<ImageProviderCapability>;
  /** 为什么覆盖（供日志与用户告知） */
  reason: string;
}> = [
  {
    // grok 图像系列经「OpenAI 兼容通道」代理时不支持参考图。
    //
    // 用正则而非精确相等：网关给的模型名常带前后缀与版本号（用户库里实际是
    // `grok-imagine-image`）。规则 = 名字里同时出现 grok 和 image/imagine，
    // 这样 grok-2-image / grok-imagine-image / 未来的 grok-5-image 都能兜住，
    // 不必逐个版本号维护清单。
    //
    // 限定 protocols=["openai"]：openai-compatible 对有参考图的请求发的是
    // OpenAI 标准 multipart，grok2api 实测以 HTTP 415 拒收（「图片编辑仅支持
    // application/json」）。要让 grok 吃到参考图，必须把 protocol 配成 `grok`
    // 走 providers/grok.ts 的专用 JSON 协议。
    match: /grok.*(image|imagine)/,
    protocols: ["openai"],
    capability: {
      supportsReferenceImage: false,
      supportsMultipleReferences: false,
      maxReferenceImages: 0,
    },
    reason:
      "grok 图像模型经 OpenAI 兼容通道代理时不支持参考图（该通道发 multipart，" +
      "grok2api 只接受 JSON 编辑协议）；请把服务商协议改为「grok」以启用参考图",
  },
  {
    // protocol=grok 但模型是**旧的 grok-2 图像系列**：上游没有对应的
    // `-edit` 编辑模型（grok2api 的编辑能力只存在于 grok-imagine 系列），
    // providers/grok.ts 的 resolveGrokEditModel 对它返回 null，参考图用不上。
    // 这里同步下调能力，保证批 1 的防呆告知链对这类配置依然生效。
    match: /^(?!.*imagine).*grok.*image/,
    protocols: ["grok"],
    capability: {
      supportsReferenceImage: false,
      supportsMultipleReferences: false,
      maxReferenceImages: 0,
    },
    reason:
      "该 grok 图像模型在上游没有对应的编辑模型（仅 grok-imagine 系列支持图片编辑），" +
      "无法使用参考图；建议改用 grok-imagine-image 系列模型",
  },
];

/** 命中的模型覆盖项；未命中返回 undefined */
function findModelOverride(
  protocol: string,
  model: string | undefined
): (typeof MODEL_CAPABILITY_OVERRIDES)[number] | undefined {
  const name = model?.trim().toLowerCase();
  if (!name) return undefined;
  return MODEL_CAPABILITY_OVERRIDES.find(
    (o) =>
      o.match.test(name) && (!o.protocols || o.protocols.includes(protocol))
  );
}

/**
 * 获取图像 Provider 能力。
 *
 * @param protocol 路由协议（决定 Provider 实现与基础能力）
 * @param model 选中的模型名；传入时叠加 MODEL_CAPABILITY_OVERRIDES
 *              （网关代理导致协议与能力解耦，见该表注释）。缺省时行为与旧版一致。
 */
export function getImageProviderCapability(
  protocol: string,
  model?: string
): ImageProviderCapability {
  const base = IMAGE_PROVIDER_CAPABILITIES[protocol] ?? DEFAULT_CAPABILITY;
  const override = findModelOverride(protocol, model);
  if (!override) return base;
  return { ...base, ...override.capability };
}

/**
 * 能力被模型覆盖表下调时的中文说明（无覆盖返回 null）。
 * 供上游把「参考图不被支持」这件事显式告知用户，而不是静默丢弃参考图。
 */
export function describeImageCapabilityOverride(
  protocol: string,
  model?: string
): string | null {
  const override = findModelOverride(protocol, model);
  if (!override) return null;
  const base = IMAGE_PROVIDER_CAPABILITIES[protocol] ?? DEFAULT_CAPABILITY;
  // 仅在「基础表认为支持、覆盖表判定不支持」时才有告知价值
  if (!base.supportsReferenceImage) return null;
  if (override.capability.supportsReferenceImage !== false) return null;
  return override.reason;
}

/** 获取 LLM Provider */
export function getLLMProvider(protocol: string): LLMProvider {
  switch (protocol) {
    case "claude":
      return claudeLLM;
    case "gemini":
      return geminiLLM;
    default:
      // openai, grok, deepseek 等 OpenAI 兼容协议
      return openaiCompatibleLLM;
  }
}

/** 获取图像生成 Provider */
export function getImageProvider(
  protocol: string,
  baseUrl?: string
): ImageProvider {
  switch (protocol) {
    case "proxy-unified":
      return proxyUnifiedImage;
    case "flow2api":
      return flow2apiImage;
    case "grok":
      return grokImage;
    case "siliconflow":
      return siliconflowImage;
    case "fal":
      return falImage;
    case "replicate":
      return replicateImage;
    case "openai":
      return openaiCompatibleImage;
    default:
      break;
  }

  // 无明确协议时，根据 baseUrl 推断（兼容旧配置）
  if (baseUrl) {
    if (baseUrl.includes("x.ai")) return grokImage;
    if (baseUrl.includes("siliconflow")) return siliconflowImage;
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai"))
      return falImage;
    if (baseUrl.includes("replicate") || !baseUrl) return replicateImage;
  }

  // 最终 fallback
  return openaiCompatibleImage;
}

/**
 * 未接入的视频服务商 protocol → 中文提示。
 * 这些协议此前落到 default 分支静默返回 runwayVideo，用户配好可灵 AK/SK
 * 却被打到 Runway 报 401，误以为是密钥问题。改为显式抛错定位到「未接入」。
 */
const UNIMPLEMENTED_VIDEO_PROTOCOLS: Record<string, string> = {
  kling: "可灵",
  minimax: "MiniMax",
  luma: "Luma",
};

/** 获取视频生成 Provider */
export function getVideoProvider(
  protocol: string,
  baseUrl?: string
): VideoProvider {
  switch (protocol) {
    case "runway":
      return runwayVideo;
    case "fal":
      return falVideo;
    case "flow2api":
      return flow2apiVideo;
    case "proxy-unified":
    case "openai":
      return proxyUnifiedVideo;
    default:
      break;
  }

  // 已知但未接入的服务商：显式报错，别静默兜底到 Runway 造成误导
  const unimplemented = UNIMPLEMENTED_VIDEO_PROTOCOLS[protocol];
  if (unimplemented) {
    throw new Error(
      `该服务商（${unimplemented}）暂未接入，请在 AI 模型设置选择其他服务商`
    );
  }

  // 兼容旧配置：仅对未显式声明 protocol 的历史配置按 baseUrl 推断
  if (baseUrl) {
    if (baseUrl.includes("runwayml")) return runwayVideo;
    if (baseUrl.includes("fal.run") || baseUrl.includes("fal.ai"))
      return falVideo;
  }

  // 未知协议不再静默兜底：显式暴露配置错误
  throw new Error(
    `未知的视频生成协议「${protocol}」，请在 AI 模型设置检查配置`
  );
}

/** 获取 TTS Provider */
export function getTTSProvider(
  protocol: string,
  baseUrl?: string
): TTSProvider {
  switch (protocol) {
    case "volcengine":
      return volcengineTTS;
    case "elevenlabs":
      return elevenlabsTTS;
    case "openai":
      return openaiCompatibleTTS;
    case "gpt-sovits":
      return gptSovitsTTS;
    // Fish Audio 已在 seed 预置但 provider 未接入：此前落到默认兜底
    // volcengineTTS，配好 Fish Audio Key 却打到火山导致鉴权失败误报。
    case "fish-audio":
      throw new Error(
        "该服务商（Fish Audio）暂未接入，请在 AI 模型设置选择其他服务商"
      );
    default:
      break;
  }

  // 兼容旧配置：仅对未显式声明 protocol 的历史配置按 baseUrl 推断
  if (baseUrl) {
    if (baseUrl.includes("bytedance") || baseUrl.includes("volcengine"))
      return volcengineTTS;
    if (baseUrl.includes("elevenlabs")) return elevenlabsTTS;
  }

  // 未知协议不再静默兜底到火山：显式暴露配置错误
  throw new Error(
    `未知的语音合成协议「${protocol}」，请在 AI 模型设置检查配置`
  );
}
