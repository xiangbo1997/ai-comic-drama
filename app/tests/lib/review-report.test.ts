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
    // 红线门禁字段（默认无节拍/无运镜/中性情绪；各红线用例按需覆盖）
    beatType: null,
    isClimax: false,
    cameraMovement: null,
    actionBeat: null,
    emotion: "neutral",
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

/**
 * 合规节全 ok 所需的最小输入（第二十七条三项编号齐全 + 片头卡开启；
 * AI 标识缺省即启用，故无需显式传）。等级边界用例复用它，
 * 以便「全 ok → A」仍然表达「六节全 ok」而非漏掉合规节。
 */
const compliantInput = {
  credentials: {
    licenseNo: "甲第123号",
    approvalNo: "批2026-001",
    programNo: "节目0007",
  },
  titleCardEnabled: true,
};

describe("assembleReviewReport · 综合等级边界", () => {
  it("全 ok → A", () => {
    const report = assembleReviewReport({
      // 首镜带强情绪（构成开场钩子镜）+ 全片有情绪事件，避免触发红线 warn
      scenes: [
        scene({ id: "a", order: 0, duration: 4, emotion: "angry" }),
        scene({ id: "b", order: 1, duration: 4, emotion: "sad" }),
        scene({ id: "c", order: 2, duration: 4, emotion: "happy" }),
      ],
      hookType: "悬念",
      continuitySummary: okContinuity,
      // 合规节（第二十七/三十四条）亦须 ok，否则 A 不可达
      ...compliantInput,
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
      ...compliantInput,
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
      ...compliantInput,
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
    // pacing warn + completeness warn + redline warn，无 bad → B
    expect(report.grade).toBe("B");
  });
});

describe("assembleReviewReport · 红果红线门禁", () => {
  /** 造一条「红线全绿」健康镜：短时长、有情绪事件、有运镜、短对白 */
  function healthy(overrides: Partial<ReviewScene> = {}): ReviewScene {
    return scene({
      duration: 3,
      dialogue: "短句台词。",
      emotion: "angry",
      cameraMovement: "zoom_in",
      actionBeat: "转身",
      ...overrides,
    });
  }

  it("① 总时长 >180s → redline bad + 删减建议", () => {
    // 首镜有钩子，其余每 20s 一个情绪事件避免断档；用大时长堆到 >180s
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 60 }),
      healthy({ id: "b", order: 1, duration: 60 }),
      healthy({ id: "c", order: 2, duration: 61 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("bad");
    expect(redline.lines.some((l) => l.includes("超过红线上限"))).toBe(true);
    expect(report.suggestions.some((s) => s.text.includes("180"))).toBe(true);
  });

  it("① 总时长在 168-180 之间 → redline warn（逼近上限）", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 58 }),
      healthy({ id: "b", order: 1, duration: 58 }),
      healthy({ id: "c", order: 2, duration: 58 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    // 174s → warn
    expect(redline.status).toBe("warn");
    expect(redline.lines.some((l) => l.includes("逼近红线"))).toBe(true);
  });

  it("① cardExtraSec 计入总时长（卡片把 178s 顶过 180s 红线）", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 60 }),
      healthy({ id: "b", order: 1, duration: 60 }),
      healthy({ id: "c", order: 2, duration: 58 }),
    ];
    // 分镜和 178s，加卡片 4.5s → 182.5s，跨过 180 红线
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
      cardExtraSec: 4.5,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("bad");
    expect(redline.lines.some((l) => l.includes("含片头尾卡"))).toBe(true);
  });

  it("② 开场 3s 内无钩子镜 → redline warn + 定位首镜", () => {
    // 首镜中性情绪、非节拍镜 → 非钩子；后续镜有情绪避免断档
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 3, emotion: "neutral" }),
      healthy({ id: "b", order: 1, duration: 3 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("warn");
    expect(redline.lines.some((l) => l.includes("开场"))).toBe(true);
    const jump = report.suggestions.find(
      (s) => s.sceneId === "a" && s.text.includes("开场")
    );
    expect(jump?.sceneOrder).toBe(1);
  });

  it("② 开场 3s 内有 impact/reveal/isClimax → 不触发钩子告警", () => {
    const scenes: ReviewScene[] = [
      healthy({
        id: "a",
        order: 0,
        duration: 2,
        emotion: "neutral",
        beatType: "impact",
      }),
      healthy({ id: "b", order: 1, duration: 3 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.lines.some((l) => l.includes("开场"))).toBe(false);
  });

  it("③ 连续 30s 无情绪事件 → redline warn + 定位断档起始镜", () => {
    // 首镜钩子（满足②），随后一长串中性镜堆够 30s 断档
    const scenes: ReviewScene[] = [
      healthy({ id: "hook", order: 0, duration: 2 }),
      scene({
        id: "g0",
        order: 1,
        duration: 16,
        emotion: "neutral",
        cameraMovement: "pan_left",
      }),
      scene({
        id: "g1",
        order: 2,
        duration: 16,
        emotion: "neutral",
        cameraMovement: "pan_left",
      }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("warn");
    expect(redline.lines.some((l) => l.includes("无情绪事件"))).toBe(true);
    const jump = report.suggestions.find((s) => s.text.includes("无情绪起伏"));
    expect(jump?.sceneOrder).toBe(2);
  });

  it("③ 情绪事件打断断档 → 不触发（beatType 重置计时）", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "hook", order: 0, duration: 2 }),
      scene({ id: "g0", order: 1, duration: 16, emotion: "neutral" }),
      // 情绪事件把连续断档打断
      scene({ id: "e", order: 2, duration: 4, emotion: "surprised" }),
      scene({ id: "g1", order: 3, duration: 16, emotion: "neutral" }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.lines.some((l) => l.includes("无情绪事件"))).toBe(false);
  });

  it("④ 对白单句 >15 字 → 逐镜 suggestion", () => {
    const longDlg = "这是一句非常非常长的台词一直说个不停根本停不下来";
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 6, dialogue: longDlg }),
      healthy({ id: "b", order: 1, duration: 3 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("warn");
    expect(redline.lines.some((l) => l.includes("长对白"))).toBe(true);
    const jump = report.suggestions.find(
      (s) => s.sceneId === "a" && s.text.includes("对白单句")
    );
    expect(jump?.sceneOrder).toBe(1);
  });

  it("④ 长句按句末标点切分 → 短句不误报", () => {
    // 单句都 ≤15 字，仅因整段长；切句后不触发
    const scenes: ReviewScene[] = [
      healthy({
        id: "a",
        order: 0,
        duration: 5,
        dialogue: "你来了。我等你很久了。快进来吧。",
      }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.lines.some((l) => l.includes("长对白"))).toBe(false);
  });

  it("⑤ 静止长镜 >4s 且无运镜无动作 → 加镜内运动建议", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "hook", order: 0, duration: 2 }),
      // 6s 静止（cameraMovement=static、无 actionBeat），有情绪避免断档
      scene({
        id: "static",
        order: 1,
        duration: 6,
        emotion: "sad",
        cameraMovement: "static",
        actionBeat: null,
      }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("warn");
    expect(redline.lines.some((l) => l.includes("无运镜"))).toBe(true);
    const jump = report.suggestions.find(
      (s) => s.sceneId === "static" && s.text.includes("加镜内运动")
    );
    expect(jump?.sceneOrder).toBe(2);
  });

  it("⑤ 有运镜或有 actionBeat → 不触发静止告警", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "hook", order: 0, duration: 2 }),
      scene({
        id: "moving",
        order: 1,
        duration: 6,
        emotion: "sad",
        cameraMovement: "dolly_in",
        actionBeat: null,
      }),
      scene({
        id: "acting",
        order: 2,
        duration: 6,
        emotion: "happy",
        cameraMovement: "static",
        actionBeat: "挥手",
      }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.lines.some((l) => l.includes("无运镜"))).toBe(false);
  });

  it("全绿健康镜 → redline ok + 分工声明常驻", () => {
    const scenes: ReviewScene[] = [
      healthy({ id: "a", order: 0, duration: 3 }),
      healthy({ id: "b", order: 1, duration: 3 }),
    ];
    const report = assembleReviewReport({
      scenes,
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const redline = findSection(report, "redline");
    expect(redline.status).toBe("ok");
    // 连贯性分工声明在任何情况下都作为末行注明
    expect(redline.lines.some((l) => l.includes("AI 场记"))).toBe(true);
  });
});

describe("assembleReviewReport · 变速换算（speechSpeed）", () => {
  it("朗读时长按 speechSpeed 除算 → 2 倍速下不再误报对白超时", () => {
    // 12 汉字 ≈ 4.8s 朗读；成片轴时长 3s（= DB 6s / 2 倍速）。
    // 配音同样被 atempo 压到 2.4s < 3s，故不应判超时。
    const s = scene({
      id: "fast",
      order: 0,
      duration: 3,
      speechSpeed: 2,
      dialogue: "一二三四五六七八九十甲乙",
    });
    const report = assembleReviewReport({
      scenes: [s],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.lines.some((l) => l.includes("配音会被截断"))).toBe(false);
  });

  it("同一台词在 speechSpeed=1 下仍判超时（证明差异来自倍速换算而非文本）", () => {
    const s = scene({
      id: "normal",
      order: 0,
      duration: 3,
      speechSpeed: 1,
      dialogue: "一二三四五六七八九十甲乙",
    });
    const report = assembleReviewReport({
      scenes: [s],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const pacing = findSection(report, "pacing");
    expect(pacing.status).toBe("bad");
    expect(pacing.lines.some((l) => l.includes("配音会被截断"))).toBe(true);
  });

  it("speechSpeed 缺省/非正 → 按 1 处理（零回归）", () => {
    const dialogue = "一二三四五六七八九十甲乙";
    const base = { order: 0, duration: 3, dialogue };
    const missing = assembleReviewReport({
      scenes: [scene({ id: "m", ...base })],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    const zero = assembleReviewReport({
      scenes: [scene({ id: "z", ...base, speechSpeed: 0 })],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    // 两者都等价于 speechSpeed=1 → 同样判超时
    expect(findSection(missing, "pacing").status).toBe("bad");
    expect(findSection(zero, "pacing").status).toBe("bad");
  });

  it("慢放（speechSpeed<1）拉长朗读时长 → 可触发超时", () => {
    // 6 汉字 ≈ 2.4s；0.5 倍速下朗读 4.8s > 成片轴 4s → 超时
    const s = scene({
      id: "slow",
      order: 0,
      duration: 4,
      speechSpeed: 0.5,
      dialogue: "一二三四五六",
    });
    const report = assembleReviewReport({
      scenes: [s],
      hookType: "悬念",
      continuitySummary: okContinuity,
    });
    expect(findSection(report, "pacing").status).toBe("bad");
  });
});

/**
 * 合规检查节（《微短剧管理办法》，国家广播电视总局令第 16 号，2026-09-01 施行）。
 *
 * 三道机检：第三十四条 AI 标识开关、第二十七条片头信息位、单集 <20 分钟的
 * 微短剧定义边界。重点守「缺省即合规」与「填了编号但片头卡关着」两种易错态。
 */
describe("assembleReviewReport · 合规检查（广电总局令第 16 号）", () => {
  it("缺省（老项目无 aiDisclosure）→ 标识视为已开启，不报 bad", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
    });
    const s = findSection(report, "compliance");
    expect(s.status).not.toBe("bad");
    expect(s.lines.join("\n")).toContain("AI 生成提示标识已开启");
  });

  it("显式关闭 AI 标识 → bad（第三十四条是法定强制要求）", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      aiDisclosure: { enabled: false },
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("bad");
    expect(s.lines.join("\n")).toContain("第三十四条");
    // 给出可操作建议
    expect(
      report.suggestions.some((x) => x.text.includes("AI 生成提示标识"))
    ).toBe(true);
  });

  it("mode=head 时节内说明片头显示秒数（而非笼统说已开启）", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      aiDisclosure: { mode: "head", headSec: 8 },
    });
    expect(findSection(report, "compliance").lines.join("\n")).toContain(
      "片头 8s 内显示"
    );
  });

  it("未填片头编号 → warn + 建议（第二十七条）", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      titleCardEnabled: true,
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("warn");
    expect(s.lines.join("\n")).toContain("片头未标注");
    expect(report.suggestions.some((x) => x.text.includes("第二十七条"))).toBe(
      true
    );
  });

  it("三项编号齐全 + 片头卡开启 → 该项不告警", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      credentials: {
        licenseNo: "甲第123号",
        approvalNo: "批2026-001",
        programNo: "节目0007",
      },
      titleCardEnabled: true,
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("ok");
    expect(s.lines.join("\n")).toContain("片头信息位已标注 3 项编号");
  });

  it("填了编号但片头卡关闭 → warn（编号只渲染在片头卡，成片里看不到）", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      credentials: { licenseNo: "甲第123号" },
      titleCardEnabled: false,
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("warn");
    expect(s.lines.join("\n")).toContain("片头标题卡未开启");
  });

  it("编号未填满三项 → warn 提示可能遗漏", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      credentials: { licenseNo: "甲第123号" },
      titleCardEnabled: true,
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("warn");
    expect(s.lines.join("\n")).toContain("未填满");
  });

  it("单集 <20 分钟 → 节内确认落在微短剧定义内", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
      credentials: {
        licenseNo: "a",
        approvalNo: "b",
        programNo: "c",
      },
      titleCardEnabled: true,
    });
    expect(findSection(report, "compliance").lines.join("\n")).toContain(
      "在微短剧定义范围内"
    );
  });

  it("单集 ≥20 分钟 → warn（超出微短剧定义，适用规则不同）", () => {
    // 单镜 1200s = 20 分钟，正好触达定义边界
    const report = assembleReviewReport({
      scenes: [scene({ duration: 1200 })],
      continuitySummary: okContinuity,
      credentials: {
        licenseNo: "a",
        approvalNo: "b",
        programNo: "c",
      },
      titleCardEnabled: true,
    });
    const s = findSection(report, "compliance");
    expect(s.status).toBe("warn");
    expect(s.lines.join("\n")).toContain("超出该定义");
  });

  it("20 分钟判据计入片头尾卡时长（与成片实际时长一致）", () => {
    // 分镜 1198s + 卡片 4.5s 越过 1200s 边界
    const report = assembleReviewReport({
      scenes: [scene({ duration: 1198 })],
      continuitySummary: okContinuity,
      cardExtraSec: 4.5,
      credentials: {
        licenseNo: "a",
        approvalNo: "b",
        programNo: "c",
      },
      titleCardEnabled: true,
    });
    expect(findSection(report, "compliance").lines.join("\n")).toContain(
      "超出该定义"
    );
  });

  it("节末附法规依据，且明确不判定「是否足够明显」", () => {
    const report = assembleReviewReport({
      scenes: [scene()],
      continuitySummary: okContinuity,
    });
    const text = findSection(report, "compliance").lines.join("\n");
    expect(text).toContain("第 16 号");
    expect(text).toContain("法规未规定量化标准");
  });
});
