import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "@/services/ai";
import { StoryboardAgent } from "@/services/agents/storyboard-agent";
import { StoryboardArtifactZ } from "@/services/agents/schemas";
import type { ScriptArtifact, WorkflowContext } from "@/services/agents/types";

vi.mock("@/services/ai", () => ({
  chatCompletion: vi.fn(),
  LONG_FORM_LLM_TIMEOUT_MS: 1000,
}));

const source = (id: number) => ({
  id,
  shotType: "近景",
  description: `阿宁攥紧门把手，听见门外传来第${id}次敲击。`,
  characters: ["阿宁"],
  dialogue: "别开门。",
  narration: null,
  emotion: "fear",
  duration: 4,
  cameraAngle: "low-angle",
  lighting: "冷调侧光",
  composition: "前景遮挡",
  colorPalette: "蓝灰",
  cameraMovement: "zoom_in",
  actionBeat: "攥紧门把手",
  locationKey: "旧宅",
  linkNext: true,
  characterOutfits: [{ name: "阿宁", outfit: "蓝色风衣" }],
  screenSide: { 阿宁: "left" as const },
});
const output = (id: number) => ({
  id,
  order: id,
  shotType: "特写",
  description: "阿宁猛地按住门锁，瞳孔中映出一个陌生人影。",
  imagePrompt: "Close-up of a woman gripping the lock in cold blue lighting",
  characters: ["阿宁"],
  dialogue: "一二三四五六七八九十",
  narration: null,
  emotion: "fear",
  duration: 1,
});
const ctx = {
  config: { style: "anime" },
  emit: vi.fn(),
  workflowRunId: "wf",
} as unknown as WorkflowContext;
const input = (ids = [10, 20]) => ({
  script: {
    title: "旧宅来客",
    scenes: ids.map(source),
    characters: [],
  } as ScriptArtifact,
  characterBible: { characters: [] },
});

beforeEach(() => vi.clearAllMocks());

describe("分镜补全生产契约", () => {
  it.each([
    { locationKey: null, characterOutfits: [], screenSide: {} },
    { locationKey: 42, characterOutfits: null, screenSide: null },
    {
      locationKey: "另一地点",
      characterOutfits: [{ name: "阿宁", outfit: "红裙" }],
      screenSide: { 阿宁: "right" },
    },
  ])(
    "补全的空值、非法值或改写不能覆盖原剧本连续性设定：%j",
    async (metadata) => {
      vi.mocked(chatCompletion).mockResolvedValue(
        JSON.stringify({ scenes: [{ ...output(10), ...metadata }] })
      );
      const result = await new StoryboardAgent().run(input([10]), ctx);
      expect(result.data?.scenes[0]).toEqual(
        expect.objectContaining({
          locationKey: "旧宅",
          characterOutfits: [{ name: "阿宁", outfit: "蓝色风衣" }],
          screenSide: { 阿宁: "left" },
        })
      );
    }
  );
  it("生产输出与共享节点schema一致，保留超过30秒的有效口播镜", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        scenes: [{ ...output(10), duration: 52, narration: "一".repeat(130) }],
      })
    );
    const result = await new StoryboardAgent().run(input([10]), ctx);
    expect(result.success).toBe(true);
    expect(StoryboardArtifactZ.safeParse(result.data).success).toBe(true);
    expect(result.data!.scenes[0].duration).toBeGreaterThanOrEqual(52);
  });
  it("恢复原镜序并规范媒体回写序号，保留导演元数据与口播下限", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({ scenes: [output(20), output(10)] })
    );
    const result = await new StoryboardAgent().run(input(), ctx);
    expect(result.success).toBe(true);
    expect(result.data?.scenes).toHaveLength(2);
    expect(result.data?.scenes.map((s) => [s.id, s.order])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(result.data?.scenes[0]).toEqual(
      expect.objectContaining({
        locationKey: "旧宅",
        cameraAngle: "low-angle",
        lighting: "冷调侧光",
        composition: "前景遮挡",
        colorPalette: "蓝灰",
        linkNext: true,
        actionBeat: "攥紧门把手",
        cameraMovement: "zoom_in",
        characterOutfits: [{ name: "阿宁", outfit: "蓝色风衣" }],
      })
    );
    expect(result.data!.scenes[0].duration).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["缺镜", [output(10)]],
    ["重复镜号", [output(10), output(10)]],
    ["多余镜号", [output(10), output(20), output(30)]],
    ["未知镜号", [output(10), output(99)]],
  ])("拒绝%s，重试后按原剧本降级，不能错配或丢镜", async (_label, scenes) => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ scenes }));
    const result = await new StoryboardAgent().run(input(), ctx);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(result.data?.scenes).toHaveLength(2);
    expect(result.data?.scenes.map((s) => s.description)).toEqual([
      source(10).description,
      source(20).description,
    ]);
    expect(result.data?.scenes[0]).toEqual(
      expect.objectContaining({ locationKey: "旧宅", linkNext: true })
    );
  });
});
