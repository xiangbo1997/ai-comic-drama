import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatCompletion } from "@/services/ai";
import { GET } from "@/app/api/projects/[id]/review-report/route";
import {
  buildNarrativeReviewFingerprint,
  buildContinuityReviewFingerprint,
  resolveContinuityReviewPalette,
} from "@/lib/review-freshness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    scene: { findMany: vi.fn() },
    shortDramaScript: { findFirst: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    generationTask: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/ai", () => ({ chatCompletion: vi.fn() }));

const source = [
  {
    id: "a",
    order: 1,
    duration: 3,
    shotType: "特写",
    emotion: "fear",
    description: "阿宁紧握钥匙，门锁突然转动。",
    dialogue: "别开门！",
    narration: null,
    imageUrl: "/uploads/a.png",
    videoUrl: null,
    audioUrl: null,
    videoLinkNext: false,
    beatType: "reveal",
    isClimax: false,
    cameraMovement: "zoom_in",
    actionBeat: "紧握钥匙",
    locationKey: "门厅",
    selectedCharacterIds: ["char-a"],
    selectedCharacter: { name: "阿宁" },
    sceneCharacters: [{ character: { name: "阿宁" } }],
    characterOutfits: null,
  },
  {
    id: "b",
    order: 2,
    duration: 3,
    shotType: "近景",
    emotion: "surprised",
    description: "门外的黑影抬起手，钥匙落地。",
    dialogue: null,
    narration: null,
    imageUrl: "/uploads/b.png",
    videoUrl: null,
    audioUrl: null,
    videoLinkNext: false,
    beatType: "impact",
    isClimax: true,
    cameraMovement: null,
    actionBeat: "抬起手",
    locationKey: "门厅",
    selectedCharacterIds: [],
    selectedCharacter: null,
    sceneCharacters: [],
    characterOutfits: null,
  },
];
const narrativeFingerprint = buildNarrativeReviewFingerprint(
  source.map((s) => ({
    ...s,
    characters: s.sceneCharacters.map(({ character }) => character.name),
  }))
);
const visualFingerprint = buildContinuityReviewFingerprint(
  source.map((s) => ({
    ...s,
    characterNames: s.sceneCharacters.map(({ character }) => character.name),
    outfitNotes: [],
  })),
  resolveContinuityReviewPalette("anime", null)
);

const params = { params: Promise.resolve({ id: "owned" }) };
const get = () =>
  GET(
    new NextRequest("http://localhost/api/projects/owned/review-report"),
    params
  );
const section = async (key: string) => {
  const response = await get();
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.report.sections.find(
    (value: { key: string }) => value.key === key
  );
};
const history = (fingerprint?: string) => [
  {
    artifacts: {
      "review:storyboard": {
        data: {
          score: 95,
          pass: true,
          passThreshold: 70,
          inputFingerprint: fingerprint,
          feedback: "本版叙事成立",
          suggestions: [],
        },
      },
    },
  },
];
const continuity = (fingerprint?: string, userId = "owner") => ({
  input: { kind: "continuity_check", userId, inputFingerprint: fingerprint },
  output: {
    report: {
      grade: "A",
      summary: "本版画面连贯",
      checkedPairs: 1,
      issues: [],
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "owned",
    seriesId: null,
    style: "anime",
    generationParams: {},
    series: null,
    characters: [{ character: { id: "char-a", name: "阿宁" } }],
  } as never);
  vi.mocked(prisma.scene.findMany).mockResolvedValue(source as never);
  vi.mocked(prisma.shortDramaScript.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.workflowRun.findMany).mockResolvedValue(
    history(narrativeFingerprint) as never
  );
  vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
    continuity(visualFingerprint) as never
  );
});

describe("审片报告只复用对应当前输入的历史结果", () => {
  it("未登录不读项目或报告", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await get()).status).toBe(401);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.scene.findMany).not.toHaveBeenCalled();
  });
  it("其他用户项目返回404，不泄漏历史结果", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "owned", userId: "owner" } })
    );
    expect(prisma.workflowRun.findMany).not.toHaveBeenCalled();
  });
  it("输入未变时保留实际高分，并且不重复调用模型", async () => {
    expect((await section("narrative")).lines.join(" ")).toContain("95 / 100");
    expect((await section("continuity")).status).toBe("ok");
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "owned", userId: "owner" },
      })
    );
    expect(chatCompletion).not.toHaveBeenCalled();
  });
  it("改台词后叙事分数失效，不把旧高分显示为当前通过", async () => {
    vi.mocked(prisma.scene.findMany).mockResolvedValue([
      { ...source[0], dialogue: "钥匙是假的。" },
      source[1],
    ] as never);
    const result = await section("narrative");
    expect(result.status).toBe("warn");
    expect(result.lines.join(" ")).toContain("已过期");
    expect(result.lines.join(" ")).not.toContain("95 / 100");
  });
  it("仅换图片让视觉体检过期，保留仍对应当前文本的叙事评分", async () => {
    vi.mocked(prisma.scene.findMany).mockResolvedValue([
      { ...source[0], imageUrl: "/uploads/new.png" },
      source[1],
    ] as never);
    expect((await section("continuity")).lines.join(" ")).toContain("已过期");
    expect((await section("narrative")).lines.join(" ")).toContain("95 / 100");
  });
  it("旧数据无输入指纹时显示无法核验，而非有效通过", async () => {
    vi.mocked(prisma.workflowRun.findMany).mockResolvedValue(
      history() as never
    );
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      continuity() as never
    );
    expect((await section("narrative")).lines.join(" ")).toContain("无法核验");
    expect((await section("continuity")).lines.join(" ")).toContain("无法核验");
  });
  it("仅生成音轨不让文本或图片体检过期", async () => {
    vi.mocked(prisma.scene.findMany).mockResolvedValue([
      { ...source[0], audioUrl: "/uploads/audio.mp3" },
      source[1],
    ] as never);
    expect((await section("narrative")).status).toBe("ok");
    expect((await section("continuity")).status).toBe("ok");
  });
  it("修改成片倍速使原速度的叙事评审失效", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "owned",
      seriesId: null,
      style: "anime",
      series: null,
      generationParams: { sceneEffects: [{ sceneId: "a", speed: 2 }] },
      characters: [{ character: { id: "char-a", name: "阿宁" } }],
    } as never);
    expect((await section("narrative")).lines.join(" ")).toContain("已过期");
    expect((await section("continuity")).status).toBe("ok");
  });
  it("任务输入归属不符时不返回该视觉摘要", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      continuity(visualFingerprint, "intruder") as never
    );
    expect((await section("continuity")).lines.join(" ")).toContain("尚未运行");
  });
});
