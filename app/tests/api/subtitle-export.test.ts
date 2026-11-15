import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildSubtitleSourceText } from "@/lib/subtitle-segments";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  project: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  synthesize: vi.fn(),
  draft: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: m.project, update: m.update },
    generationTask: { create: m.create, update: m.update },
  },
}));
vi.mock("@/lib/generation-concurrency", () => ({
  runWithGenerationSlot: (_: string, fn: () => unknown) => fn(),
}));
vi.mock("@/services/video-synthesis", () => ({
  synthesizeVideoToPath: m.synthesize,
}));
vi.mock("@/services/jianying-draft", () => ({
  assembleJianyingDraft: m.draft,
}));
vi.mock("@/services/storage", () => ({ uploadFileFromPath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { export: async () => ({ success: true }) },
  rateLimitHeaders: () => ({}),
}));
import { POST as exportVideo } from "@/app/api/projects/[id]/export/route";
import { POST as exportDraft } from "@/app/api/projects/[id]/draft-export/route";
const scenes = [
  {
    id: "s1",
    order: 0,
    duration: 3,
    imageUrl: "/uploads/image.png",
    videoUrl: null,
    audioUrl: "/uploads/audio.mp3",
    dialogue: "保留配音原文",
    narration: null,
  },
];
const project = (text: string) => ({
  id: "p1",
  title: "测试",
  aspectRatio: "9:16",
  seriesId: null,
  scenes,
  generationParams: { subtitleOverrides: [{ sceneId: "s1", text }] },
});
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.create.mockResolvedValue({ id: "task1" });
  m.synthesize.mockResolvedValue({ url: "/uploads/result.mp4", size: 10 });
  m.draft.mockResolvedValue({ zipUrl: "/uploads/draft.zip" });
});
describe("独立字幕导出贯穿", () => {
  it.each(["修正字幕", ""])("成片使用覆盖 %j，仍保留配音来源", async (text) => {
    m.project.mockResolvedValue(project(text));
    const response = await exportVideo(
      new NextRequest("http://local/api/projects/p1/export", {
        method: "POST",
        body: JSON.stringify({ sync: true }),
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(response.status).toBe(200);
    const [rendered] = m.synthesize.mock.calls[0][0];
    expect(buildSubtitleSourceText(rendered)).toBe(text);
    expect(rendered.audioUrl).toBe(scenes[0].audioUrl);
    expect(rendered.dialogue).toBe(scenes[0].dialogue);
  });
  it("剪映打包接收同一份已保存覆盖", async () => {
    m.project.mockResolvedValue(project("剪映字幕"));
    const response = await exportDraft(
      new NextRequest("http://local/api/projects/p1/draft-export", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(response.status).toBe(200);
    expect(m.draft).toHaveBeenCalledWith(
      expect.objectContaining({
        scenes,
        subtitleOverrides: [{ sceneId: "s1", text: "剪映字幕" }],
      })
    );
  });
});
