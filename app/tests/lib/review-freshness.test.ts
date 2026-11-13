import { describe, expect, it } from "vitest";
import {
  buildNarrativeReviewFingerprint,
  buildContinuityReviewFingerprint,
  compareReviewFingerprint,
} from "@/lib/review-freshness";
import { assembleReviewReport } from "@/lib/review-report";

const first = {
  id: "a",
  order: 1,
  shotType: "特写",
  description: "阿宁藏起钥匙，门锁突然转动。",
  duration: 3,
  emotion: "fear",
  dialogue: "别开门！",
  narration: null,
  characters: ["阿宁"],
  actionBeat: "藏起钥匙",
  cameraMovement: "zoom_in",
  imageUrl: "/uploads/a.png",
  locationKey: "门厅",
  characterNames: ["阿宁"],
};
const second = {
  ...first,
  id: "b",
  order: 2,
  description: "门外的黑影停住脚步。",
  imageUrl: "/uploads/b.png",
};

describe("审片输入指纹", () => {
  it("相同送评文本不因DB id、媒体URL或updatedAt变化失效", () => {
    const snapshot = buildNarrativeReviewFingerprint([first, second]);
    expect(
      buildNarrativeReviewFingerprint([
        {
          ...first,
          id: "new-a",
          imageUrl: "/uploads/new.png",
          updatedAt: "later",
        },
        second,
      ])
    ).toBe(snapshot);
    expect(compareReviewFingerprint(snapshot, snapshot)).toBe("current");
  });
  it.each([
    "dialogue",
    "narration",
    "description",
    "emotion",
    "shotType",
    "actionBeat",
    "cameraMovement",
  ] as const)("%s修改使叙事评审失效", (field) => {
    expect(
      buildNarrativeReviewFingerprint([{ ...first, [field]: "已修改" }, second])
    ).not.toBe(buildNarrativeReviewFingerprint([first, second]));
  });
  it("时长、角色、镜序和分镜数量修改都能被检测", () => {
    const snapshot = buildNarrativeReviewFingerprint([first, second]);
    for (const changed of [
      [{ ...first, duration: 4 }, second],
      [{ ...first, characters: ["阿青"] }, second],
      [
        { ...first, order: 2 },
        { ...second, order: 1 },
      ],
      [first],
    ])
      expect(
        compareReviewFingerprint(
          snapshot,
          buildNarrativeReviewFingerprint(changed)
        )
      ).toBe("stale");
  });
  it("角色集合和空白字段规范化，排序不造成虚假失效", () => {
    expect(
      buildNarrativeReviewFingerprint([
        { ...first, characters: ["阿宁", "阿青"] },
      ])
    ).toBe(
      buildNarrativeReviewFingerprint([
        { ...first, characters: ["阿青", "阿宁", "阿宁"], narration: "  " },
      ])
    );
  });
  it("视觉体检只比较实际相邻图片输入及色板，忽略无关音轨", () => {
    const snapshot = buildContinuityReviewFingerprint([first, second], "冷蓝");
    expect(
      buildContinuityReviewFingerprint(
        [{ ...first, audioUrl: "new.mp3" }, second],
        "冷蓝"
      )
    ).toBe(snapshot);
    expect(
      buildContinuityReviewFingerprint(
        [{ ...first, imageUrl: "changed.png" }, second],
        "冷蓝"
      )
    ).not.toBe(snapshot);
    expect(buildContinuityReviewFingerprint([first, second], "暖黄")).not.toBe(
      snapshot
    );
    expect(
      buildContinuityReviewFingerprint(
        [first, { ...second, locationKey: "室外" }],
        "冷蓝"
      )
    ).not.toBe(snapshot);
  });
  it.each([undefined, null, "", "not-a-fingerprint", "sha256:v1:bad"])(
    "旧/坏指纹 %s 不冒充当前已检查",
    (stored) => {
      expect(
        compareReviewFingerprint(
          stored,
          buildNarrativeReviewFingerprint([first])
        )
      ).toBe("unknown");
    }
  );
});

describe("审片报告版本状态", () => {
  it.each(["stale", "unknown"] as const)(
    "%s叙事与视觉结果不显示历史通过或使用历史修复建议",
    (freshness) => {
      const report = assembleReviewReport({
        scenes: [first],
        narrativeReview: {
          score: 99,
          pass: true,
          passThreshold: 70,
          feedback: "旧高分",
          suggestions: ["旧建议"],
          freshness,
        },
        continuitySummary: {
          grade: "A",
          summary: "旧画面全通过",
          issueCount: 0,
          freshness,
        },
      });
      for (const key of ["narrative", "continuity"]) {
        const section = report.sections.find((s) => s.key === key)!;
        expect(section.status).toBe("warn");
        expect(section.lines.join(" ")).toContain(
          freshness === "stale" ? "已过期" : "无法核验"
        );
        expect(section.lines.join(" ")).not.toContain("旧高分");
      }
      expect(report.suggestions.some((s) => s.text.includes("旧建议"))).toBe(
        false
      );
    }
  );
});
