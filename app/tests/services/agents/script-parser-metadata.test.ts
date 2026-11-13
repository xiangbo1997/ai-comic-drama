import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/ai", () => ({
  chatCompletion: vi.fn(),
  LONG_FORM_LLM_TIMEOUT_MS: 1000,
  isTruncatedOutputError: () => false,
}));
import { chatCompletion } from "@/services/ai";
import { ScriptParserAgent } from "@/services/agents/script-parser-agent";
import { ScriptArtifactZ } from "@/services/agents/schemas";
import type { WorkflowContext } from "@/services/agents/types";

const script = {
  title: "门外来客",
  characters: [{ name: "阿宁", description: "守护旧宅秘密的年轻女人" }],
  hookType: "危机",
  endingHook: "门锁被缓慢转开，阿宁握住最后一把钥匙。",
  scenes: [
    {
      id: 10,
      shotType: "近景",
      description: "阿宁将钥匙藏进袖口，紧盯着转动的门锁。",
      characters: ["阿宁"],
      dialogue: null,
      narration: null,
      emotion: "fear",
      duration: 3,
      locationKey: "旧宅",
      linkNext: true,
      screenSide: { 阿宁: "left" },
      characterOutfits: [{ name: "阿宁", outfit: "蓝色风衣" }],
      beatType: "reveal",
      isClimax: true,
    },
  ],
};
const ctx = {
  config: { style: "anime" },
  emit: vi.fn(),
} as unknown as WorkflowContext;
beforeEach(() => vi.clearAllMocks());

describe("自动解析生产schema", () => {
  it("解析后保留承诺的地点/衔接/换装/轴线/节拍与结尾钩子", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify(script));
    const result = await new ScriptParserAgent().run(
      { text: "阿宁守住旧宅，门外有人转动锁孔。" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        hookType: "危机",
        endingHook: script.endingHook,
      })
    );
    expect(result.data?.scenes[0]).toEqual(
      expect.objectContaining({
        locationKey: "旧宅",
        linkNext: true,
        screenSide: { 阿宁: "left" },
        characterOutfits: [{ name: "阿宁", outfit: "蓝色风衣" }],
        beatType: "reveal",
        isClimax: true,
      })
    );
  });

  it("共享schema接受实际支持的60秒内长口播，不在节点边界截为30秒", async () => {
    const long = {
      ...script,
      scenes: [
        { ...script.scenes[0], narration: "一".repeat(130), duration: 52 },
      ],
    };
    expect(ScriptArtifactZ.safeParse(long).success).toBe(true);
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify(long));
    const result = await new ScriptParserAgent().run(
      { text: "阿宁叙述旧宅往事。" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data?.scenes[0].duration).toBeGreaterThanOrEqual(52);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
