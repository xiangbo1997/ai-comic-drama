import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildComparePrompt,
  compareImagePairWithVision,
  parsePairIssues,
} from "@/services/agents/vision-reviewer";
import { buildContinuityReviewFingerprint } from "@/lib/review-freshness";
const config = {
  protocol: "openai" as const,
  model: "vision",
  apiKey: "test",
  baseUrl: "https://example.test/v1",
};
const args = {
  prevImageUrl: "https://example.test/a.png",
  nextImageUrl: "https://example.test/b.png",
  prevOrder: 1,
  nextOrder: 2,
  prevLocationKey: "门厅",
  nextLocationKey: "门厅",
  llmConfig: config,
};
afterEach(() => vi.unstubAllGlobals());
describe("实际图片场记中的道具与空间", () => {
  it("跨地点的空间建议即使模型返回也不进入修复队列", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                issues: [
                  {
                    dimension: "空间站位",
                    severity: "严重",
                    description: "画面位置不同",
                    fixNote: "移回左侧",
                  },
                  {
                    dimension: "道具状态",
                    severity: "中等",
                    description: "钥匙变形",
                    fixNote: "保留钥匙外形",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      await compareImagePairWithVision({ ...args, nextLocationKey: "街头" })
    ).toEqual([
      {
        dimension: "道具状态",
        severity: "中等",
        description: "钥匙变形",
        fixNote: "保留钥匙外形",
      },
    ]);
  });
  it("道具和站位问题保留可执行修复指令，进入现有报告合同", () => {
    const result = parsePairIssues(
      JSON.stringify({
        issues: [
          {
            dimension: "道具状态",
            severity: "严重",
            description: "钥匙无故换手",
            fixNote: "保持钥匙由阿宁右手持有",
          },
          {
            dimension: "空间站位",
            severity: "中等",
            description: "左右位置翻转",
            fixNote: "恢复阿宁左侧站位",
          },
        ],
      })
    );
    expect(result).toHaveLength(2);
    expect(result?.[0].fixNote).toContain("右手");
  });
  it("把实际动作/站位计划交给VLM，仅同地点检查轴线，不用字符串差异判失败", () => {
    const prompt = buildComparePrompt({
      ...args,
      prevDescription: "阿宁握钥匙",
      nextDescription: "阿宁将钥匙交给阿明",
      prevActionBeat: "向右递出钥匙",
      nextActionBeat: "接过钥匙",
      prevScreenSide: { 阿宁: "left" },
      nextScreenSide: { 阿宁: "left", 阿明: "right" },
    });
    expect(prompt).toContain("接过钥匙");
    expect(prompt).toContain("阿宁=left");
    expect(prompt).toContain("正常正反打");
    const different = buildComparePrompt({ ...args, nextLocationKey: "街头" });
    expect(different).toContain("不比较跨地点的空间站位");
  });
  it("真实VLM请求包含新增纪律和两张图，合法剧情交接由模型判断", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"issues":[]}' } }],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      await compareImagePairWithVision({
        ...args,
        prevActionBeat: "递钥匙",
        nextActionBeat: "接钥匙",
      })
    ).toEqual([]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("道具状态");
    expect(body.messages[0].content).toContain("空间站位");
    expect(
      body.messages[1].content.filter(
        (p: { type: string }) => p.type === "image_url"
      )
    ).toHaveLength(2);
  });
  it("视觉检查方法/动作/站位变更令旧报告失效，JSON键顺序不影响", () => {
    const scenes = [0, 1].map((order) => ({
      id: `s${order}`,
      order,
      imageUrl: `https://example.test/${order}.png`,
      actionBeat: "握钥匙",
      screenSide: { 阿宁: "left", 阿明: "right" },
    }));
    const fingerprint = buildContinuityReviewFingerprint(scenes);
    expect(
      buildContinuityReviewFingerprint(
        scenes.map((s) => ({ ...s, actionBeat: "交接钥匙" }))
      )
    ).not.toBe(fingerprint);
    expect(
      buildContinuityReviewFingerprint(
        scenes.map((s) => ({
          ...s,
          screenSide: { 阿宁: "right", 阿明: "left" },
        }))
      )
    ).not.toBe(fingerprint);
    expect(
      buildContinuityReviewFingerprint(
        scenes.map((s) => ({
          ...s,
          screenSide: { 阿明: "right", 阿宁: "left" },
        }))
      )
    ).toBe(fingerprint);
  });
});
