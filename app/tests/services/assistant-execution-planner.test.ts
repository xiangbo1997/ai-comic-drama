import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ project: vi.fn(), caps: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { project: { findFirst: mocks.project } },
}));
vi.mock("@/services/assistant-execution/tools", () => ({
  describeAssistantCapabilities: mocks.caps,
}));
import { buildAssistantExecutionPlan } from "@/services/assistant-execution/planner";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caps.mockResolvedValue({
    canInspect: true,
    canRepair: true,
    imageReady: true,
    videoReady: false,
    canLink: false,
    locationCost: 1,
    imageMaxCost: 3,
    videoCosts: {},
    configFingerprint: "f",
    models: {},
    warnings: [],
  });
});
describe("助手地点计划", () => {
  it("计划提前提示角色参考缺口及模型限制，不自动增加收费步骤", async () => {
    mocks.project.mockResolvedValue({
      id: "p",
      seriesId: null,
      locations: [{ locationKey: "门厅", imageUrl: "hall.png" }],
      shortDramaScripts: [],
      characters: [
        {
          character: {
            id: "c",
            name: "阿宁",
            canonicalImageUrl: null,
            referenceImages: [],
          },
        },
      ],
      scenes: [
        {
          id: "s",
          order: 0,
          locationKey: "门厅",
          imageUrl: null,
          selectedCharacterId: "c",
          selectedCharacterIds: ["missing"],
          sceneCharacters: [],
        },
      ],
    });
    mocks.caps.mockResolvedValue({
      ...(await mocks.caps()),
      supportsCharacterReferences: false,
    });
    const plan = await buildAssistantExecutionPlan("u", "p", {
      maxCredits: 100,
      maxRepairRounds: 0,
      generateVideos: false,
    });
    expect(plan.warnings.join(" ")).toContain("阿宁");
    expect(plan.warnings.join(" ")).toContain("不支持参考图");
    expect(plan.warnings.join(" ")).toContain("角色关联");
    expect(plan.steps.filter((s) => s.kind === "image")).toHaveLength(1);
    expect(plan.estimatedCredits).toBe(3);
  });
  it("旧动作标题先校准，不直接创建每镜一张参考图", async () => {
    const titles = ["剑悬颈", "玉简将焚", "下令"];
    mocks.project.mockResolvedValue({
      id: "p",
      seriesId: null,
      locations: [],
      characters: [],
      shortDramaScripts: [
        {
          scriptDoc: {
            scenes: titles.map((title) => ({
              title,
              description: `刑台：${title}`,
            })),
          },
        },
      ],
      scenes: titles.map((title, order) => ({
        id: `s${order}`,
        order,
        description: `刑台：${title}`,
        locationKey: title,
        imageUrl: "existing.png",
      })),
    });
    const plan = await buildAssistantExecutionPlan("u", "p", {
      maxCredits: 100,
      generateVideos: false,
      maxRepairRounds: 0,
    });
    expect(plan.steps.filter((step) => step.kind === "location")).toEqual([]);
    expect(plan.unlabeledLocationSlots).toBe(3);
    expect(plan.warnings.join(" ")).toMatch(/地点.*校准/);
    expect(plan.locationLabelsVersion).toBe(2);
  });
  it("有效地点按实际物理地点去重，已有参考图不重复生成", async () => {
    mocks.project.mockResolvedValue({
      id: "p",
      seriesId: null,
      characters: [],
      shortDramaScripts: [],
      locations: [{ locationKey: "走廊", imageUrl: "plate.png" }],
      scenes: ["刑台", "刑台", "走廊"].map((locationKey, order) => ({
        id: `s${order}`,
        order,
        locationKey,
        imageUrl: "existing.png",
      })),
    });
    const plan = await buildAssistantExecutionPlan("u", "p", {
      maxCredits: 100,
      generateVideos: false,
      maxRepairRounds: 0,
    });
    expect(
      plan.steps
        .filter((step) => step.kind === "location")
        .map((step) => step.targetId)
    ).toEqual(["刑台"]);
  });
  it("角色已有参考图或无需出图时不发缺图提示", async () => {
    mocks.project.mockResolvedValue({
      id: "p",
      seriesId: null,
      locations: [{ locationKey: "门厅", imageUrl: "hall.png" }],
      shortDramaScripts: [],
      characters: [
        {
          character: {
            id: "c",
            name: "阿宁",
            canonicalImageUrl: null,
            referenceImages: ["ref.png"],
          },
        },
      ],
      scenes: [
        {
          id: "s",
          order: 0,
          locationKey: "门厅",
          imageUrl: null,
          selectedCharacterId: "c",
          sceneCharacters: [],
        },
      ],
    });
    const plan = await buildAssistantExecutionPlan("u", "p", {
      maxCredits: 100,
      maxRepairRounds: 0,
      generateVideos: false,
    });
    expect(plan.warnings).toEqual([]);
    const project = await mocks.project();
    mocks.project.mockResolvedValue({
      ...project,
      characters: [],
      scenes: project.scenes.map((s: object) => ({
        ...s,
        imageUrl: "done.png",
      })),
    });
    expect(
      (
        await buildAssistantExecutionPlan("u", "p", {
          maxCredits: 100,
          maxRepairRounds: 0,
          generateVideos: false,
        })
      ).warnings
    ).toEqual([]);
  });
});
