/**
 * 短剧创作服务门面
 *
 * 对外暴露「世界观→结构化脚本」等创作链能力，内部复用 Agent。
 * 可独立于 WorkflowEngine 使用（构造最小化 WorkflowContext）。
 */

import { DramaScriptAgent } from "./agents/drama-script-agent";
import { StoryboardTableAgent } from "./agents/storyboard-table-agent";
import { generateImage } from "./ai";
import { uploadFileFromUrl, isStorageConfigured } from "./storage";
import { buildGridImagePrompt } from "@/lib/prompts/grid-prompt";
import { createLogger } from "@/lib/logger";
import type { WorkflowContext } from "./agents/types";
import type { AIServiceConfig } from "@/types";
import type {
  DramaScriptInput,
  DramaScriptArtifact,
  StoryboardTableArtifact,
  StoryboardCell,
} from "@/types/drama";

const log = createLogger("services:drama-script");

/** 构造独立于 workflow 的最小化上下文（复用 parseScriptWithAgent 同款模式） */
function buildStandaloneContext(config?: AIServiceConfig): WorkflowContext {
  const noop = () => {};
  return {
    workflowRunId: "standalone",
    projectId: "",
    userId: "",
    config: {
      llm: config,
      mode: "auto",
      maxImageReflectionRounds: 0,
      style: "anime",
    },
    artifacts: {
      get: () => undefined,
      set: noop,
      getAll: () => [],
    },
    emit: noop,
  };
}

/**
 * 根据世界观生成结构化短剧脚本（阶段1）。
 * @throws 生成失败时抛 Error，由调用方接住写入 GenerationTask
 */
export async function generateDramaScript(
  input: DramaScriptInput,
  config?: AIServiceConfig
): Promise<DramaScriptArtifact> {
  const agent = new DramaScriptAgent();
  const ctx = buildStandaloneContext(config);
  const result = await agent.run(input, ctx);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "短剧脚本生成失败");
  }

  return result.data;
}

/**
 * 由结构化脚本生成九宫格分镜表（阶段2，恰好 9 格）。
 * @throws 生成失败时抛 Error
 */
export async function generateStoryboardTable(
  script: DramaScriptArtifact,
  config?: AIServiceConfig
): Promise<StoryboardTableArtifact> {
  const agent = new StoryboardTableAgent();
  const ctx = buildStandaloneContext(config);
  const result = await agent.run(script, ctx);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "九宫格分镜表生成失败");
  }

  return result.data;
}

/**
 * 由九宫格分镜表生成一张 3×3 合成图（阶段3）。
 * 调图像模型 → 落 R2 → 返回最终 URL。
 * @throws 生成失败时抛 Error
 */
export async function generateGridImage(
  cells: StoryboardCell[],
  style: string,
  aspectRatio: string,
  userId: string,
  config?: AIServiceConfig
): Promise<string> {
  const prompt = buildGridImagePrompt(cells, style);

  let imageUrl = await generateImage({
    prompt,
    aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9",
    config,
  });

  // 落 R2（失败降级用外部 URL，仿 generate-reference）
  if (isStorageConfigured()) {
    try {
      imageUrl = await uploadFileFromUrl(imageUrl, {
        fileName: `grid_${Date.now()}.webp`,
        contentType: "image/webp",
        fileType: "image",
        userId,
      });
    } catch (uploadError) {
      log.error("Failed to save grid image, using external URL:", uploadError);
    }
  }

  return imageUrl;
}
