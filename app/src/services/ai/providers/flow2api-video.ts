/**
 * Flow2API Video Provider
 *
 * 适配 Google Labs Flow / Veo 视频生成网关。
 * 协议细节与公共逻辑（SSE 请求循环、URL 绝对化、错误映射）见 flow2api-shared.ts；
 * 最终视频结果在 stop 帧 content：```html\n<video src='https://...mp4' controls></video>\n```
 * 客户端必须 stream:true，否则 Cloudflare 100s 超时；总超时 1800s。
 *
 * 模型路由（基于输入图像数量与朝向）：
 * - T2V 横屏: veo_3_1_t2v_fast_landscape
 * - T2V 竖屏: veo_3_1_t2v_fast_portrait
 * - I2V 横屏 (1 张): veo_3_1_i2v_lite_landscape
 * - I2V 竖屏 (1 张): veo_3_1_i2v_lite_portrait
 * - I2V 首尾帧 (2 张): veo_3_1_i2v_s_fast_fl
 * - R2V 横屏 (1-3 张参考): veo_3_1_r2v_fast (无 _landscape 后缀)
 * - R2V 竖屏 (1-3 张参考): veo_3_1_r2v_fast_portrait
 *
 * 接口字段：VideoGenerationOptions 已扩展 aspectRatio / referenceImages /
 * lastFrameImage（尾帧衔接，命中 FL 路由）正式字段；
 * 仍保留对旧 `_referenceImages` 后门字段的兼容读取，方便灰度回滚。
 */

import type { VideoProvider } from "../types";
import type { VideoGenerationOptions, AIServiceConfig } from "@/types";
import { createLogger } from "@/lib/logger";
import {
  buildMultimodalContent,
  requestFlow2apiGeneration,
} from "./flow2api-shared";

const log = createLogger("services:ai:flow2api-video");

/**
 * 读取参考图与画幅。
 * 优先使用 VideoGenerationOptions 的正式字段（referenceImages / aspectRatio）；
 * 同时兼容旧的 `_referenceImages` 后门字段，便于灰度回滚。
 */
function readExtra(options: VideoGenerationOptions): {
  referenceImages: string[];
  aspectRatio: "landscape" | "portrait";
} {
  const raw = options as unknown as Record<string, unknown>;

  // 1) 优先：正式字段 referenceImages
  const officialRefs = options.referenceImages;
  let referenceImages: string[] = Array.isArray(officialRefs)
    ? officialRefs.filter(
        (s): s is string => typeof s === "string" && s.length > 0
      )
    : [];

  // 2) 后备：旧后门字段 _referenceImages（兼容外部传入）
  if (referenceImages.length === 0) {
    const legacy = raw["_referenceImages"];
    if (Array.isArray(legacy)) {
      referenceImages = legacy.filter(
        (s): s is string => typeof s === "string" && s.length > 0
      );
    }
  }

  // 3) 画幅：先看正式字段，再看 raw（兼容字符串透传）
  const aspectCandidate =
    options.aspectRatio !== undefined
      ? options.aspectRatio
      : raw["aspectRatio"];
  // 9:16 / portrait / vertical 视为竖屏；其他默认横屏
  let aspectRatio: "landscape" | "portrait" = "landscape";
  if (typeof aspectCandidate === "string") {
    const v = aspectCandidate.toLowerCase();
    if (v === "9:16" || v === "portrait" || v === "vertical") {
      aspectRatio = "portrait";
    }
  }

  return { referenceImages, aspectRatio };
}

/** 根据输入选择 Veo 模型 ID；config.model 显式指定时优先使用 */
export function chooseModel(
  options: VideoGenerationOptions,
  config: AIServiceConfig
): string {
  if (config.model && config.model.trim()) {
    return config.model.trim();
  }

  const { referenceImages, aspectRatio } = readExtra(options);
  const hasMain = !!options.imageUrl;
  const refsCount = referenceImages.length;

  // 有分镜主图 + 显式尾帧（lastFrameImage，通常=下一分镜的图片）：
  // 路由 FL 首尾帧插值，做相邻镜头无缝衔接。语义由独立字段承载，
  // 不复用 referenceImages（角色参考），避免再次发生"参考图被当尾帧"。
  // 注意：网关 FL 模型 ID 无横竖屏后缀，竖屏项目同用此 ID。
  if (hasMain && options.lastFrameImage) {
    return "veo_3_1_i2v_s_fast_fl";
  }

  // 有分镜主图（无尾帧）：一律 I2V（把首帧动画化）。
  // 修复（2026-07-08）：此前 hasMain+refs==1 路由 FL 会把角色参考图当"尾帧"、
  // hasMain+refs>=2 漏进 T2V（不支持图片）。编辑器传的 referenceImages 是
  // 角色身份参考而非尾帧；Veo 没有"I2V+身份参考"组合，身份一致性由
  // identityPrompt 前缀承担。FL（首尾帧）在显式选择 FL 模型或传入
  // lastFrameImage 时生效。
  // 升级（2026-07-11）：从 i2v_lite 升到标准 i2v_s 档。lite 对首帧忠实度弱，
  // 运动幅度大时人物/场景易偏离分镜图（观感"没依据图"）；i2v_s 首帧还原度
  // 明显更高。两档均为 I2V（图进 image_url 作首帧），仅质量档位不同。
  if (hasMain) {
    return aspectRatio === "portrait"
      ? "veo_3_1_i2v_s_portrait"
      : "veo_3_1_i2v_s_landscape";
  }

  // 无主图、有参考图（R2V 多图参考）
  if (refsCount >= 1) {
    return aspectRatio === "portrait"
      ? "veo_3_1_r2v_fast_portrait"
      : "veo_3_1_r2v_fast";
  }

  // 纯文本（T2V Fast）
  return aspectRatio === "portrait"
    ? "veo_3_1_t2v_fast_portrait"
    : "veo_3_1_t2v_fast_landscape";
}

/**
 * 按最终模型的类别裁剪图片输入，保证送给上游的图片数量/语义合法：
 * - t2v：不接受图片，一张都不传
 * - fl / interpolation（首尾帧）：最多 2 张（1=首帧，2=首尾帧）
 * - r2v：参考图语义，上游最多 3 张
 * - 其他 i2v：只吃 1 张首帧
 * 模型可能来自用户显式配置，也可能来自自动路由——两条路都在此收口。
 */
export function planImageInputs(
  model: string,
  imageUrl: string | undefined,
  referenceImages: string[]
): string[] {
  const all = [...(imageUrl ? [imageUrl] : []), ...referenceImages];
  if (model.includes("_t2v_")) return [];
  if (
    model.endsWith("_fl") ||
    model.includes("_fl_") ||
    model.includes("interpolation")
  ) {
    return all.slice(0, 2);
  }
  if (model.includes("_r2v_")) return all.slice(0, 3);
  return all.slice(0, 1);
}

/** 从最终 content 中提取视频 URL */
function extractVideoUrl(content: string): string | null {
  const m = content.match(/<video[^>]+src=['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * v2：拼接最终视频 prompt：
 *   identityPrompt（角色 DNA 前缀，≤200 字）+ 用户/场景 prompt
 *
 * 设计：
 * - 仅在 identityPrompt 存在时前置；避免破坏老调用方
 * - 用 ". " 分隔，保证语义边界清晰
 * - 上游 Veo 模型对前置身份描述敏感，能显著提升角色一致性
 */
function buildVideoPrompt(prompt: string, identityPrompt?: string): string {
  const cleanIdentity = identityPrompt?.trim();
  if (!cleanIdentity) return prompt;
  return `${cleanIdentity}. ${prompt}`;
}

export const flow2apiVideo: VideoProvider = {
  async generateVideo(options, config) {
    const {
      prompt = "gentle camera movement",
      imageUrl,
      identityPrompt,
      lastFrameImage,
      seed,
    } = options;
    const { referenceImages } = readExtra(options);
    const model = chooseModel(options, config);

    // v2：在调用上游前拼"身份前缀 + 镜头描述"
    const finalPrompt = buildVideoPrompt(prompt, identityPrompt);

    log.info("[flow2api] start", {
      model,
      hasMain: !!imageUrl,
      hasLastFrame: !!lastFrameImage,
      hasIdentityPrompt: !!identityPrompt,
      hasSeed: typeof seed === "number",
      refsCount: referenceImages.length,
      promptLen: finalPrompt.length,
      seed,
    });

    // 图片输入：有尾帧时严格 [首帧, 尾帧]（FL 语义，与角色参考图互斥）；
    // 否则主图在前、参考图在后。两条路都再按模型类别裁剪到合法数量。
    const imageInputs = planImageInputs(
      model,
      imageUrl,
      lastFrameImage ? [lastFrameImage] : referenceImages
    );

    const finalContent = await requestFlow2apiGeneration({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model,
      content: buildMultimodalContent(finalPrompt, imageInputs),
      timeoutMs: 1800_000, // 30 分钟
      label: "视频",
    });

    const videoUrl = extractVideoUrl(finalContent);
    if (!videoUrl) {
      throw new Error(
        `flow2api 收到 stop 帧但未能解析视频 URL: ${finalContent.slice(0, 200)}`
      );
    }

    log.info("[flow2api] done", { videoUrl });
    return videoUrl;
  },
};
