import { describe, it, expect } from "vitest";
import {
  buildPairList,
  assembleContinuityReport,
  type ContinuityScene,
  type ContinuityPairResult,
  type ContinuityPairIssue,
} from "@/services/continuity-check";

function scene(
  id: string,
  order: number,
  imageUrl?: string | null
): ContinuityScene {
  return { id, order, imageUrl };
}

/** 构造一对结果（默认非跳过、无问题） */
function pairResult(
  nextSceneId: string,
  nextSceneOrder: number,
  issues: ContinuityPairIssue[] = [],
  skipped = false
): ContinuityPairResult {
  return {
    prevSceneId: `${nextSceneId}-prev`,
    nextSceneId,
    nextSceneOrder,
    skipped,
    issues,
  };
}

function issue(severity: ContinuityPairIssue["severity"]): ContinuityPairIssue {
  return {
    dimension: "角色服装",
    severity,
    description: "服装跳变",
    fixNote: "改回原服装",
  };
}

describe("buildPairList", () => {
  it("连续出图分镜 → 相邻两两配对", () => {
    const pairs = buildPairList([
      scene("a", 0, "u0"),
      scene("b", 1, "u1"),
      scene("c", 2, "u2"),
    ]);
    expect(pairs.map((p) => [p.prev.id, p.next.id])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("空图缺口跳过：缺图分镜不参与配对", () => {
    // b 无图 → a、c 都各自被排除出与 b 的相邻对；a 与 c 在过滤后相邻成对
    const pairs = buildPairList([
      scene("a", 0, "u0"),
      scene("b", 1, null),
      scene("c", 2, "u2"),
    ]);
    expect(pairs.map((p) => [p.prev.id, p.next.id])).toEqual([["a", "c"]]);
  });

  it("少于 2 张已出图 → 空数组", () => {
    expect(buildPairList([scene("a", 0, "u0")])).toEqual([]);
    expect(buildPairList([scene("a", 0, "u0"), scene("b", 1, null)])).toEqual(
      []
    );
    expect(buildPairList([])).toEqual([]);
  });

  it("乱序输入按 order 归一后配对", () => {
    const pairs = buildPairList([
      scene("c", 2, "u2"),
      scene("a", 0, "u0"),
      scene("b", 1, "u1"),
    ]);
    expect(pairs.map((p) => [p.prev.id, p.next.id])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });
});

describe("assembleContinuityReport · 评级标尺", () => {
  it("A：0 严重且 ≤2 中等", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [issue("中等"), issue("中等")]),
    ]);
    expect(report.grade).toBe("A");
    expect(report.issues).toHaveLength(2);
  });

  it("A→B 边界：3 个中等 → B", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [issue("中等"), issue("中等"), issue("中等")]),
    ]);
    expect(report.grade).toBe("B");
  });

  it("B：0 严重且 ≤5 中等（5 个 → B）", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [
        issue("中等"),
        issue("中等"),
        issue("中等"),
        issue("中等"),
        issue("中等"),
      ]),
    ]);
    expect(report.grade).toBe("B");
  });

  it("B→C 边界：无严重但 6 个中等 → C", () => {
    const report = assembleContinuityReport([
      pairResult(
        "b",
        2,
        Array.from({ length: 6 }, () => issue("中等"))
      ),
    ]);
    expect(report.grade).toBe("C");
  });

  it("C：1–2 严重", () => {
    expect(
      assembleContinuityReport([pairResult("b", 2, [issue("严重")])]).grade
    ).toBe("C");
    expect(
      assembleContinuityReport([
        pairResult("b", 2, [issue("严重"), issue("严重")]),
      ]).grade
    ).toBe("C");
  });

  it("C→D 边界：3 严重 → D", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [issue("严重"), issue("严重"), issue("严重")]),
    ]);
    expect(report.grade).toBe("D");
  });

  it("轻微问题不参与降级：仅轻微 → A", () => {
    const report = assembleContinuityReport([
      pairResult(
        "b",
        2,
        Array.from({ length: 8 }, () => issue("轻微"))
      ),
    ]);
    expect(report.grade).toBe("A");
    expect(report.issues).toHaveLength(8);
  });

  it("无问题 → A 且总结为良好", () => {
    const report = assembleContinuityReport([pairResult("b", 2, [])]);
    expect(report.grade).toBe("A");
    expect(report.issues).toEqual([]);
    expect(report.summary).toContain("连贯性良好");
  });
});

describe("assembleContinuityReport · issue 挂到后镜 + 跳过记账", () => {
  it("每条 issue 挂到后镜 sceneId/order", () => {
    const report = assembleContinuityReport([
      pairResult("scene-b", 5, [issue("严重")]),
    ]);
    expect(report.issues[0].sceneId).toBe("scene-b");
    expect(report.issues[0].sceneOrder).toBe(5);
  });

  it("每条 issue 携带前镜 prevSceneId（一致性锚图来源）", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [issue("严重"), issue("中等")]),
    ]);
    // pairResult 的 prevSceneId 约定为 `${nextSceneId}-prev`
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].prevSceneId).toBe("b-prev");
    expect(report.issues[1].prevSceneId).toBe("b-prev");
  });

  it("跳过的对计数并写进 summary，不产出 issue（部分跳过：仍出等级）", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [issue("中等")]),
      pairResult("c", 3, [], true),
      pairResult("d", 4, [], true),
    ]);
    expect(report.issues).toHaveLength(1);
    expect(report.summary).toContain("2 对因视觉调用失败未检查");
    // 有成功检查的对 → 正常出等级
    expect(report.grade).toBe("A");
    expect(report.checkedPairs).toBe(1);
    expect(report.skippedPairs).toBe(2);
  });
});

describe("assembleContinuityReport · 全跳过 = 体检未完成（诚实报告，不伪装 A）", () => {
  it("全部跳过 → grade=null、summary 明说未完成、无 issue", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, [], true),
      pairResult("c", 3, [], true),
    ]);
    // 关键：不再伪装成绿色 A —— 无一对成功检查即体检未完成
    expect(report.grade).toBeNull();
    expect(report.issues).toEqual([]);
    expect(report.checkedPairs).toBe(0);
    expect(report.skippedPairs).toBe(2);
    expect(report.summary).toContain("体检未完成");
    expect(report.summary).not.toContain("连贯性良好");
  });

  it("空输入（无任何对）→ grade=null、体检未完成", () => {
    const report = assembleContinuityReport([]);
    expect(report.grade).toBeNull();
    expect(report.checkedPairs).toBe(0);
    expect(report.skippedPairs).toBe(0);
    expect(report.summary).toContain("体检未完成");
  });

  it("有一对成功检查（哪怕 0 问题）→ 正常 A，不算未完成", () => {
    const report = assembleContinuityReport([
      pairResult("b", 2, []),
      pairResult("c", 3, [], true),
    ]);
    expect(report.grade).toBe("A");
    expect(report.checkedPairs).toBe(1);
    expect(report.skippedPairs).toBe(1);
    expect(report.summary).toContain("连贯性良好");
  });
});
