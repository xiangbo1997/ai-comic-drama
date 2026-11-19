import { prisma } from "@/lib/prisma";
import {
  ScriptSaveZ,
  ScriptZ,
  type SvScript,
} from "@/lib/short-video/contracts";
import { invariant } from "@/lib/short-video/errors";
import { stableHash } from "@/lib/short-video/hash";
import { receipt, ownedVideo, assertIdle, json, type Tx } from "./store";
export function scriptSnapshot(video: Awaited<ReturnType<typeof ownedVideo>>) {
  return {
    title: video.title,
    brief: video.brief,
    sources: video.sources.map(({ source }) => ({
      id: source.id,
      summary: source.summary,
      platform: source.platform,
      canonicalUrl: source.canonicalUrl,
      observedAt: source.observedAt,
    })),
    template: video.template
      ? {
          id: video.template.id,
          version: video.template.version,
          systemInstructions: video.template.systemInstructions,
          characterPreset: video.template.characterPreset,
          stylePreset: video.template.stylePreset,
        }
      : null,
  };
}
export async function insertScript(
  tx: Tx,
  userId: string,
  videoId: string,
  content: SvScript,
  inputSnapshot: unknown,
  origin: string,
  modelRef?: unknown
) {
  const video = await tx.svVideo.update({
    where: { id: videoId },
    data: { scriptCounter: { increment: 1 }, version: { increment: 1 } },
  });
  const script = await tx.svScriptVersion.create({
    data: {
      userId,
      videoId,
      version: video.scriptCounter,
      content: json(content),
      inputSnapshot: json(inputSnapshot),
      contentHash: stableHash(content),
      origin,
      ...(modelRef ? { modelRef: json(modelRef) } : {}),
    },
  });
  await tx.svVideo.update({
    where: { id: videoId },
    data: { currentScriptVersionId: script.id },
  });
  return script;
}
export async function saveScript(
  userId: string,
  videoId: string,
  raw: unknown
) {
  const input = ScriptSaveZ.parse(raw);
  const ref = await receipt(userId, `script:${videoId}`, input, async (tx) => {
    const video = await ownedVideo(userId, videoId, tx);
    await assertIdle(tx, videoId);
    invariant(
      video.version === input.expectedVideoVersion && !video.archivedAt
    );
    return {
      id: (
        await insertScript(
          tx,
          userId,
          videoId,
          ScriptZ.parse(input.content),
          scriptSnapshot(video),
          "MANUAL"
        )
      ).id,
    };
  });
  return prisma.svScriptVersion.findFirstOrThrow({
    where: { id: ref.id, userId },
  });
}
