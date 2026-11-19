import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  scenes: vi.fn(),
  series: vi.fn(),
  run: vi.fn(),
  update: vi.fn(),
  compare: vi.fn(),
  capable: vi.fn(),
  video: vi.fn(),
  chat: vi.fn(),
  llm: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.project },
    scene: { findMany: mocks.scenes, updateMany: mocks.update },
    series: { findFirst: mocks.series },
    generationTask: { findFirst: mocks.run },
    $transaction: vi.fn(async (fn) =>
      fn({
        $queryRaw: vi.fn().mockResolvedValue([]),
        scene: { findMany: mocks.scenes, updateMany: mocks.update },
      })
    ),
  },
}));
vi.mock("@/lib/ai-config", () => ({
  getUserLLMConfig: mocks.llm,
  getUserVideoConfig: vi.fn(async () => ({
    protocol: "openai",
    model: "video",
  })),
}));
vi.mock("@/services/agents/vision-reviewer", () => ({
  compareImagePairWithVision: mocks.compare,
  supportsVisionReview: mocks.capable,
}));
vi.mock("@/services/ai", () => ({ chatCompletion: mocks.chat }));
vi.mock("@/services/ai/video-capabilities", () => ({
  getVideoModelCapability: mocks.video,
}));
import { executeReviewTool } from "@/services/assistant-execution/tool-review";
import { buildAssistantReviewFingerprint } from "@/services/assistant-execution/review-fingerprint";
import type { AssistantActionInput } from "@/services/assistant-execution/tool-types";
const input: AssistantActionInput = {
  userId: "u",
  projectId: "p",
  runId: "r",
  operationKey: "op",
  kind: "inspect",
  maxCost: 0,
  options: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: "p", style: "anime", seriesId: null });
  mocks.scenes.mockResolvedValue(
    [0, 1].map((i) => ({
      id: `s${i}`,
      order: i,
      imageUrl: `https://assets.example.test/${i}.png`,
      locationKey: "office",
      description: "办公室对话",
      characterOutfits: [],
      sceneCharacters: [],
      videoLinkNext: false,
      videoUrl: null,
    }))
  );
  mocks.llm.mockResolvedValue({ protocol: "openai", model: "vision" });
  mocks.capable.mockReturnValue(true);
  mocks.run.mockResolvedValue({ output: { status: "running" } });
  mocks.compare.mockResolvedValue([]);
  mocks.video.mockReturnValue({ supportsFirstLastFrame: true });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.chat.mockResolvedValue('[{"pair":0,"reason":"连续动作"}]');
});
describe("自主执行视觉检查与衔接", () => {
  it("道具与站位上下文传入实际检查，严重道具问题进入原修复队列", async () => {
    const scenes = (await mocks.scenes()).map((s: object) => ({
      ...s,
      actionBeat: "保持右手钥匙",
      screenSide: { 阿宁: "left" },
    }));
    mocks.scenes.mockResolvedValue(scenes);
    mocks.compare.mockResolvedValue([
      {
        dimension: "道具状态",
        severity: "严重",
        description: "钥匙换手",
        fixNote: "恢复右手钥匙",
      },
      {
        dimension: "空间站位",
        severity: "中等",
        description: "站位不一致",
        fixNote: "保持画面左侧",
      },
    ]);
    const result = await executeReviewTool(input, "task");
    expect(mocks.compare).toHaveBeenCalledWith(
      expect.objectContaining({
        prevActionBeat: "保持右手钥匙",
        nextActionBeat: "保持右手钥匙",
        prevScreenSide: { 阿宁: "left" },
        nextScreenSide: { 阿宁: "left" },
      })
    );
    expect(result.issues).toEqual([
      { sceneId: "s1", anchorSceneId: "s0", note: "恢复右手钥匙" },
    ]);
  });
  it("检查指纹忽略自己的视频/衔接写入，但手动换图或改设定必须失效", async () => {
    const scenes = await mocks.scenes();
    const fingerprint = buildAssistantReviewFingerprint(
      "anime",
      null,
      scenes,
      "u"
    );
    expect(
      buildAssistantReviewFingerprint(
        "anime",
        null,
        scenes.map((scene: object) => ({
          ...scene,
          videoUrl: "generated.mp4",
          videoLinkNext: true,
        })),
        "u"
      )
    ).toBe(fingerprint);
    expect(
      buildAssistantReviewFingerprint(
        "anime",
        null,
        scenes.map((scene: object) => ({ ...scene, imageUrl: "manual.png" })),
        "u"
      )
    ).not.toBe(fingerprint);
    expect(
      buildAssistantReviewFingerprint("realistic", null, scenes, "u")
    ).not.toBe(fingerprint);
  });
  it("严重问题按镜头合并成一次修复，中等问题只报告", async () => {
    mocks.compare.mockResolvedValue([
      {
        dimension: "角色服装",
        severity: "严重",
        description: "衣服变化",
        fixNote: "保留黑衣",
      },
      {
        dimension: "发型",
        severity: "严重",
        description: "发型变化",
        fixNote: "保持短发",
      },
      {
        dimension: "光线",
        severity: "中等",
        description: "略暗",
        fixNote: "调亮",
      },
    ]);
    expect((await executeReviewTool(input, "task")).issues).toEqual([
      { sceneId: "s1", anchorSceneId: "s0", note: "保留黑衣；保持短发" },
    ]);
  });
  it("视觉未真正检查成功时请求暂停，不伪报无问题", async () => {
    mocks.compare.mockResolvedValue(null);
    expect(await executeReviewTool(input, "task")).toMatchObject({
      requiresReview: true,
      artifact: { report: { grade: null, checkedPairs: 0 } },
    });
  });
  it("检查中手动改图使报告过期，暂停且不据旧图修复", async () => {
    const original = await mocks.scenes();
    mocks.scenes
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(
        original.map((scene: { id: string }) =>
          scene.id === "s1" ? { ...scene, imageUrl: "new-manual.png" } : scene
        )
      );
    expect(await executeReviewTool(input, "task")).toMatchObject({
      requiresReview: true,
      issues: [],
      artifact: { stale: true },
    });
  });
  it("下一镜手动改图后不应用旧衔接建议", async () => {
    const original = await mocks.scenes();
    mocks.scenes
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(
        original.map((scene: { id: string }) =>
          scene.id === "s1" ? { ...scene, imageUrl: "new-manual.png" } : scene
        )
      );
    expect(
      await executeReviewTool({ ...input, kind: "links" }, "task")
    ).toMatchObject({ requiresReview: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("停止状态下不再启动下一对视觉调用", async () => {
    mocks.run.mockResolvedValue({ output: { status: "stopping" } });
    expect(await executeReviewTool(input, "task")).toMatchObject({
      requiresReview: true,
    });
    expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("模型不支持首尾帧则不调用衔接LLM或修改开关", async () => {
    mocks.video.mockReturnValue({ supportsFirstLastFrame: false });
    expect(
      (await executeReviewTool({ ...input, kind: "links" }, "task")).actualCost
    ).toBe(0);
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("同地连续镜才应用，且仅对未生成视频的原始镜头条件更新", async () => {
    const result = await executeReviewTool({ ...input, kind: "links" }, "task");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "s0",
          projectId: "p",
          videoUrl: null,
          imageUrl: "https://assets.example.test/0.png",
          videoLinkNext: false,
        }),
        data: { videoLinkNext: true },
      })
    );
    expect(result.actualCost).toBe(0);
  });
});
