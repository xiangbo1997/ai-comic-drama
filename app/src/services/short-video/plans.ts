import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSystemConfigs, getVideoTierCosts } from "@/lib/system-config";
import {
  estimateVideoCost,
  planVideoSegments,
} from "@/services/generation/video-segmenter";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import { stableHash } from "@/lib/short-video/hash";
import { invariant } from "@/lib/short-video/errors";
import { ScriptRunZ, RenderPlanZ, ScriptZ } from "@/lib/short-video/contracts";
import {
  receipt,
  replayReceipt,
  ownedVideo,
  assertIdle,
  json,
  type Tx,
} from "./store";
import { scriptSnapshot } from "./scripts";
export const PlanZ = z.object({
  kind: z.enum(["SCRIPT", "RENDER"]),
  videoVersion: z.number().int(),
  scriptHash: z.string().optional(),
  projectFingerprint: z.string().optional(),
  snapshot: z.unknown().optional(),
  configIds: z.record(z.string(), z.string()),
  models: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      model: z.string(),
      protocol: z.string(),
    })
  ),
  sceneMap: z
    .array(
      z.object({
        key: z.string(),
        sceneId: z.string(),
        description: z.string(),
        dialogue: z.string(),
        narration: z.string(),
        duration: z.number(),
        subtitle: z.string(),
      })
    )
    .default([]),
  steps: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["SCRIPT", "IMAGE", "VIDEO", "TTS", "COMPOSE"]),
      cost: z.number().int().nonnegative(),
      input: z.record(z.string(), z.unknown()),
    })
  ),
  upperBoundCredits: z.number().int().nonnegative(),
  supplierFees: z.string(),
  estimatedDuration: z.array(z.number()).optional(),
  ttsEnabled: z.boolean().default(false),
});
export type Plan = z.infer<typeof PlanZ>;
export async function configState(userId: string, ids: Record<string, string>) {
  const rows = [];
  for (const [category, id] of Object.entries(ids).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const row = await prisma.userAIConfig.findFirst({
      where: {
        id,
        userId,
        isEnabled: true,
        provider: {
          category: category as "LLM" | "IMAGE" | "VIDEO" | "TTS",
          isActive: true,
        },
      },
      include: { provider: true },
    });
    invariant(
      row && row.selectedModel,
      404,
      "CONFIG_UNAVAILABLE",
      "所选模型配置不存在、已停用或未选模型"
    );
    rows.push(row);
  }
  return {
    fingerprint: stableHash(
      rows.map((r) => ({
        id: r.id,
        updatedAt: r.updatedAt,
        providerUpdatedAt: r.provider.updatedAt,
        model: r.selectedModel,
        protocol:
          r.apiProtocol ||
          r.provider.apiProtocol ||
          (r.provider.slug === "kling" ? "kling" : ""),
        base: r.customBaseUrl || r.provider.baseUrl,
        key: r.apiKey,
        iv: r.apiKeyIv,
        extra: r.extraConfig,
        auth: r.authType,
      }))
    ),
    models: rows.map((r) => ({
      id: r.id,
      category: r.provider.category,
      model: r.selectedModel!,
      protocol:
        r.apiProtocol ||
        r.provider.apiProtocol ||
        (r.provider.slug === "kling" ? "kling" : ""),
    })),
  };
}
export async function priceState() {
  const c = await getSystemConfigs();
  const tiers = await getVideoTierCosts();
  const prices = {
    image: Math.max(c.COST_IMAGE_NORMAL, c.COST_IMAGE_WITH_REF),
    tts: c.COST_TTS_PER_100_CHARS,
    tiers,
  };
  return { ...prices, fingerprint: stableHash(prices) };
}
async function insertRun(
  tx: Tx,
  userId: string,
  videoId: string,
  requestId: string,
  requestHash: string,
  plan: Plan,
  configFingerprint: string,
  priceFingerprint: string,
  maxCredits: number,
  scriptVersionId?: string
) {
  const run = await tx.svRun.create({
    data: {
      userId,
      videoId,
      requestId,
      requestHash,
      kind: plan.kind,
      scriptVersionId,
      plan: json(plan),
      planHash: stableHash(plan),
      configFingerprint,
      priceFingerprint,
      maxCredits,
    },
  });
  for (const step of plan.steps)
    await tx.svRunStep.create({
      data: {
        userId,
        runId: run.id,
        key: step.key,
        kind: step.kind,
        operationKey: `sv:${run.id}:${step.key}`,
        requestFingerprint: stableHash(step.input),
        estimatedCredits: step.cost,
        input: json(step.input),
      },
    });
  return { id: run.id };
}
export async function createScriptPlan(
  userId: string,
  videoId: string,
  raw: unknown
) {
  const input = ScriptRunZ.parse(raw);
  const replay = await replayReceipt(userId, `script-plan:${videoId}`, input);
  if (replay) return replay;
  const config = await configState(userId, { LLM: input.llmConfigId });
  const prices = await priceState();
  return receipt(userId, `script-plan:${videoId}`, input, async (tx) => {
    const video = await ownedVideo(userId, videoId, tx);
    await assertIdle(tx, videoId);
    invariant(
      video.version === input.expectedVideoVersion && !video.archivedAt
    );
    invariant(
      video.template?.enabled &&
        video.template.version === input.templateVersion,
      409,
      "TEMPLATE_CHANGED",
      "请选择当前模板版本"
    );
    const plan: Plan = {
      kind: "SCRIPT",
      videoVersion: video.version,
      snapshot: json(scriptSnapshot(video)),
      configIds: { LLM: input.llmConfigId },
      models: config.models,
      sceneMap: [],
      steps: [
        {
          key: "script:1",
          kind: "SCRIPT",
          cost: 0,
          input: { configId: input.llmConfigId },
        },
      ],
      upperBoundCredits: 0,
      supplierFees:
        "站内脚本积分为0；供应方可能收费，未取得账单。确认后仅调用一次，不自动修复。",
      ttsEnabled: false,
    };
    return insertRun(
      tx,
      userId,
      videoId,
      input.requestId,
      stableHash(input),
      plan,
      config.fingerprint,
      prices.fingerprint,
      0
    );
  });
}
export async function createRenderPlan(
  userId: string,
  videoId: string,
  raw: unknown
) {
  const input = RenderPlanZ.parse(raw);
  const replay = await replayReceipt(userId, `render-plan:${videoId}`, input);
  if (replay) return replay;
  const configIds: Record<string, string> = {
    IMAGE: input.modelConfigIds.image,
    VIDEO: input.modelConfigIds.video,
  };
  if (input.ttsEnabled) {
    invariant(
      input.modelConfigIds.tts,
      422,
      "TTS_CONFIG_REQUIRED",
      "配音开启时请选择语音配置"
    );
    configIds.TTS = input.modelConfigIds.tts;
  }
  const config = await configState(userId, configIds);
  const prices = await priceState();
  return receipt(userId, `render-plan:${videoId}`, input, async (tx) => {
    let video = await ownedVideo(userId, videoId, tx);
    await assertIdle(tx, videoId);
    invariant(!video.archivedAt);
    const version = await tx.svScriptVersion.findFirst({
      where: { id: input.scriptVersionId, userId, videoId },
    });
    invariant(version, 404, "NOT_FOUND", "脚本版本不存在");
    const script = ScriptZ.parse(version.content);
    if (!video.projectId) {
      const project = await tx.project.create({
        data: {
          userId,
          title: video.title,
          description: "AI 抽象短视频专用项目",
          aspectRatio: "9:16",
        },
      });
      video = await tx.svVideo.update({
        where: { id: videoId },
        data: { projectId: project.id },
        include: { sources: { include: { source: true } }, template: true },
      });
    }
    invariant(
      await tx.project.findFirst({ where: { id: video.projectId!, userId } }),
      404,
      "NOT_FOUND",
      "关联项目不存在"
    );
    const project = await tx.project.findFirstOrThrow({
      where: { id: video.projectId!, userId },
    });
    const projectFingerprint = stableHash({
      style: project.style,
      aspectRatio: project.aspectRatio,
      generationParams: project.generationParams,
    });
    const vm = config.models.find((m) => m.category === "VIDEO")!;
    const capability = getVideoModelCapability(vm.protocol, vm.model);
    const steps: Plan["steps"] = [];
    const sceneMap: Plan["sceneMap"] = [];
    const estimatedDuration: number[] = [];
    const offset = await tx.scene.count({
      where: { projectId: video.projectId! },
    });
    for (const [i, shot] of script.shots.entries()) {
      const scene = await tx.scene.create({
        data: {
          projectId: video.projectId!,
          order: offset + i,
          description: shot.description,
          dialogue: shot.dialogue,
          narration: shot.narration,
          duration: shot.durationSec,
        },
      });
      sceneMap.push({
        key: shot.key,
        sceneId: scene.id,
        description: shot.description,
        dialogue: shot.dialogue,
        narration: shot.narration,
        duration: shot.durationSec,
        subtitle: shot.subtitle,
      });
      const characters = script.characters
        .filter((c) => shot.characterKeys.includes(c.key))
        .map((c) => `${c.name}：${c.appearance}`)
        .join("；");
      steps.push({
        key: `image:${shot.key}:1`,
        kind: "IMAGE",
        cost: prices.image,
        input: {
          sceneId: scene.id,
          prompt: `${shot.imagePrompt}\n原创角色设定：${characters}`.slice(
            0,
            6000
          ),
          configId: configIds.IMAGE,
        },
      });
      steps.push({
        key: `video:${shot.key}:1`,
        kind: "VIDEO",
        cost: estimateVideoCost(shot.durationSec, capability, prices.tiers),
        input: {
          sceneId: scene.id,
          prompt: shot.videoPrompt,
          duration: shot.durationSec,
          configId: configIds.VIDEO,
        },
      });
      estimatedDuration.push(
        planVideoSegments(shot.durationSec, capability).estimatedTotalSeconds
      );
      const text = [shot.dialogue, shot.narration].filter(Boolean).join("\n");
      if (input.ttsEnabled && text)
        steps.push({
          key: `tts:${shot.key}:1`,
          kind: "TTS",
          cost: Math.ceil(text.length / 100) * prices.tts,
          input: { sceneId: scene.id, text, configId: configIds.TTS },
        });
    }
    steps.push({ key: "compose:1", kind: "COMPOSE", cost: 0, input: {} });
    const upperBoundCredits = steps.reduce((n, s) => n + s.cost, 0);
    invariant(
      upperBoundCredits <= input.maxCredits,
      409,
      "BUDGET_EXCEEDED",
      `预计上限${upperBoundCredits}积分，超过预算`
    );
    const plan: Plan = {
      kind: "RENDER",
      videoVersion: video.version,
      scriptHash: version.contentHash,
      projectFingerprint,
      configIds,
      models: config.models,
      sceneMap,
      steps,
      upperBoundCredits,
      supplierFees:
        "供应方可能另行收费，未取得账单；积分预留仅约束本任务，不冻结账户余额。",
      ttsEnabled: input.ttsEnabled,
      estimatedDuration,
    };
    return insertRun(
      tx,
      userId,
      videoId,
      input.requestId,
      stableHash(input),
      plan,
      config.fingerprint,
      prices.fingerprint,
      input.maxCredits,
      version.id
    );
  });
}
