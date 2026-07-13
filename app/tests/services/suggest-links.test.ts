import { describe, it, expect } from "vitest";
import {
  prefilterLinkCandidates,
  parseLinkSuggestOutput,
  buildLinkSuggestPrompt,
  type LinkCandidateScene,
  type LinkCandidatePair,
} from "@/services/suggest-links";

function scene(
  id: string,
  order: number,
  locationKey?: string | null
): LinkCandidateScene {
  return { id, order, locationKey, description: `镜${order}` };
}

describe("prefilterLinkCandidates", () => {
  it("同地点相邻对 → 保留为候选", () => {
    const scenes = [scene("a", 0, "客厅"), scene("b", 1, "客厅")];
    const pairs = prefilterLinkCandidates(scenes);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].scene.id).toBe("a");
    expect(pairs[0].nextScene.id).toBe("b");
  });

  it("异地点相邻对 → 排除（无需 LLM）", () => {
    const scenes = [scene("a", 0, "客厅"), scene("b", 1, "操场")];
    expect(prefilterLinkCandidates(scenes)).toHaveLength(0);
  });

  it("任一侧地点缺失 → 保留为候选（交给 LLM 判断）", () => {
    expect(
      prefilterLinkCandidates([scene("a", 0, null), scene("b", 1, "客厅")])
    ).toHaveLength(1);
    expect(
      prefilterLinkCandidates([scene("a", 0, "客厅"), scene("b", 1, undefined)])
    ).toHaveLength(1);
    expect(
      prefilterLinkCandidates([scene("a", 0, "  "), scene("b", 1, "客厅")])
    ).toHaveLength(1);
  });

  it("单个分镜 / 空项目 → 空数组", () => {
    expect(prefilterLinkCandidates([scene("a", 0, "客厅")])).toEqual([]);
    expect(prefilterLinkCandidates([])).toEqual([]);
  });

  it("乱序输入按 order 归一后配对", () => {
    const scenes = [
      scene("c", 2, "客厅"),
      scene("a", 0, "客厅"),
      scene("b", 1, "客厅"),
    ];
    const pairs = prefilterLinkCandidates(scenes);
    // 3 个同地点分镜 → 两对相邻候选：a→b、b→c
    expect(pairs.map((p) => [p.scene.id, p.nextScene.id])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("混合：同地点保留、异地点断开", () => {
    const scenes = [
      scene("a", 0, "客厅"), // a→b 同地点，保留
      scene("b", 1, "客厅"), // b→c 异地点，排除
      scene("c", 2, "操场"), // c→d 同地点，保留
      scene("d", 3, "操场"),
    ];
    const pairs = prefilterLinkCandidates(scenes);
    expect(pairs.map((p) => [p.scene.id, p.nextScene.id])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseLinkSuggestOutput", () => {
  const candidates: LinkCandidatePair[] = [
    { scene: scene("a", 0), nextScene: scene("b", 1) },
    { scene: scene("b", 1), nextScene: scene("c", 2) },
  ];

  it("合法 JSON → 映射回 sceneId", () => {
    const raw = '[{"pair":0,"reason":"伸手推门连续动作"}]';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out).toEqual([
      { sceneId: "a", nextSceneId: "b", reason: "伸手推门连续动作" },
    ]);
  });

  it("容忍代码围栏 / 前后杂字", () => {
    const raw =
      '好的，结果如下：\n```json\n[{"pair":1,"reason":"转身连续"}]\n```';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out).toEqual([
      { sceneId: "b", nextSceneId: "c", reason: "转身连续" },
    ]);
  });

  it("越界索引丢弃，合法条目保留", () => {
    const raw = '[{"pair":5,"reason":"越界"},{"pair":0,"reason":"有效"}]';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out).toEqual([{ sceneId: "a", nextSceneId: "b", reason: "有效" }]);
  });

  it("负数 / 非整数 pair 丢弃", () => {
    const raw =
      '[{"pair":-1,"reason":"负"},{"pair":0.5,"reason":"小数"},{"pair":1,"reason":"ok"}]';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out.map((s) => s.sceneId)).toEqual(["b"]);
  });

  it("重复 pair 去重（保留首个）", () => {
    const raw = '[{"pair":0,"reason":"第一"},{"pair":0,"reason":"重复"}]';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("第一");
  });

  it("缺 reason → 用兜底文案", () => {
    const raw = '[{"pair":0}]';
    const out = parseLinkSuggestOutput(raw, candidates);
    expect(out[0].reason).toBe("同场景动作连续");
  });

  it("空数组 → 空建议", () => {
    expect(parseLinkSuggestOutput("[]", candidates)).toEqual([]);
  });

  it("完全无 JSON 数组 → 抛错（供路由转 502）", () => {
    expect(() =>
      parseLinkSuggestOutput("抱歉我无法判断", candidates)
    ).toThrow();
  });

  it("非法 JSON 语法 → 抛错", () => {
    expect(() => parseLinkSuggestOutput('[{"pair":0,]', candidates)).toThrow();
  });
});

describe("buildLinkSuggestPrompt", () => {
  it("包含每对索引与 order，且截断长描述", () => {
    const long = "很长的描述".repeat(50);
    const pairs: LinkCandidatePair[] = [
      {
        scene: { id: "a", order: 0, description: long, locationKey: "客厅" },
        nextScene: {
          id: "b",
          order: 1,
          description: "短",
          locationKey: "客厅",
        },
      },
    ];
    const prompt = buildLinkSuggestPrompt(pairs);
    expect(prompt).toContain("[对 0]");
    expect(prompt).toContain("镜0→镜1");
    // 长描述被截断到 120 字内（不含完整 long）
    expect(prompt).not.toContain(long);
  });
});
