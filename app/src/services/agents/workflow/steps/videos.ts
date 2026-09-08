/**
 * Step 5：视频 + 音频并行生成（从 `workflow-engine.ts#executeMediaGeneration` 平移）
 *
 * 纯搬运，无行为变更。逐镜 fan-out：视频任务与配音任务放进同一 `tasks` 数组，
 * 每镜 `Promise.allSettled` 等齐后再进下一镜（保持原串行推进节奏）。
 */

import { prisma } from "@/lib/prisma";
import { getUserTTSConfig } from "@/lib/ai-config";
import { normalizeVoiceFamily, resolveNarratorVoiceId } from "@/lib/tts-voice";
import { buildVideoScenePrompt } from "@/lib/prompts";
// 混合出片成本路由：hybrid 策略下按此判定某镜是否值得花钱生成视频（否则走图片运镜）。
import { recommendRenderMode } from "@/lib/render-mode";
// 剪辑裁剪豁免：与手动路径共用同一判据（高潮/冲击/动作镜保完整动作弧线）。
import { isTrimExemptShot } from "@/lib/shot-timing";
import {
  directVideoScene,
  generateSceneVideoSegmented,
  generateIntraShotTailFrame,
  shouldGenerateTailFrame,
  estimateVideoCost,
} from "@/services/generation";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import {
  uploadFile,
  uploadFileFromUrl,
  isStorageConfigured,
} from "@/services/storage";
import { probeMediaDurationFromUrl } from "@/services/video-synthesis";
// 场景角色身份上下文（纯函数，已提取以便单测）
import { buildSceneCharacterContext } from "../../scene-character-context";
import { emitEvent } from "../../event-bus";
import { log } from "../context";
import { chargeWorkflowItem } from "../credits";
import {
  loadProjectCharacters,
  type ProjectCharacterMap,
} from "../project-characters";
import { synthesizeSceneAudio } from "./audio";
import type {
  WorkflowContext,
  CharacterBible,
  SceneArtifact,
} from "../../types";

/** 视频 + 音频并行生成 */
export async function executeMediaGeneration(
  scenes: SceneArtifact[],
  ctx: WorkflowContext,
  characterBible?: CharacterBible
): Promise<void> {
  emitEvent({
    type: "step:started",
    workflowRunId: ctx.workflowRunId,
    step: "generate_videos",
    data: { message: "开始生成视频和配音..." },
    timestamp: new Date(),
  });

  // 获取已生成图片的场景
  const dbScenes = await prisma.scene.findMany({
    where: {
      project: { id: ctx.projectId },
      imageUrl: { not: null },
    },
    orderBy: { order: "asc" },
  });

  // v2：项目级画幅（与图像端一致，便于 flow2api-video 路由横/竖屏模型）
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { aspectRatio: true },
  });
  const projectAspectRatio = (project?.aspectRatio ?? "9:16") as
    | "1:1"
    | "9:16"
    | "16:9";

  // 循环前一次性查项目全部角色建查表（消除逐镜 N+1）。
  // video 用它取参考图/身份锚；tts 用它取角色 voiceId 解析对白声线——故 video 或
  // tts 任一开启都需要（此前只在 video 开启时加载，导致纯配音 workflow 拿不到声线）。
  const characterList =
    ctx.config.video || ctx.config.tts
      ? await loadProjectCharacters(ctx.projectId)
      : [];
  const characterMap: ProjectCharacterMap = new Map(
    characterList.map((c) => [c.name, c])
  );

  // TTS 声线解析上下文（批3）：一次性解析激活 TTS 配置并归一其厂商家族，供逐镜
  // 对白/旁白声线裁决共用（避免逐镜二次查询）。无 TTS 配置时 activeFamily 为空串，
  // resolveDialogueVoiceId/resolveNarratorVoiceId 会退化为 provider 默认声线。
  const ttsConfig = ctx.config.tts ? await getUserTTSConfig(ctx.userId) : null;
  const ttsActiveFamily = normalizeVoiceFamily(ttsConfig?.protocol);
  const narratorVoiceId = resolveNarratorVoiceId(ttsActiveFamily);

  // 混合出片策略（成本路由）：hybrid 时只对高动态/冲击/高潮镜生成视频，其余镜走图片
  // 运镜（导出端 Ken Burns，零视频成本）。缺省 "full" 时行为完全不变。判据用 DB Scene
  // 的 beatType/isClimax/cameraMovement（recommendRenderMode 单一真源）。
  const isHybridRender =
    ctx.config.generationParams?.renderStrategy === "hybrid";
  let hybridSkippedCount = 0;

  for (const dbScene of dbScenes) {
    const sceneArtifact = scenes.find((s) => s.order === dbScene.order);
    if (!sceneArtifact || !dbScene.imageUrl) continue;

    const tasks: Promise<void>[] = [];

    // 混合策略：本镜按成本路由判为「图片运镜可承载」→ 跳过视频生成。
    // 跳过的镜不置 videoStatus=PROCESSING、不扣积分，图片分镜由导出端 zoompan 运镜。
    const skipVideoForHybrid =
      isHybridRender &&
      recommendRenderMode({
        beatType: dbScene.beatType,
        isClimax: dbScene.isClimax,
        cameraMovement: dbScene.cameraMovement,
      }) === "motion";
    if (skipVideoForHybrid) {
      hybridSkippedCount += 1;
    }

    // 视频生成
    if (ctx.config.video && !skipVideoForHybrid) {
      // v2：从预查好的角色查表取场景角色上下文（参考图 / identityPrompt / seed），
      // 纯内存查表，无 DB 往返
      const charContext = buildSceneCharacterContext(
        sceneArtifact,
        characterMap,
        characterBible
      );

      // LLM 导演增强（Deliverable 2）：生成前导演一次「运动 + 记忆」。
      // 角色身份锚取 characterBible 的 canonicalPrompt（≤200 字，仅供理解不复述）；
      // 相邻镜取 order±1 的 artifact（承接上、铺垫下）。失败返回 null，回落确定性构建。
      const directorCharacters = (sceneArtifact.characters ?? [])
        .map((name) => {
          const bibleEntry = characterBible?.characters.find(
            (e) => e.name === name
          );
          return {
            name,
            identity: (bibleEntry?.canonicalPrompt ?? "").slice(0, 200),
          };
        })
        .filter((c) => c.name);
      const prevArtifact = scenes.find(
        (s) => s.order === sceneArtifact.order - 1
      );
      const nextArtifact = scenes.find(
        (s) => s.order === sceneArtifact.order + 1
      );
      const direction = await directVideoScene(
        {
          scene: {
            description: sceneArtifact.description,
            actionBeat: sceneArtifact.actionBeat,
            shotType: sceneArtifact.shotType,
            cameraAngle: sceneArtifact.cameraAngle,
            lighting: sceneArtifact.lighting,
            emotion: sceneArtifact.emotion,
            duration: sceneArtifact.duration,
          },
          characters: directorCharacters,
          prevScene: prevArtifact
            ? {
                description: prevArtifact.description,
                actionBeat: prevArtifact.actionBeat,
              }
            : null,
          nextScene: nextArtifact
            ? {
                description: nextArtifact.description,
                actionBeat: nextArtifact.actionBeat,
              }
            : null,
          style: ctx.config.style,
        },
        ctx.config.llm
      );

      // 分段生成对齐手动路径：按模型能力自动分段（超单段时长拆 N 段无缝拼接），
      // 内部走 storage 门面落自有 URL。计费与手动路径同源（estimateVideoCost）。
      // 能力提前到 prompt 构建之前：镜内尾帧裁决需要 FL 能力标志。
      const videoCapability = getVideoModelCapability(
        ctx.config.video?.protocol ?? "",
        ctx.config.video?.model
      );

      // 镜内尾帧（包 B，与手动路径对等）：导演判定本镜变化幅度为 large 且模型
      // 支持 FL 时，以本镜首帧图编辑式生成「终态」尾帧图走首尾帧插值，锁死大
      // 动作终点。workflow 无客户端跨镜尾帧（hasClientLastFrame 恒 false）。
      // 任何失败返回 null 走原路径，绝不阻断视频生成。
      let intraShotLastFrame: string | undefined;
      if (
        ctx.config.image &&
        direction?.endFrameDesc &&
        shouldGenerateTailFrame({
          variationType: direction.variationType,
          hasClientLastFrame: false,
          supportsLastFrame: videoCapability.supportsFirstLastFrame,
          hasSceneImage: !!dbScene.imageUrl,
        })
      ) {
        intraShotLastFrame =
          (await generateIntraShotTailFrame({
            endFrameDesc: direction.endFrameDesc,
            sceneImageUrl: dbScene.imageUrl,
            style: ctx.config.style,
            aspectRatio: projectAspectRatio,
            imageConfig: ctx.config.image,
            userId: ctx.userId,
            projectId: ctx.projectId,
            sceneId: dbScene.id,
          })) ?? undefined;
      }

      // 统一视频 prompt 构建器：镜头语言 + 运镜 + 氛围 + 连续性 + 负面词。
      // 修复：身份前缀此前内联 + provider 双重注入 —— 现在 prompt 不含身份前缀，
      // 仅通过 identityPrompt 选项透传，由 provider 单次 prepend。
      // 导演产出（cameraMovement/actionBeat/atmosphere）优先，缺失回落 artifact 值。
      const videoPrompt = buildVideoScenePrompt({
        description: sceneArtifact.description,
        actionBeat: direction?.actionBeat ?? sceneArtifact.actionBeat,
        style: ctx.config.style,
        shotType: sceneArtifact.shotType,
        cameraAngle: sceneArtifact.cameraAngle,
        cameraMovement:
          direction?.cameraMovement ?? sceneArtifact.cameraMovement,
        lighting: sceneArtifact.lighting,
        emotion: sceneArtifact.emotion,
        atmosphereOverride: direction?.atmosphere,
        duration: sceneArtifact.duration,
        // 镜内尾帧存在时启用 FL 文案（视频精确结束于所给尾帧画面）
        hasLastFrame: !!intraShotLastFrame,
        // 有对白 + 景别看得清嘴 → lip flap 口型指令（批3）
        hasDialogue: !!sceneArtifact.dialogue?.trim(),
        // 冲击节拍高能动作指令（批4）：SceneArtifact 无此字段，取 DB 已落库值，
        // 与手动路径 route.ts 对等（缺失时 impact 镜会被模型渲成缓慢漂移）。
        beatType: dbScene.beatType,
      });
      const videoCost = estimateVideoCost(
        sceneArtifact.duration,
        videoCapability
      );
      tasks.push(
        generateSceneVideoSegmented({
          imageUrl: dbScene.imageUrl,
          // 镜内尾帧（variationType=large 时生成）：末段走 FL 首尾帧插值
          lastFrameImage: intraShotLastFrame,
          // 用户设定的真实时长（1–60），由分段器按模型能力规划段数
          requestedSeconds: sceneArtifact.duration,
          capability: videoCapability,
          prompts: [videoPrompt],
          aspectRatio: projectAspectRatio,
          // v2：透传角色参考图（激活 flow2api Veo R2V / 后续 Kling Elements / Runway Gen-4 Refs）
          referenceImages:
            charContext.referenceImages.length > 0
              ? charContext.referenceImages
              : undefined,
          // v2：透传 identity seed（与图像端共用 FNV-1a）
          seed: charContext.seed,
          // v2：透传 identityPrompt（provider 可在内部再做一次强化）
          identityPrompt: charContext.identityPrompt,
          config: ctx.config.video,
          userId: ctx.userId,
          projectId: ctx.projectId,
          sceneId: dbScene.id,
          // 剪辑裁剪豁免（对齐手动路径 api/generate/video）：此前 workflow 不传此字段，
          // 分段器恒裁到叙事目标 → 高潮 / 冲击 / 动作镜被砍尾（动作弧线半途截断）。
          // 判据用 DB Scene 已落库的强信号（isClimax/beatType）+ 情绪/动作启发式。
          exemptFromTrim: isTrimExemptShot({
            emotion: dbScene.emotion,
            actionBeat: direction?.actionBeat ?? dbScene.actionBeat,
            targetDuration: sceneArtifact.duration,
            isClimax: dbScene.isClimax,
            beatType: dbScene.beatType,
          }),
        })
          .then(async (segResult) => {
            // 转存判据用 isSelfHosted（对齐手动路径）：单段【裁剪】路径虽然
            // segments.length===1，但产物已由分段器上传到自有存储
            // （isSelfHosted=true）——按段数判会把自有 URL 再下载上传一遍，
            // 白烧带宽并在存储里留下孤儿文件。
            let videoUrl = segResult.videoUrl;
            if (!segResult.isSelfHosted && isStorageConfigured()) {
              try {
                videoUrl = await uploadFileFromUrl(segResult.videoUrl, {
                  fileName: `scene_${dbScene.id}_${Date.now()}.mp4`,
                  contentType: "video/mp4",
                  fileType: "video",
                  userId: ctx.userId,
                  projectId: ctx.projectId,
                });
              } catch (uploadErr) {
                log.error(
                  `[workflow] 场景 ${dbScene.id} 视频转存失败，沿用外部 URL`,
                  uploadErr instanceof Error ? uploadErr.message : uploadErr
                );
              }
            }
            // 回写真实时长（对齐手动路径修复的 stale-DB 缺口）：多段路径 orchestrator
            // 已 ffprobe 拼接后总时长；单段路径此处补探一次。真实视频长度即分镜时长。
            let resolvedDuration = sceneArtifact.duration;
            if (
              segResult.measuredDurationSeconds &&
              segResult.measuredDurationSeconds > 0
            ) {
              resolvedDuration = Math.max(
                1,
                Math.round(segResult.measuredDurationSeconds)
              );
            } else {
              try {
                const probed = await probeMediaDurationFromUrl(videoUrl);
                if (probed > 0)
                  resolvedDuration = Math.max(1, Math.round(probed));
              } catch {
                // 探测失败回退声明时长，不阻塞
              }
            }
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: {
                videoUrl,
                videoStatus: "COMPLETED",
                duration: resolvedDuration,
              },
            });
            // 成功后扣费（与手动路径同源估算器，按分段档位求和）
            await chargeWorkflowItem(ctx, {
              sceneId: dbScene.id,
              kind: "video",
              amount: videoCost,
              note: `场景 ${dbScene.id} 视频生成`,
            });
          })
          .catch(async (err) => {
            // 不再静默吞错：记录失败原因，便于 workflow 终态判断与排查
            log.error(
              `[workflow] 场景 ${dbScene.id} 视频生成失败`,
              err instanceof Error ? err.message : err
            );
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { videoStatus: "FAILED" },
            });
            emitEvent({
              type: "step:failed",
              workflowRunId: ctx.workflowRunId,
              step: "generate_videos",
              data: {
                sceneId: dbScene.id,
                message: `场景 ${dbScene.id} 视频生成失败`,
                error: err instanceof Error ? err.message : String(err),
              },
              timestamp: new Date(),
            });
          })
      );
    }

    // TTS 生成（批3：对白角色声线 + 旁白独立声线 + 情绪透传 + 旁白对白拼接）
    if (ctx.config.tts && (sceneArtifact.dialogue || sceneArtifact.narration)) {
      const ttsConfigForScene = ctx.config.tts;
      tasks.push(
        synthesizeSceneAudio({
          sceneArtifact,
          // 分镜级语速（重跑 workflow 时尊重用户在编辑器调过的值）；
          // ttsSpeed 有 DB 默认（1.1 漫剧节奏），恒为数字
          ttsSpeed: dbScene.ttsSpeed,
          ttsConfig: ttsConfigForScene,
          characterMap,
          ttsActiveFamily,
          narratorVoiceId,
        })
          .then(async (result) => {
            if (!result) return; // 无对白无旁白（防御，上方已过滤）
            const { audioBuffer, charCount } = result;
            // 修复哑片：synthesizeSpeech 返回音频 Buffer，必须落盘并写回
            // scene.audioUrl，否则导出/预览取不到音轨 → 自动成片无配音。
            // 走 uploadFile 统一门面（R2 已配走云存储 / 未配降级本地盘）。
            const audioUrl = await uploadFile(audioBuffer, {
              fileName: `scene_${dbScene.id}_audio_${Date.now()}.mp3`,
              contentType: "audio/mpeg",
              fileType: "audio",
              userId: ctx.userId,
              projectId: ctx.projectId,
            });
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { audioUrl, audioStatus: "COMPLETED" },
            });
            // 成功后扣费（2积分/100字，与手动路径一致；按旁白+对白总字数计）
            await chargeWorkflowItem(ctx, {
              sceneId: dbScene.id,
              kind: "tts",
              amount: Math.ceil(charCount / 100) * 2,
              note: `场景 ${dbScene.id} 语音合成（${charCount}字）`,
            });
          })
          .catch(async (err) => {
            // 不再静默吞错
            log.error(
              `[workflow] 场景 ${dbScene.id} 配音生成失败`,
              err instanceof Error ? err.message : err
            );
            await prisma.scene.update({
              where: { id: dbScene.id },
              data: { audioStatus: "FAILED" },
            });
            emitEvent({
              type: "step:failed",
              workflowRunId: ctx.workflowRunId,
              step: "synthesize_voice",
              data: {
                sceneId: dbScene.id,
                message: `场景 ${dbScene.id} 配音生成失败`,
                error: err instanceof Error ? err.message : String(err),
              },
              timestamp: new Date(),
            });
          })
      );
    }

    await Promise.allSettled(tasks);
  }

  // 混合策略摘要：写明有多少镜按成本路由走了图片运镜（未生成视频），供 UI/日志追溯。
  const videoDoneMessage = isHybridRender
    ? `视频和配音生成完成（混合策略：${hybridSkippedCount} 镜按成本路由走图片运镜，未生成视频）`
    : "视频和配音生成完成";
  if (isHybridRender) {
    log.info(
      `[workflow] 混合出片：${hybridSkippedCount} 镜走图片运镜（跳过视频生成）`
    );
  }
  emitEvent({
    type: "step:completed",
    workflowRunId: ctx.workflowRunId,
    step: "generate_videos",
    data: { message: videoDoneMessage },
    timestamp: new Date(),
  });
}
