import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/projects/[id]/continuity-check/route";
import {
  buildContinuityReviewFingerprint,
  resolveContinuityReviewPalette,
} from "@/lib/review-freshness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    scene: { findMany: vi.fn() },
    series: { findUnique: vi.fn() },
    generationTask: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/ai-config", () => ({
  getUserLLMConfig: vi.fn().mockResolvedValue({ protocol: "openai" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    imageGeneration: vi.fn().mockResolvedValue({ success: true }),
  },
  rateLimitHeaders: vi.fn(),
}));
vi.mock("@/services/agents/vision-reviewer", () => ({
  supportsVisionReview: vi.fn().mockReturnValue(true),
  compareImagePairWithVision: vi.fn().mockResolvedValue([]),
}));

const scenes = [
  {
    id: "a",
    order: 1,
    imageUrl: "/uploads/a.png",
    locationKey: "门厅",
    description: "阿宁握住钥匙，回头望向门外。",
    characterOutfits: [{ name: "阿宁", outfit: "雨衣" }],
    actionBeat: "右手握钥匙",
    screenSide: { 阿宁: "left" },
    sceneCharacters: [{ character: { name: "阿宁" } }],
  },
  {
    id: "b",
    order: 2,
    imageUrl: "/uploads/b.png",
    locationKey: "门厅",
    description: "她捂紧雨衣，目光停在黑影上。",
    characterOutfits: [],
    sceneCharacters: [{ character: { name: "阿宁" } }],
  },
];
const params = { params: Promise.resolve({ id: "owned" }) };
const post = () =>
  POST(
    new NextRequest("http://localhost/api/projects/owned/continuity-check", {
      method: "POST",
    }),
    params
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "owned",
    style: "anime",
    seriesId: null,
  } as never);
  vi.mocked(prisma.scene.findMany).mockResolvedValue(scenes as never);
  vi.mocked(prisma.generationTask.create).mockResolvedValue({
    id: "task",
  } as never);
  vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.generationTask.update).mockResolvedValue({} as never);
});

describe("场记任务记录实际送评输入版本", () => {
  it("建任务时记录图片、角色、剧情换装与色板指纹，无需再次视觉调用生成版本号", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const expected = buildContinuityReviewFingerprint(
      scenes.map((s) => ({
        ...s,
        characterNames: ["阿宁"],
        outfitNotes: s.id === "a" ? ["阿宁：雨衣"] : [],
      })),
      resolveContinuityReviewPalette("anime", null)
    );
    expect(prisma.generationTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "owned",
        cost: 0,
        input: {
          kind: "continuity_check",
          projectId: "owned",
          userId: "owner",
          inputFingerprint: expected,
        },
      }),
    });
  });
  it("未登录不创建任务，不写可混入其他用户的版本信息", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await post()).status).toBe(401);
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("没有相邻图片对时不建立空体检任务", async () => {
    vi.mocked(prisma.scene.findMany).mockResolvedValue([scenes[0]] as never);
    expect((await post()).status).toBe(400);
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
});
