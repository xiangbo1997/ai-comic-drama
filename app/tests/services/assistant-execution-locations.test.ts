import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  scenes: vi.fn(),
  locations: vi.fn(),
  location: vi.fn(),
  upsert: vi.fn(),
  updateLocation: vi.fn(),
  user: vi.fn(),
  config: vi.fn(),
  image: vi.fn(),
  llm: vi.fn(),
  safety: vi.fn(),
  charge: vi.fn(),
  cost: vi.fn(),
  task: vi.fn(),
  run: vi.fn(),
  updateScene: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.project },
    scene: { findMany: mocks.scenes, updateMany: mocks.updateScene },
    projectLocation: {
      findMany: mocks.locations,
      findFirst: mocks.location,
      upsert: mocks.upsert,
      updateMany: mocks.updateLocation,
    },
    user: { findUnique: mocks.user },
    userAIConfig: { findFirst: mocks.config },
    generationTask: { update: mocks.task, findFirst: mocks.run },
    $transaction: vi.fn(async (fn) =>
      fn({
        projectLocation: { updateMany: mocks.updateLocation },
        generationTask: { update: mocks.task },
        scene: { updateMany: mocks.updateScene },
      })
    ),
  },
}));
vi.mock("@/lib/ai-config", () => ({
  getUserLLMConfig: vi.fn(async () => ({ protocol: "openai" })),
  getUserImageConfig: vi.fn(async () => ({
    protocol: "openai",
    model: "image-test",
  })),
}));
vi.mock("@/services/ai", () => ({
  generateImage: mocks.image,
  chatCompletion: mocks.llm,
}));
vi.mock("@/lib/content-safety", () => ({
  contentSafetyMiddleware: mocks.safety,
}));
vi.mock("@/lib/credits", () => ({ chargeCredits: mocks.charge }));
vi.mock("@/lib/system-config", () => ({ getSystemConfig: mocks.cost }));
vi.mock("@/services/storage", () => ({
  isStorageConfigured: () => false,
  uploadFileFromUrl: vi.fn(),
}));
import { executeLocationTool } from "@/services/assistant-execution/tool-locations";
import type { AssistantActionInput } from "@/services/assistant-execution/tool-types";
const input: AssistantActionInput = {
  userId: "u",
  projectId: "p",
  runId: "r",
  operationKey: "op",
  kind: "location",
  targetId: "office",
  maxCost: 1,
  options: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({
    id: "p",
    style: "anime",
    aspectRatio: "9:16",
  });
  mocks.location.mockResolvedValue({
    id: "loc",
    locationKey: "office",
    description: "办公室",
    imageUrl: null,
  });
  mocks.scenes.mockResolvedValue([{ description: "办公桌前" }]);
  mocks.locations.mockResolvedValue([]);
  mocks.user.mockResolvedValue({ credits: 20 });
  mocks.config.mockResolvedValue({ id: "image" });
  mocks.safety.mockResolvedValue({ safe: true });
  mocks.cost.mockResolvedValue(1);
  mocks.run.mockResolvedValue({ output: { status: "running" } });
  mocks.image.mockResolvedValue("https://assets.example.test/plate.png");
  mocks.updateLocation.mockResolvedValue({ count: 1 });
  mocks.updateScene.mockResolvedValue({ count: 1 });
});
describe("自主执行场景工具", () => {
  const legacyScenes = () => [
    { id: "s1", order: 0, locationKey: "剑悬颈", description: "刑台：剑悬颈" },
    { id: "s2", order: 1, locationKey: "下令", description: "刑台：下令" },
  ];
  function legacyProject() {
    mocks.project.mockResolvedValue({
      id: "p",
      shortDramaScripts: [
        {
          scriptDoc: {
            scenes: legacyScenes().map((scene) => ({
              title: scene.locationKey,
              description: scene.description,
            })),
          },
        },
      ],
    });
    mocks.scenes.mockResolvedValue(legacyScenes());
  }
  it("旧标题地点重新按画面聚合成一个物理地点，不删除旧素材", async () => {
    legacyProject();
    mocks.llm
      .mockResolvedValueOnce(
        '[{"index":0,"locationKey":"宗门刑台"},{"index":1,"locationKey":"宗门刑台"}]'
      )
      .mockResolvedValueOnce(
        '[{"key":"宗门刑台","description":"高阶石台，青火铜炉"}]'
      );
    mocks.upsert.mockResolvedValue({ id: "canonical" });
    const result = await executeLocationTool(
      { ...input, kind: "prepare" },
      "task"
    );
    expect(result).toMatchObject({
      actualCost: 0,
      artifact: { locations: ["宗门刑台"], labeled: 2 },
    });
    expect(mocks.updateScene).toHaveBeenCalledTimes(2);
    expect(mocks.updateScene.mock.calls[0][0].where).toMatchObject({
      id: "s1",
      locationKey: "剑悬颈",
      order: 0,
    });
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });
  it.each([
    '[{"index":0,"locationKey":"宗门刑台"}]',
    '[{"index":0,"locationKey":"剑悬颈"},{"index":1,"locationKey":"下令"}]',
  ])("地点标注不完整或仍是标题时暂停，不继续描述或生图", async (raw) => {
    legacyProject();
    mocks.llm.mockResolvedValueOnce(raw);
    expect(
      await executeLocationTool({ ...input, kind: "prepare" }, "task")
    ).toMatchObject({ requiresReview: true, artifact: { locations: [] } });
    expect(mocks.updateScene).not.toHaveBeenCalled();
    expect(mocks.llm).toHaveBeenCalledTimes(1);
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("标注期间手动改地点，不用旧结果覆盖或继续生成", async () => {
    legacyProject();
    mocks.llm.mockResolvedValueOnce(
      '[{"index":0,"locationKey":"刑台"},{"index":1,"locationKey":"刑台"}]'
    );
    mocks.updateScene.mockResolvedValueOnce({ count: 0 });
    expect(
      await executeLocationTool({ ...input, kind: "prepare" }, "task")
    ).toMatchObject({ requiresReview: true, artifact: { locations: [] } });
    expect(mocks.llm).toHaveBeenCalledTimes(1);
  });
  it("孤立的旧地点行不再生成无对应分镜的参考图", async () => {
    mocks.scenes.mockResolvedValue([]);
    await expect(executeLocationTool(input, "task")).rejects.toThrow(
      /地点|计划/
    );
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("项目归属失败时不调用任何模型", async () => {
    mocks.project.mockResolvedValue(null);
    await expect(executeLocationTool(input, "task")).rejects.toThrow(
      /作品|项目/
    );
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.llm).not.toHaveBeenCalled();
  });
  it("背景已有图片则跳过，不收费或覆盖", async () => {
    mocks.location.mockResolvedValue({
      id: "loc",
      locationKey: "office",
      imageUrl: "old.png",
    });
    expect((await executeLocationTool(input, "task")).actualCost).toBe(0);
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });
  it("单价超过动作预留上限时不向上游提交", async () => {
    mocks.cost.mockResolvedValue(2);
    await expect(executeLocationTool(input, "task")).rejects.toThrow(
      /预算|费用/
    );
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("停止后不再向上游提交背景生成", async () => {
    mocks.run.mockResolvedValue({ output: { status: "stopped" } });
    expect(await executeLocationTool(input, "task")).toMatchObject({
      actualCost: 0,
      artifact: { stopped: true },
    });
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("准备地点期间停止，不继续调用下一次文字模型", async () => {
    mocks.scenes.mockResolvedValue([
      { id: "s", order: 0, description: "办公桌", locationKey: null },
    ]);
    mocks.llm.mockImplementation(async () => {
      mocks.run.mockResolvedValue({ output: { status: "stopping" } });
      return '[{"sceneId":"s","locationKey":"office"}]';
    });
    expect(
      await executeLocationTool({ ...input, kind: "prepare" }, "task")
    ).toMatchObject({ actualCost: 0, artifact: { stopped: true } });
    expect(mocks.llm).toHaveBeenCalledTimes(1);
  });
  it("成功生成时条件更新空背景并按同一任务记录扣费", async () => {
    const result = await executeLocationTool(input, "task");
    expect(result.actualCost).toBe(1);
    expect(mocks.updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "loc", imageUrl: null }),
      })
    );
    expect(mocks.charge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 1, userId: "u", sourceId: "task" })
    );
  });
  it("生成期间用户换了背景，保留新产物但不覆盖用户选择并请求暂停", async () => {
    mocks.updateLocation.mockResolvedValue({ count: 0 });
    const result = await executeLocationTool(input, "task");
    expect(result).toMatchObject({
      actualCost: 1,
      requiresReview: true,
      artifact: {
        imageUrl: "https://assets.example.test/plate.png",
        selected: false,
      },
    });
  });
});
