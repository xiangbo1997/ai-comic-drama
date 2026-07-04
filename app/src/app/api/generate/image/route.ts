import { auth } from "@/lib/auth";
import { contentSafetyMiddleware } from "@/lib/content-safety";
import { prisma } from "@/lib/prisma";
import { chatCompletion } from "@/services/ai";
import { uploadFileFromUrl, isStorageConfigured } from "@/services/storage";
import { getUserImageConfig, getUserLLMConfig } from "@/lib/ai-config";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import {
  type CharacterInfo,
  type SceneAnalysis,
  buildEnhancedPrompt,
  buildSceneAnalysisPrompt,
  parseSceneAnalysisResponse,
} from "@/lib/prompt-builder";
import { orchestrateImageGeneration } from "@/services/generation";
import type { SceneCharacterInfo, CharacterRole } from "@/services/generation";
import { createLogger } from "@/lib/logger";
import { chargeCredits } from "@/lib/credits";

const log = createLogger("api:generate:image");

// 图像生成成本（积分）
const IMAGE_COST = {
  normal: 1, // 普通生成
  withRef: 3, // 带参考图（角色一致性）
};

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 在事务闭包内 TS 会丢失对 userId 的收窄，提前固化为局部常量
    const userId = session.user.id;

    // 应用限流
    const rateLimitResult = await rateLimiters.imageGeneration(request, userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "请求过于频繁，请稍后再试",
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429, headers: rateLimitHeaders(rateLimitResult) }
      );
    }

    const {
      prompt,
      referenceImage,
      // Stage 修复：客户端三视图会传 referenceImages 数组（front/side/back），
      // 此前未解构导致多张参考图被丢弃，三视图锁形象在服务端实质失效。
      referenceImages,
      aspectRatio,
      style,
      projectId,
      sceneId,
      imageConfigId,
      // Stage 1.3 引入：客户端可显式传入 negativePrompt。orchestrator 将在 Stage 1.4
      // 正式消费（目前先记录，便于观察管线是否打通）。
      negativePrompt,
    } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (negativePrompt) {
      log.debug("Received negativePrompt from client", {
        sceneId,
        length: String(negativePrompt).length,
      });
    }
    if (referenceImage) {
      log.debug(
        "Received referenceImage from client (activates orchestrator reference_edit)",
        {
          sceneId,
        }
      );
    }

    // 内容安全检查
    const safetyCheck = await contentSafetyMiddleware(prompt, "image");
    if (!safetyCheck.safe) {
      return NextResponse.json(
        {
          error: "内容不符合安全规范",
          reason: safetyCheck.reason,
          blockedKeywords: safetyCheck.blockedKeywords,
        },
        { status: 400 }
      );
    }

    // 使用净化后的提示词
    const safePrompt = safetyCheck.sanitizedText || prompt;

    // 成本预估（编排器使用参考图时成本更高，此处做保守预扣）
    const hasExplicitRef = !!(
      referenceImage ||
      (Array.isArray(referenceImages) && referenceImages.length > 0)
    );
    const cost = hasExplicitRef ? IMAGE_COST.withRef : IMAGE_COST.normal;

    // 检查积分
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          required: cost,
          current: user?.credits ?? 0,
        },
        { status: 400 }
      );
    }

    // IDOR 防护：校验 sceneId 归属当前用户，禁止跨用户篡改/投毒他人分镜
    // （security-cost P0-1）。后续所有 scene.update 据此安全。
    if (sceneId) {
      const ownsScene = await prisma.scene.findFirst({
        where: { id: sceneId, project: { userId: userId } },
        select: { id: true },
      });
      if (!ownsScene) {
        return NextResponse.json({ error: "Scene not found" }, { status: 404 });
      }
    }

    // 如果有场景ID，先更新状态为处理中
    if (projectId && sceneId) {
      await prisma.scene.update({
        where: { id: sceneId },
        data: { imageStatus: "PROCESSING" },
      });
    }

    // 创建生成任务记录（input.userId 供轮询端点做归属校验，同 script/parse 模式）
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        input: {
          userId,
          prompt,
          referenceImage,
          aspectRatio,
          style,
          imageConfigId,
        },
        projectId,
        sceneId,
        cost,
      },
    });

    // 异步化（2026-07-04）：生成主体 fire-and-forget 挂在本进程后台执行
    // （systemd 常驻 node，与 workflow / 三视图同模式），POST 立即返回
    // taskId，客户端轮询 GET /api/generate/tasks/[taskId] 取结果。
    // 此前同步 await 数十秒：请求断开即丢结果、无法刷新恢复、受平台超时约束。
    // 扣费语义不变：成功后事务内扣费，失败/僵尸从未扣费无需退款。
    const run = async () => {
      try {
        // 获取用户的图像生成配置
        const imageConfig = await getUserImageConfig(userId, imageConfigId);
        const llmConfig = await getUserLLMConfig(userId);

        if (imageConfigId && !imageConfig) {
          throw new Error(
            "所选图片供应商不可用，请重新选择已测试成功的图像模型配置。"
          );
        }

        // 获取场景和角色信息，构建编排器所需的 SceneCharacterInfo[]
        let enhancedPrompt = safePrompt;
        let sceneCharacters: SceneCharacterInfo[] = [];
        let shotType: string | undefined;
        // 镜头语言（块内从 scene 取，块外拼进出图 prompt）
        let sceneCinematics: {
          cameraAngle?: string | null;
          lighting?: string | null;
          composition?: string | null;
          colorPalette?: string | null;
        } | null = null;

        if (sceneId) {
          const scene = await prisma.scene.findUnique({
            where: { id: sceneId },
            select: {
              description: true,
              dialogue: true,
              emotion: true,
              shotType: true,
              cameraAngle: true,
              lighting: true,
              composition: true,
              colorPalette: true,
              selectedCharacterIds: true,
              selectedCharacter: {
                select: {
                  id: true,
                  name: true,
                  gender: true,
                  age: true,
                  description: true,
                  referenceImages: true,
                  canonicalImageUrl: true,
                  appearance: true,
                },
              },
            },
          });

          shotType = scene?.shotType || undefined;
          sceneCinematics = scene
            ? {
                cameraAngle: scene.cameraAngle,
                lighting: scene.lighting,
                composition: scene.composition,
                colorPalette: scene.colorPalette,
              }
            : null;

          // 获取角色信息并构建 SceneCharacterInfo
          const buildSceneChar = (
            c: {
              id: string;
              name: string;
              gender: string | null;
              age: string | null;
              description: string | null;
              referenceImages: string[];
              canonicalImageUrl?: string | null;
              appearance?: Record<string, unknown> | null;
            },
            index: number
          ): SceneCharacterInfo => ({
            id: c.id,
            name: c.name,
            gender: c.gender,
            age: c.age,
            description: c.description,
            referenceImages: c.referenceImages as string[],
            role: (index === 0 ? "primary" : "secondary") as CharacterRole,
            // 优先用三视图定妆的身份锚点（经 i2i 绑定，更可靠），
            // 缺失时回落到旧 referenceImages[0]（角色一致性闭环）。
            canonicalImageUrl:
              c.canonicalImageUrl || (c.referenceImages as string[])?.[0],
            appearance: c.appearance as SceneCharacterInfo["appearance"],
          });

          if ((scene?.selectedCharacterIds?.length ?? 0) > 0) {
            const dbCharacters = await prisma.character.findMany({
              where: { id: { in: scene!.selectedCharacterIds } },
              select: {
                id: true,
                name: true,
                gender: true,
                age: true,
                description: true,
                referenceImages: true,
                canonicalImageUrl: true,
                appearance: true,
              },
            });
            sceneCharacters = dbCharacters.map((c, i) => buildSceneChar(c, i));
          } else if (scene?.selectedCharacter) {
            sceneCharacters = [buildSceneChar(scene.selectedCharacter, 0)];
          }

          // LLM 场景分析增强 prompt
          const characters: CharacterInfo[] = sceneCharacters.map((c) => ({
            name: c.name,
            gender: c.gender,
            age: c.age,
            description: c.description,
            referenceImages: c.referenceImages,
            appearance: c.appearance,
          }));

          if (characters.length > 0 && scene?.description && llmConfig) {
            try {
              const analysisPrompt = buildSceneAnalysisPrompt({
                sceneDescription: scene.description,
                dialogue: scene.dialogue || undefined,
                characters,
                emotion: scene.emotion || undefined,
                shotType: scene.shotType || undefined,
              });

              const analysisResponse = await chatCompletion(
                [
                  {
                    role: "system",
                    content:
                      "你是一个专业的分镜师和图像生成专家。你的任务是分析场景描述，提取用于图像生成的关键信息。请始终以 JSON 格式输出结果。",
                  },
                  { role: "user", content: analysisPrompt },
                ],
                { config: llmConfig, temperature: 0.3, maxTokens: 1024 }
              );

              const analysis: SceneAnalysis =
                parseSceneAnalysisResponse(analysisResponse);

              enhancedPrompt = buildEnhancedPrompt({
                style,
                characters,
                analysis,
                shotType: scene.shotType || undefined,
                originalPrompt: safePrompt,
              });
            } catch (analysisError) {
              log.warn(
                "Scene analysis failed, falling back to simple prompt:",
                analysisError
              );
              if (characters.length > 1) {
                const characterNames = characters
                  .map((c) => c.name)
                  .join(" and ");
                enhancedPrompt = `${safePrompt}, scene with ${characters.length} characters: ${characterNames}, multiple characters interacting`;
              }
            }
          } else if (characters.length > 1) {
            const characterNames = characters.map((c) => c.name).join(" and ");
            enhancedPrompt = `${safePrompt}, scene with ${characters.length} characters: ${characterNames}, multiple characters interacting`;
          }
        }

        // 镜头语言：把 LLM 解析的 cameraAngle/lighting/composition/colorPalette
        // 拼进 prompt，给出图注入电影感（此前这四字段落库后从不参与出图）。
        const cinematicParts = [
          sceneCinematics?.cameraAngle,
          sceneCinematics?.lighting,
          sceneCinematics?.composition,
          sceneCinematics?.colorPalette,
        ].filter((v): v is string => !!v && v.trim().length > 0);
        const finalPrompt =
          cinematicParts.length > 0
            ? `${enhancedPrompt}, ${cinematicParts.join(", ")}`
            : enhancedPrompt;

        // 通过编排器生成图像（统一策略选择 + 验证 + 重试）
        // Stage 1.4：把客户端传入的 negativePrompt 与 referenceImage 透传给 orchestrator。
        // 客户端显式指定的 referenceImage 作为 referenceImages 列表第一项优先生效。
        const result = await orchestrateImageGeneration({
          prompt: finalPrompt,
          sceneId,
          projectId,
          characters: sceneCharacters,
          shotType,
          style,
          aspectRatio,
          imageConfig: imageConfig || {
            apiKey: "",
            baseUrl: "",
            model: "",
            protocol: "openai",
          },
          llmConfig: llmConfig || undefined,
          userId: userId,
          negativePrompt: negativePrompt || undefined,
          referenceImages:
            Array.isArray(referenceImages) && referenceImages.length > 0
              ? referenceImages
              : referenceImage
                ? [referenceImage]
                : undefined,
        });

        let imageUrl = result.imageUrl;

        // 保存到存储服务（R2 或本地）
        if (isStorageConfigured()) {
          try {
            const fileName = `scene_${sceneId || "unknown"}_${Date.now()}.webp`;
            imageUrl = await uploadFileFromUrl(imageUrl, {
              fileName,
              contentType: "image/webp",
              fileType: "image",
              userId: userId,
              projectId,
            });
            log.info("Image saved to storage:", imageUrl);
          } catch (uploadError) {
            log.error("Failed to save image, using external URL:", uploadError);
            // 降级：继续使用外部 URL
          }
        }

        // 实际成本：编排器使用了参考图则成本更高
        const actualCost =
          result.strategy === "reference_edit"
            ? IMAGE_COST.withRef
            : IMAGE_COST.normal;

        // R1：将「任务完成 + 场景更新 + 扣费」包进同一事务，保证原子性。
        // chargeCredits 内部会在事务里再次校验余额并记录积分流水，
        // 余额不足会抛错并自动回滚 task/scene 的本次写入。
        // R2：扣费时机为「生成成功后」，失败路径（catch）下用户从未被扣，无需退款。
        await prisma.$transaction(async (tx) => {
          // 更新任务状态
          await tx.generationTask.update({
            where: { id: task.id },
            data: {
              status: "COMPLETED",
              // output 即轮询端点透传给客户端的 result，保持与原同步响应同形
              output: {
                imageUrl,
                cost: actualCost,
                strategy: result.strategy,
                attemptCount: result.attemptCount,
              },
              completedAt: new Date(),
              cost: actualCost,
            },
          });

          // 如果有场景ID，更新场景
          if (projectId && sceneId) {
            await tx.scene.update({
              where: { id: sceneId },
              data: { imageUrl, imageStatus: "COMPLETED" },
            });
          }

          // 扣减积分（使用实际成本，事务内扣费+记流水+余额校验）
          await chargeCredits(tx, {
            userId,
            amount: actualCost,
            type: "GENERATE_IMAGE",
            source: "generate:image",
            sourceId: task.id,
            note: sceneId
              ? `场景 ${sceneId} 图像生成（策略 ${result.strategy}）`
              : `图像生成（策略 ${result.strategy}）`,
          });
        });
      } catch (error) {
        // 更新任务状态为失败（后台任务不再向 HTTP 层抛错，落库供轮询读取）
        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        });

        // 如果有场景ID，更新场景状态
        if (projectId && sceneId) {
          await prisma.scene.update({
            where: { id: sceneId },
            data: { imageStatus: "FAILED" },
          });
        }

        log.error("Image generation task failed:", error);
      }
    };

    // 兜底：run 内部 catch 自身抛错（如 FAILED 落库失败）时仅记日志，
    // 残留的 PROCESSING 由轮询端点的僵尸回收清扫
    void run().catch((err) => log.error("Image task runner crashed:", err));

    return NextResponse.json({ taskId: task.id, cost }, { status: 202 });
  } catch (error) {
    log.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}
