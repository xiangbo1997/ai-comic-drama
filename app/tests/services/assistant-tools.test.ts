import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  scenes: vi.fn(),
  updateScene: vi.fn(),
  updateProject: vi.fn(),
  search: vi.fn(),
  plan: vi.fn(),
  latest: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.project, updateMany: mocks.updateProject },
    scene: { findMany: mocks.scenes, updateMany: mocks.updateScene },
  },
}));
vi.mock("@/services/assistant-web-search", () => ({
  searchAssistantWeb: mocks.search,
}));
vi.mock("@/services/assistant-execution/store", () => ({
  createAssistantExecution: mocks.plan,
  latestAssistantExecution: mocks.latest,
}));
import { createAssistantTools } from "@/services/assistant-tools";

const context = {
  userId: "u1",
  projectId: "p1",
  seriesId: null,
  requestId: "request-1",
};
const invoke = async (name: string, input: unknown, ctx = context) => {
  const { tools } = createAssistantTools(ctx);
  const selected = tools[name as keyof typeof tools];
  return selected.execute!(input as never, {
    toolCallId: "call",
    messages: [],
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: "p1", title: "当前剧" });
  mocks.updateScene.mockResolvedValue({ count: 1 });
  mocks.updateProject.mockResolvedValue({ count: 1 });
  mocks.scenes.mockResolvedValue([{ id: "scene-1", description: "开门" }]);
});
describe("项目助手工具", () => {
  it("分镜修改严格绑定当前用户与作品，并返回真实回执", async () => {
    const result = await invoke("update_scene", {
      sceneId: "scene-1",
      changes: { dialogue: "谁在门外？" },
    });
    expect(mocks.updateScene).toHaveBeenCalledWith({
      where: {
        id: "scene-1",
        projectId: "p1",
        project: { userId: "u1", seriesId: null },
      },
      data: { dialogue: "谁在门外？" },
    });
    expect(result).toMatchObject({ success: true });
  });
  it("拒绝模型夹带项目ID、素材URL与无字段更新", async () => {
    for (const input of [
      { sceneId: "x", projectId: "other", changes: { dialogue: "越权" } },
      { sceneId: "x", changes: { imageUrl: "https://evil.test" } },
      { sceneId: "x", changes: {} },
    ])
      await expect(invoke("update_scene", input)).rejects.toThrow();
    expect(mocks.updateScene).not.toHaveBeenCalled();
  });
  it("跨作品分镜或已移出系列的作品不返回修改成功", async () => {
    mocks.updateScene.mockResolvedValue({ count: 0 });
    await expect(
      invoke("update_scene", { sceneId: "other", changes: { dialogue: "x" } })
    ).rejects.toThrow();
    mocks.project.mockResolvedValue(null);
    await expect(invoke("read_project", { offset: 0 })).rejects.toThrow();
  });
  it("系列总览没有当前集时不能写入任意作品", async () => {
    await expect(
      invoke("update_project", { changes: { title: "新标题" } }, {
        ...context,
        projectId: undefined,
      } as unknown as typeof context)
    ).rejects.toThrow();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
  it("真实调用搜索并返回来源", async () => {
    mocks.search.mockResolvedValue({
      results: [{ title: "来源", url: "https://example.com", snippet: "资料" }],
    });
    expect(await invoke("web_search", { query: "镜头语言" })).toMatchObject({
      results: [{ title: "来源" }],
    });
    expect(mocks.search).toHaveBeenCalledWith("镜头语言", undefined);
  });
  it("可发现并读取项目创作技能，禁止目录穿越", async () => {
    const listing = await invoke("list_skills", {});
    expect(JSON.stringify(listing)).toContain("comic-drama-story");
    expect(
      JSON.stringify(await invoke("read_skill", { name: "comic-drama-story" }))
    ).toContain("三秒钩子");
    await expect(
      invoke("read_skill", { name: "../../.env" })
    ).rejects.toThrow();
  });
  it("制作计划复用本轮请求编号且不启动付费制作", async () => {
    mocks.plan.mockResolvedValue({ id: "run-1", status: "planned" });
    const result = await invoke("plan_production", {
      maxCredits: 100,
      generateVideos: false,
      maxRepairRounds: 1,
    });
    expect(result).toMatchObject({ id: "run-1", status: "planned" });
    expect(mocks.plan).toHaveBeenCalledWith(
      "u1",
      "request-1",
      "p1",
      expect.objectContaining({ maxCredits: 100 })
    );
  });
  it("保存当前作品并阻止归属变化后的写入", async () => {
    expect(
      await invoke("update_project", { changes: { title: "回声" } })
    ).toMatchObject({ success: true });
    expect(mocks.updateProject).toHaveBeenCalledWith({
      where: { id: "p1", userId: "u1", seriesId: null },
      data: { title: "回声" },
    });
    mocks.updateProject.mockResolvedValueOnce({ count: 0 });
    await expect(
      invoke("update_project", { changes: { title: "回声" } })
    ).rejects.toThrow();
  });
  it("按页读取真实分镜ID并限制超长资料", async () => {
    mocks.scenes.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        id: `scene-${index}`,
        order: index,
        description: "长".repeat(5000),
      }))
    );
    const result = await invoke("read_project", { offset: 20 });
    expect(result).toMatchObject({
      offset: 20,
      nextOffset: 40,
      truncated: true,
    });
    expect(JSON.stringify(result).length).toBeLessThan(18000);
    expect(mocks.scenes.mock.calls[0][0]).toMatchObject({
      where: { projectId: "p1", project: { userId: "u1", seriesId: null } },
      skip: 20,
      take: 20,
    });
    mocks.scenes.mockResolvedValue([]);
    expect(await invoke("read_project", {})).toMatchObject({
      nextOffset: null,
      truncated: false,
    });
  });
  it("读取本集真实制作状态，作品不存在时不查询任务", async () => {
    mocks.latest.mockResolvedValue({ status: "paused" });
    expect(await invoke("production_status", {})).toMatchObject({
      status: "paused",
    });
    expect(mocks.latest).toHaveBeenCalledWith("u1", "p1");
    mocks.project.mockResolvedValue(null);
    await expect(invoke("production_status", {})).rejects.toThrow();
    expect(mocks.latest).toHaveBeenCalledTimes(1);
  });
  it("串行保存，取消后不写入，供应商错误不会泄漏密钥", async () => {
    const { tools } = createAssistantTools(context);
    let finish!: () => void;
    mocks.updateProject.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ count: 1 });
        })
    );
    const options = { toolCallId: "call", messages: [] };
    const first = tools.update_project.execute!(
      { changes: { title: "一" } },
      options
    );
    const second = tools.update_project.execute!(
      { changes: { title: "二" } },
      options
    );
    await vi.waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledTimes(1)
    );
    finish();
    await Promise.all([first, second]);
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
    await expect(
      tools.update_project.execute!(
        { changes: { title: "三" } },
        { ...options, abortSignal: AbortSignal.abort() }
      )
    ).rejects.toThrow();
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
    mocks.updateProject.mockRejectedValueOnce(
      new Error("api-key-should-never-leak")
    );
    await expect(
      tools.update_project.execute!({ changes: { title: "四" } }, options)
    ).rejects.toThrow(/^工具 update_project 未完成/);
  });
  it("限制一轮模型的工具总调用量", async () => {
    const { tools } = createAssistantTools(context);
    const options = { toolCallId: "call", messages: [] };
    for (let index = 0; index < 12; index++)
      await tools.read_project.execute!({ offset: 0 }, options);
    await expect(
      tools.read_project.execute!({ offset: 0 }, options)
    ).rejects.toThrow("上限");
    expect(mocks.scenes).toHaveBeenCalledTimes(12);
  });
});
