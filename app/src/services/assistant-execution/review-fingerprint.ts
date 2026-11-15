import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const REVIEW_SCENE_SELECT = {
  id: true,
  order: true,
  imageUrl: true,
  locationKey: true,
  description: true,
  actionBeat: true,
  emotion: true,
  dialogue: true,
  narration: true,
  cameraMovement: true,
  videoUrl: true,
  videoLinkNext: true,
  characterOutfits: true,
  sceneCharacters: {
    select: { character: { select: { name: true, userId: true } } },
  },
} satisfies Prisma.SceneSelect;
type ReviewScene = Prisma.SceneGetPayload<{
  select: typeof REVIEW_SCENE_SELECT;
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

export function buildAssistantReviewFingerprint(
  style: string,
  bible: unknown,
  scenes: ReviewScene[],
  userId: string
): string {
  // 视频落库和自动衔接不改变画面检查依据，避免后续步骤使自己的检查失效。
  const inputs = scenes.map(
    ({
      videoUrl: _video,
      videoLinkNext: _link,
      sceneCharacters,
      ...scene
    }) => ({
      ...scene,
      sceneCharacters: sceneCharacters
        .filter((item) => item.character.userId === userId)
        .map((item) => item.character.name)
        .sort(),
    })
  );
  return createHash("sha256")
    .update(JSON.stringify(canonical({ style, bible, scenes: inputs })))
    .digest("hex");
}

export async function readAssistantReviewFingerprint(
  userId: string,
  projectId: string
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { style: true, seriesId: true },
  });
  if (!project) throw new Error("当前集不存在或无权访问");
  const bible = project.seriesId
    ? ((
        await prisma.series.findFirst({
          where: { id: project.seriesId, userId },
          select: { storyBible: true },
        })
      )?.storyBible ?? null)
    : null;
  const scenes = await prisma.scene.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    take: 101,
    select: REVIEW_SCENE_SELECT,
  });
  return buildAssistantReviewFingerprint(project.style, bible, scenes, userId);
}
