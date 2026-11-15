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
});
