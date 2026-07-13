/**
 * 镜内首尾帧生成器（镜内首尾帧分解 · 包 B）
 *
 * 借鉴 HKUDS ViMax 的 first/last frame decomposition：变化大的镜头（大幅运镜、
 * 由全景推到特写、主体大幅移动）只靠视频模型自由发挥容易失控。为这类镜头额外
 * 生成一张「本镜专属尾帧图」，与首帧图配对走 FL（首尾帧插值），把镜内大动作的
 * 终态锁死，提升镜内控制力。
 *
 * 与「跨镜尾帧」（videoLinkNext：下一分镜开场图）的区别：
 * - 跨镜尾帧是用户显式开的相邻镜衔接，由 videoLinkNext 提供，优先级更高。
 * - 镜内尾帧是本镜内部的终态快照，由本镜首帧图「编辑式」生成（环境/身份/画风/
 *   机位不变，只把姿态与构图改到终态描述），仅在没有跨镜尾帧时兜底。
 *
 * 尾帧图怎么生成：
 * - 以本镜首帧图为 referenceImage 做编辑式生成（走 @/services/ai 的 generateImage）。
 * - endFrameDesc 是 LLM 产物，进图像 prompt 前必须过 contentSafetyMiddleware。
 * - 产物 URL 非自有存储时用 uploadFileFromUrl 转存（对齐图像路径）。
 *
 * 【计费决策】v1 镜内尾帧不额外扣积分——与 face-validator 重试、VLM 打分同类的
 * 内部质量增强开销（消耗外部 API 配额但不计入用户积分），放开 medium 档时再评估。
 *
 * 增强项语义：全函数 try/catch，任何失败 log.warn 后返回 null，绝不阻断视频生成。
 */

import { generateImage } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { getSimpleStylePrefix } from "@/lib/prompts";
import { createLogger } from "@/lib/logger";
import type { AIServiceConfig } from "@/types";

const log = createLogger("services:generation:tail-frame");

/** 镜内尾帧图生成入参 */
export interface GenerateTailFrameArgs {
  /** 本镜最后一帧的静态快照描述（中文，导演产出，进 prompt 前会过内容安全） */
  endFrameDesc: string;
  /** 本镜首帧图 URL（作为编辑式生成的基底：环境/身份/画风/机位由它锚定） */
  sceneImageUrl: string;
  /** 项目风格（可选，拼到 prompt 尾部保持画风一致） */
  style?: string | null;
  /** 画幅（透传 provider 路由横/竖屏） */
  aspectRatio?: "1:1" | "9:16" | "16:9";
  /** 图像生成配置（由调用方 getUserImageConfig 取得） */
  imageConfig: AIServiceConfig;
  /** 上传归属（storage 路径与审计用） */
  userId: string;
  projectId?: string;
  sceneId?: string;
}

/**
 * 编辑式尾帧 prompt：英文框架包裹中文终态描述。
 * 明确「基于参考图（首帧）生成同一镜的终态」，环境/身份/画风/机位保持不变，
 * 只改姿态、位置、表情。style 后缀保持画风一致。
 */
function buildTailFramePrompt(
  endFrameDesc: string,
  style?: string | null
): string {
  const base =
    `Based on the reference image (the first frame of this shot), generate the END state of the same shot: ${endFrameDesc}. ` +
    `Keep the same environment, characters' identities, art style and camera framing; only change poses, positions and expressions as described.`;
  const stylePrefix = style ? getSimpleStylePrefix(style) : "";
  return stylePrefix ? `${base} ${stylePrefix}` : base;
}

/**
 * 生成本镜专属尾帧图。
 *
 * @returns 成功返回尾帧图 URL（自有存储或 provider URL）；不安全 / 生成失败 /
 *   转存失败等任何情况返回 null（调用方走原路径，不下发镜内尾帧）。
 */
export async function generateIntraShotTailFrame(
  args: GenerateTailFrameArgs
): Promise<string | null> {
  const { endFrameDesc, sceneImageUrl, style, aspectRatio, imageConfig } = args;

  try {
    // endFrameDesc 是 LLM 产物，进图像 prompt 前必须过内容安全
    const safety = await contentSafetyMiddleware(endFrameDesc, "image");
    if (!safety.safe) {
      log.warn("镜内尾帧描述未通过内容安全，跳过尾帧生成", {
        sceneId: args.sceneId,
        reason: safety.reason,
      });
      return null;
    }
    const safeDesc = safety.sanitizedText || endFrameDesc;

    const prompt = buildTailFramePrompt(safeDesc, style);

    // 编辑式生成：referenceImage 传本镜首帧图，环境/身份/画风/机位由它锚定
    const rawUrl = await generateImage({
      prompt,
      referenceImage: sceneImageUrl,
      aspectRatio,
      style: style ?? undefined,
      config: imageConfig,
    });
    if (!rawUrl) {
      log.warn("镜内尾帧生成返回空 URL，跳过", { sceneId: args.sceneId });
      return null;
    }

    // 转存自有存储（对齐图像路径）：provider 可能返回临时受限域名 URL，
    // 会过期且浏览器/视频模型可能够不到。转存失败降级沿用原始 URL（作首帧输入
    // 通常仍可用），不因转存失败丢掉整张尾帧。
    if (isStorageConfigured()) {
      try {
        return await uploadFileFromUrl(rawUrl, {
          fileName: `scene_${args.sceneId ?? "unknown"}_tailframe_${Date.now()}.jpg`,
          contentType: "image/jpeg",
          fileType: "image",
          userId: args.userId,
          projectId: args.projectId,
        });
      } catch (uploadErr) {
        log.warn("镜内尾帧转存失败，沿用 provider URL", {
          sceneId: args.sceneId,
          error: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
        return rawUrl;
      }
    }
    return rawUrl;
  } catch (err) {
    log.warn("镜内尾帧生成失败，跳过（不阻断视频生成）", {
      sceneId: args.sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 是否为本镜生成镜内尾帧图（纯函数、可测）。
 *
 * v1 只放行 large：
 * - variationType === "large"：仅大幅构图变化的镜头才值得为尾帧生成额外开销。
 *   medium（角色入画/转身）观望，控成本，放开时再评估计费。
 * - !hasClientLastFrame：用户显式开的跨镜衔接（videoLinkNext）优先，不与之争抢
 *   FL 的尾帧槽位。
 * - supportsLastFrame：模型必须支持 FL 首尾帧插值，否则尾帧图无处可用。
 * - hasSceneImage：必须有首帧图作编辑基底。
 */
export function shouldGenerateTailFrame(args: {
  variationType?: string;
  hasClientLastFrame: boolean;
  supportsLastFrame: boolean;
  hasSceneImage: boolean;
}): boolean {
  return (
    args.variationType === "large" &&
    !args.hasClientLastFrame &&
    args.supportsLastFrame &&
    args.hasSceneImage
  );
}
