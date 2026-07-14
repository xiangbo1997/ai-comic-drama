import { describe, it, expect } from "vitest";
import {
  assembleReviewReport,
  type ReviewScene,
  type ContinuitySummaryInput,
} from "@/lib/review-report";

/**
 * 造一个「健康」分镜：有图/视频/音频、有对白、时长充足。
 * 用展开合并保留显式 null 覆盖（`?? default` 会把 null 吞成默认值，故不能用）。
 */
function scene(overrides: Partial<ReviewScene> = {}): ReviewScene {
  const base: ReviewScene = {
    id: "s",
    order: 0,
    // 6 汉字≈2.4s，给 4s 充足
    duration: 4,
    shotType: "近景",
    dialogue: "你好世界啊哈",
    narration: null,
    imageUrl: "https://x/i.webp",
    videoUrl: "https://x/v.mp4",
    audioUrl: "https://x/a.mp3",
    videoLinkNext: false,
  };
  return { ...base, ...overrides };
}

function findSection(
  report: ReturnType<typeof assembleReviewReport>,
  key: string
) {
  const s = report.sections.find((x) => x.key === key);
  if (!s) throw new Error(`section ${key} missing`);
  return s;
}

const okContinuity: ContinuitySummaryInput = {
  grade: "A",
  summary: "连贯性良好，未发现明显跳变",
  issueCount: 0,
};

describe("assembleReviewReport · 时长节奏", () => {
  it("无对白且 >8s → 超长空镜嫌疑 + 可跳转建议", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0 }),
        scene({
          id: "b",
          order: 1,
          dialogue: null,
          narration: null,
          duration: 12,
        }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.status).toBe("warn");
    expect(pacing.lines.some((l) => l.includes("凑时长嫌疑"))).toBe(true);
    // 建议挂到超长空镜（镜 2 = order 1）且可跳转
    const jump = report.suggestions.find((s) => s.sceneId === "b");
    expect(jump?.sceneOrder).toBe(2);
  });

  it("对白朗读时长 > 时长 → 对白超时（配音截断）→ bad", () => {
    const report = assembleReviewReport({
      scenes: [
        // 10 汉字≈4s 但只给 1s
        scene({
          id: "a",
          order: 0,
          dialogue: "一二三四五六七八九十",
          duration: 1,
        }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.status).toBe("bad");
    expect(pacing.lines.some((l) => l.includes("配音会被截断"))).toBe(true);
    expect(report.suggestions.some((s) => s.sceneId === "a")).toBe(true);
  });

  it("镜数偏离：镜频过低 <15/分钟 → 全片级建议（无 sceneId）", () => {
    // 2 镜共 60s → 2/分钟，远低于 15
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, duration: 30 }),
        scene({ id: "b", order: 1, duration: 30 }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.lines.some((l) => l.includes("镜频偏低"))).toBe(true);
    const dev = report.suggestions.find((s) => s.text.includes("低于 15"));
    expect(dev).toBeDefined();
    expect(dev?.sceneId).toBeUndefined();
  });

  it("镜数偏离：镜频过高 >25/分钟 → 建议合并短镜", () => {
    // 10 镜共 10s → 60/分钟
    const scenes = Array.from({ length: 10 }, (_, i) =>
      scene({ id: `s${i}`, order: i, duration: 1, dialogue: "短" })
    );
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.lines.some((l) => l.includes("镜频偏高"))).toBe(true);
  });

  it("全部合规 → 时长节奏节 ok", () => {
    // 3 镜共 12s → 15/分钟（恰在下限），对白都念得完
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, duration: 4 }),
        scene({ id: "b", order: 1, duration: 4 }),
        scene({ id: "c", order: 2, duration: 4 }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    expect(findSection(report, "pacing").status).toBe("ok");
  });
});

describe("assembleReviewReport · 结尾钩子", () => {
  it("hookType 已标注 → ok + 展示类型", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: "反转",
      continuitySummary: okContinuity,
    });
    const hook = findSection(report, "hook");
    expect(hook.status).toBe("ok");
    expect(hook.lines[0]).toContain("反转");
  });

  it("hookType 缺失 → warn + 建议（无 sceneId）", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: null,
      continuitySummary: okContinuity,
    });
    const hook = findSection(report, "hook");
    expect(hook.status).toBe("warn");
    expect(
      report.suggestions.some((s) => s.text.includes("结尾钩子未标注"))
    ).toBe(true);
  });
});

describe("assembleReviewReport · 连贯性", () => {
  it("从未运行 → warn + 「尚未运行 AI 场记体检」", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: "悬念",
      continuitySummary: null,
    });
    const cont = findSection(report, "continuity");
    expect(cont.status).toBe("warn");
    expect(cont.lines[0]).toContain("尚未运行 AI 场记体检");
  });

  it("摘要 D 级 → bad；建议含问题数", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: "悬念",
      continuitySummary: {
        grade: "D",
        summary: "评级 D，共 4 处连贯性问题",
        issueCount: 4,
      },
    });
    const cont = findSection(report, "continuity");
    expect(cont.status).toBe("bad");
    expect(report.suggestions.some((s) => s.text.includes("4 处问题"))).toBe(
      true
    );
  });

  it("摘要 C 级 → warn", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: "悬念",
      continuitySummary: { grade: "C", summary: "评级 C", issueCount: 2 },
    });
    expect(findSection(report, "continuity").status).toBe("warn");
  });

  it("体检未完成（grade=null）→ warn，区别于「尚未运行」，且不当作通过", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      hookType: "悬念",
      continuitySummary: {
        grade: null,
        summary: "体检未完成：2 对相邻分镜的视觉调用全部失败，未能实际检查。",
        issueCount: 0,
      },
    });
    const cont = findSection(report, "continuity");
    expect(cont.status).toBe("warn");
    // 展示后端的「未完成」总结，而不是「尚未运行」
    expect(cont.lines[0]).toContain("体检未完成");
    expect(cont.lines[0]).not.toContain("尚未运行");
    // 给出「视觉调用全部失败」的告警建议
    expect(
      report.suggestions.some((s) => s.text.includes("视觉调用全部失败"))
    ).toBe(true);
  });
});

describe("assembleReviewReport · 完整性", () => {
  it("缺图统计 + 逐镜可跳转建议 + bad", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0 }),
        scene({ id: "b", order: 1, imageUrl: null }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const comp = findSection(report, "completeness");
    expect(comp.status).toBe("bad");
    expect(comp.lines[0]).toContain("缺图 1");
    expect(
      report.suggestions.some(
        (s) => s.sceneId === "b" && s.text.includes("缺少图片")
      )
    ).toBe(true);
  });

  it("缺视频/缺配音/空镜 → warn（非 bad）", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, videoUrl: null }),
        scene({ id: "b", order: 1, audioUrl: null }),
        // 空镜：无对白无旁白
        scene({
          id: "c",
          order: 2,
          dialogue: null,
          narration: null,
          duration: 4,
        }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const comp = findSection(report, "completeness");
    expect(comp.status).toBe("warn");
    expect(comp.lines[0]).toContain("缺视频 1");
    expect(comp.lines[0]).toContain("缺配音 1");
    expect(comp.lines[0]).toContain("无对白无旁白 1");
  });

  it("衔接镜下一镜缺图 → 衔接失效告警 + 可跳转建议 + bad", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, videoLinkNext: true }),
        scene({ id: "b", order: 1, imageUrl: null }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const comp = findSection(report, "completeness");
    expect(comp.status).toBe("bad");
    expect(
      comp.lines.some((l) => l.includes("尾帧衔接因下一镜缺图而失效"))
    ).toBe(true);
    expect(
      report.suggestions.some(
        (s) => s.sceneId === "a" && s.text.includes("尾帧衔接")
      )
    ).toBe(true);
  });

  it("全齐 → 完整性 ok", () => {
    const report = assembleReviewReport({
      scenes: [scene({ id: "a", order: 0 }), scene({ id: "b", order: 1 })],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    expect(findSection(report, "completeness").status).toBe("ok");
  });
});

describe("assembleReviewReport · 综合等级边界", () => {
  it("全 ok → A", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, duration: 4 }),
        scene({ id: "b", order: 1, duration: 4 }),
        scene({ id: "c", order: 2, duration: 4 }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    expect(report.grade).toBe("A");
  });

  it("恰 1 个 warn（钩子缺失），其余 ok → B", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, duration: 4 }),
        scene({ id: "b", order: 1, duration: 4 }),
        scene({ id: "c", order: 2, duration: 4 }),
      ],
      hookType: null, // hook warn
      continuitySummary: okContinuity,
    });
    expect(report.grade).toBe("B");
  });

  it("恰 1 个 bad → C", () => {
    const report = assembleReviewReport({
      scenes: [
        scene({ id: "a", order: 0, duration: 4 }),
        scene({ id: "b", order: 1, duration: 4 }),
        scene({ id: "c", order: 2, duration: 4 }),
      ],
      hookType: "悬念",
      // 连贯性 bad
      continuitySummary: { grade: "D", summary: "评级 D", issueCount: 3 },
    });
    expect(report.grade).toBe("C");
  });

  it("≥2 个 bad → D", () => {
    const report = assembleReviewReport({
      scenes: [
        // 缺图 → 完整性 bad
        scene({ id: "a", order: 0, imageUrl: null }),
        scene({ id: "b", order: 1, duration: 4 }),
        scene({ id: "c", order: 2, duration: 4 }),
      ],
      hookType: "悬念",
      // 连贯性 bad
      continuitySummary: { grade: "D", summary: "评级 D", issueCount: 3 },
    });
    expect(report.grade).toBe("D");
  });

  it("空分镜 → 时长节奏 + 完整性均 warn → B", () => {
    const report = assembleReviewReport({
      scenes: [],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    // pacing warn + completeness warn，无 bad → B
    expect(report.grade).toBe("B");
  });
});
