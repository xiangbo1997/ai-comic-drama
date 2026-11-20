import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: async () => ({ success: true }) },
  rateLimitHeaders: () => ({}),
}));
import { POST } from "@/app/api/short-videos/[...path]/route";
import { prisma } from "@/lib/prisma";
import { createVideo, videoDetail } from "@/services/short-video/store";
import { saveScript } from "@/services/short-video/scripts";
import { openVideoEditor } from "@/services/short-video/editor";
import { script } from "../fixtures/short-video";

const users: string[] = [];
let userId: string;
let otherUserId: string;
beforeAll(async () => {
  vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@editor.example.test`, role: "ADMIN" },
    });
    users.push(user.id);
  }
  [userId, otherUserId] = users;
});
afterAll(async () => {
  await prisma.svRequestReceipt.deleteMany({
    where: { userId: { in: users } },
  });
  await prisma.svVideo.updateMany({
    where: { userId: { in: users } },
    data: { currentScriptVersionId: null, projectId: null },
  });
  await prisma.svScriptVersion.deleteMany({ where: { userId: { in: users } } });
  await prisma.svVideo.deleteMany({ where: { userId: { in: users } } });
  await prisma.project.deleteMany({ where: { userId: { in: users } } });
  await prisma.character.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  vi.unstubAllEnvs();
});
async function draft() {
  const video = await createVideo(userId, {
    requestId: randomUUID(),
    title: "仙门短片",
    brief: "完整参考简报与来源",
    sourceIds: [],
  });
  const content = {
    ...script,
    shots: [
      {
        ...script.shots[0],
        dialogue: "今日御剑？",
        narration: "第一天",
        videoPrompt: "推近，拿扫帚",
      },
    ],
  };
  const saved = await saveScript(userId, video.id, {
    requestId: randomUUID(),
    expectedVideoVersion: video.version,
    content,
  });
  const latest = await videoDetail(userId, video.id);
  return {
    video,
    saved,
    input: {
      requestId: randomUUID(),
      expectedVideoVersion: latest.version,
      scriptVersionId: saved.id,
    },
  };
}
describe("short video reuses the existing editor", () => {
  it("uses the authenticated same-origin API and refuses foreign/invalid requests", async () => {
    const { video, input } = await draft();
    const call = (origin: string, body: unknown) =>
      POST(
        new NextRequest(
          `https://example.test/api/short-videos/videos/${video.id}/editor`,
          {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        ),
        { params: Promise.resolve({ path: ["videos", video.id, "editor"] }) }
      );
    mocks.auth.mockResolvedValue({ user: { id: userId } });
    expect((await call("https://evil.test", input)).status).toBe(403);
    expect(
      (await call("https://example.test", { ...input, unexpected: true }))
        .status
    ).toBe(422);
    mocks.auth.mockResolvedValue({ user: { id: otherUserId } });
    expect((await call("https://example.test", input)).status).toBe(404);
    mocks.auth.mockResolvedValue({ user: { id: userId } });
    const response = await call("https://example.test", input);
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("id");
  });
  it("transfers the saved script, role references, prompts, timing and independent subtitles without generation", async () => {
    const { video, input } = await draft();
    const result = await openVideoEditor(userId, video.id, input);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: result.id },
      include: { scenes: true, characters: { include: { character: true } } },
    });
    expect(project.userId).toBe(userId);
    expect(project.aspectRatio).toBe("9:16");
    expect(project.inputText).toContain("完整参考简报与来源");
    expect(project.scenes[0]).toMatchObject({
      duration: 15,
      dialogue: "今日御剑？",
      narration: "第一天",
      actionBeat: "推近，拿扫帚",
      imageUrl: null,
      videoUrl: null,
    });
    expect(project.scenes[0].description).toContain(
      script.shots[0].imagePrompt
    );
    expect(project.characters[0].character).toMatchObject({
      name: "水豚",
      description: "蓝色工牌",
    });
    expect(project.scenes[0].selectedCharacterIds).toEqual([
      project.characters[0].characterId,
    ]);
    expect(project.generationParams).toMatchObject({
      subtitleOverrides: [{ sceneId: project.scenes[0].id, text: "午休" }],
    });
    expect(await prisma.svRun.count({ where: { videoId: video.id } })).toBe(0);
  });
  it("serializes concurrent clicks and opens an existing project without overwriting editor changes", async () => {
    const { video, input } = await draft();
    const results = await Promise.all([
      openVideoEditor(userId, video.id, input),
      openVideoEditor(userId, video.id, { ...input, requestId: randomUUID() }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const scene = await prisma.scene.findFirstOrThrow({
      where: { projectId: results[0].id },
    });
    await prisma.scene.update({
      where: { id: scene.id },
      data: { description: "编辑器内精调" },
    });
    await openVideoEditor(userId, video.id, input);
    await openVideoEditor(userId, video.id, {
      ...input,
      requestId: randomUUID(),
    });
    expect(
      await prisma.scene.count({ where: { projectId: results[0].id } })
    ).toBe(1);
    expect(
      (await prisma.scene.findUniqueOrThrow({ where: { id: scene.id } }))
        .description
    ).toBe("编辑器内精调");
  });
  it("supports empty scenes without roles and keeps an explicit empty subtitle", async () => {
    const { video, saved, input } = await draft();
    await prisma.svScriptVersion.update({
      where: { id: saved.id },
      data: {
        content: {
          ...script,
          characters: [],
          shots: [{ ...script.shots[0], characterKeys: [], subtitle: "" }],
        },
      },
    });
    const result = await openVideoEditor(userId, video.id, input);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: result.id },
      include: { scenes: true, characters: true },
    });
    expect(project.characters).toHaveLength(0);
    expect(project.scenes[0]).toMatchObject({
      selectedCharacterId: null,
      selectedCharacterIds: [],
    });
    expect(project.generationParams).toMatchObject({
      subtitleOverrides: [{ sceneId: project.scenes[0].id, text: "" }],
    });
  });
  it("rejects a stale version, another user's video, and a script from another video", async () => {
    const a = await draft();
    const b = await draft();
    await expect(
      openVideoEditor(userId, a.video.id, {
        ...a.input,
        expectedVideoVersion: 1,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      openVideoEditor(otherUserId, a.video.id, a.input)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      openVideoEditor(userId, a.video.id, {
        ...a.input,
        scriptVersionId: b.saved.id,
      })
    ).rejects.toMatchObject({ status: 404 });
    expect((await videoDetail(userId, a.video.id)).projectId).toBeNull();
  });
  it("rejects archived works and rolls back project and characters on invalid script", async () => {
    const a = await draft();
    await prisma.svVideo.update({
      where: { id: a.video.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      openVideoEditor(userId, a.video.id, a.input)
    ).rejects.toMatchObject({ status: 409 });
    const b = await draft();
    await prisma.svScriptVersion.update({
      where: { id: b.saved.id },
      data: { content: {} },
    });
    const count = await prisma.project.count({ where: { userId } });
    await expect(
      openVideoEditor(userId, b.video.id, b.input)
    ).rejects.toThrow();
    expect(await prisma.project.count({ where: { userId } })).toBe(count);
    expect((await videoDetail(userId, b.video.id)).projectId).toBeNull();
  });
});
