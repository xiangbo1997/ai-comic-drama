import { prisma } from "@/lib/prisma";
import { RequestZ, ScriptZ } from "@/lib/short-video/contracts";
import { buildCreationPrompt } from "@/lib/short-video/creation";
import { invariant } from "@/lib/short-video/errors";
import { z } from "zod";
import { receipt, ownedVideo, assertIdle } from "./store";

const EditorInputZ = RequestZ.extend({
  scriptVersionId: z.string().min(1).max(100),
  expectedVideoVersion: z.number().int().positive(),
}).strict();

/** 只在首次创建时拷贝脚本；已有编辑器项目可能已被精调，绝不隐式覆盖。 */
export async function openVideoEditor(
  userId: string,
  videoId: string,
  raw: unknown
) {
  const input = EditorInputZ.parse(raw);
  const result = await receipt(
    userId,
    `editor:${videoId}`,
    input,
    async (tx) => {
      const video = await ownedVideo(userId, videoId, tx);
      invariant(
        !video.archivedAt && video.version === input.expectedVideoVersion
      );
      if (video.projectId) return { id: video.projectId };
      await assertIdle(tx, videoId);
      const version = await tx.svScriptVersion.findFirst({
        where: { id: input.scriptVersionId, userId, videoId },
      });
      invariant(version, 404, "NOT_FOUND", "脚本版本不存在");
      const script = ScriptZ.parse(version.content);
      const project = await tx.project.create({
        data: {
          userId,
          title: script.title,
          description: script.premise,
          aspectRatio: "9:16",
          inputText: buildCreationPrompt({
            title: video.title,
            brief: video.brief,
            scriptText: JSON.stringify(script),
          }).text,
        },
      });
      const characters = new Map<string, string>();
      for (const role of script.characters) {
        const character = await tx.character.create({
          data: {
            userId,
            name: role.name,
            description: role.appearance,
            referenceImages: [],
            projects: { create: { projectId: project.id } },
          },
        });
        characters.set(role.key, character.id);
      }
      const subtitles = [];
      for (const [order, shot] of script.shots.entries()) {
        const ids = [
          ...new Set(shot.characterKeys.map((key) => characters.get(key)!)),
        ];
        const scene = await tx.scene.create({
          data: {
            projectId: project.id,
            order,
            duration: shot.durationSec,
            description: `${shot.description}\n首帧画面：${shot.imagePrompt}`,
            actionBeat: shot.videoPrompt,
            dialogue: shot.dialogue,
            narration: shot.narration,
            selectedCharacterId: ids[0] ?? null,
            selectedCharacterIds: ids,
            sceneCharacters: {
              create: ids.map((characterId) => ({ characterId })),
            },
          },
        });
        subtitles.push({ sceneId: scene.id, text: shot.subtitle });
      }
      await tx.project.update({
        where: { id: project.id },
        data: { generationParams: { subtitleOverrides: subtitles } },
      });
      await tx.svVideo.update({
        where: { id: videoId },
        data: { projectId: project.id },
      });
      return { id: project.id };
    }
  );
  invariant(
    await prisma.project.findFirst({ where: { id: result.id, userId } }),
    404,
    "NOT_FOUND",
    "关联项目不存在"
  );
  return result;
}
