import { describe, it, expect } from "vitest";
import {
  splitSubtitleSegments,
  allocateSubtitleWindows,
  charWidth,
  textVisualWidth,
  typewriterDelays,
  SUBTITLE_ANIM,
} from "@/lib/subtitle-segments";

describe("charWidth / textVisualWidth（视觉宽度启发式，须与折行同源）", () => {
  it("CJK 全角计 1，ASCII 半角计 0.5", () => {
    expect(charWidth("中")).toBe(1);
    expect(charWidth("a")).toBe(0.5);
    expect(charWidth("1")).toBe(0.5);
  });

  it("整串宽度 = 各字符宽度之和", () => {
    // 2 全角 + 4 ASCII = 2 + 2 = 4
    expect(textVisualWidth("中文ab12")).toBe(4);
    expect(textVisualWidth("")).toBe(0);
  });
});

describe("splitSubtitleSegments（逐句切分）", () => {
  it("按句末标点切分，标点保留在所属句尾", () => {
    const out = splitSubtitleSegments("你好。今天天气不错！走吧？");
    expect(out).toEqual(["你好。", "今天天气不错！", "走吧？"]);
  });

  it("英文句末标点同样切分并保留", () => {
    const out = splitSubtitleSegments("Hello world! How are you? Fine.");
    expect(out).toEqual(["Hello world!", "How are you?", "Fine."]);
  });

  it("省略号视为句末标点", () => {
    const out = splitSubtitleSegments("他沉默了……然后开口。");
    expect(out).toEqual(["他沉默了……", "然后开口。"]);
  });

  it("显式换行作为切分点", () => {
    const out = splitSubtitleSegments("第一行\n第二行\n第三行");
    expect(out).toEqual(["第一行", "第二行", "第三行"]);
  });

  it("无句末标点的文本 → 单段", () => {
    const out = splitSubtitleSegments("这是一句没有标点的话");
    expect(out).toEqual(["这是一句没有标点的话"]);
  });

  it("单字叹词碎片（宽度<2）并入前一句", () => {
    // "哦" 视觉宽度 1 < 2，应并入前一句；正常短句不受影响
    const out = splitSubtitleSegments("我明白了。哦");
    expect(out).toEqual(["我明白了。哦"]);
  });

  it("正常短句（宽度>=2）保持独立，不被并入邻句", () => {
    // "走吧？"(3)、"好的。"(3) 都是要突出的短句，绝不合并
    const out = splitSubtitleSegments("你准备好了吗？走吧？好的。");
    expect(out).toEqual(["你准备好了吗？", "走吧？", "好的。"]);
  });

  it("首句过短且无前句可并 → 保留为独立句（不丢字）", () => {
    const out = splitSubtitleSegments("嗯");
    expect(out).toEqual(["嗯"]);
  });

  it("超长句在次级标点（逗号）处再切", () => {
    // 单句超过 30 全角字，含逗号 → 应在逗号处二级切分
    const longText =
      "这是一个非常非常非常非常非常非常非常长的句子，它超过了三十个全角字符的目标宽度限制。";
    const out = splitSubtitleSegments(longText);
    expect(out.length).toBeGreaterThan(1);
    // 每个子句都保留了标点结尾
    expect(out[0].endsWith("，")).toBe(true);
  });

  it("超长句无次级标点可切 → 原样保留为一句（交给下游折行）", () => {
    const longNoComma =
      "这是一个没有任何次级标点符号可以用来切分的超长句子只能整体保留下来啦啦啦啦。";
    const out = splitSubtitleSegments(longNoComma);
    expect(out).toEqual([longNoComma]);
  });

  it("空串 / 纯空白 → 空数组", () => {
    expect(splitSubtitleSegments("")).toEqual([]);
    expect(splitSubtitleSegments("   ")).toEqual([]);
    expect(splitSubtitleSegments("\n\n")).toEqual([]);
  });

  it("句间空白被 trim", () => {
    const out = splitSubtitleSegments("  你好。  再见。  ");
    expect(out).toEqual(["你好。", "再见。"]);
  });
});

describe("allocateSubtitleWindows（逐句时间窗分配）", () => {
  it("时长按视觉宽度比例分配（宽句占更久）", () => {
    // 两句：4 全角 vs 8 全角，时长充裕 → 剩余按 1:2 分
    const windows = allocateSubtitleWindows(
      ["一二三四", "一二三四五六七八"],
      12
    );
    expect(windows).toHaveLength(2);
    const d0 = windows[0].end - windows[0].start;
    const d1 = windows[1].end - windows[1].start;
    // 第二句更宽，应更久
    expect(d1).toBeGreaterThan(d0);
  });

  it("窗口连续闭合：end[k] === start[k+1]", () => {
    const windows = allocateSubtitleWindows(
      ["第一句。", "第二句。", "第三句。"],
      9
    );
    for (let i = 0; i < windows.length - 1; i += 1) {
      expect(windows[i].end).toBe(windows[i + 1].start);
    }
  });

  it("首窗从 0 开始，末窗结束恰为总时长", () => {
    const total = 7.5;
    const windows = allocateSubtitleWindows(["甲。", "乙。", "丙。"], total);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBeCloseTo(total, 6);
  });

  it("时长充裕时每句不低于最小窗 0.8s", () => {
    // 3 句、总 10s，充裕 → 每句 >= 0.8
    const windows = allocateSubtitleWindows(
      ["短", "短", "很长很长很长的一句"],
      10
    );
    for (const w of windows) {
      expect(w.end - w.start).toBeGreaterThanOrEqual(0.8 - 1e-9);
    }
  });

  it("时长过短放不下所有最小窗 → 退化为纯比例（总和守恒）", () => {
    // 5 句、总 1s（< 5×0.8=4），不启用最小窗，仅按比例分
    const segs = ["a", "b", "c", "d", "e"];
    const windows = allocateSubtitleWindows(segs, 1);
    // 每句宽度相同（ASCII 0.5）→ 均分 0.2s
    for (const w of windows) {
      expect(w.end - w.start).toBeCloseTo(0.2, 6);
    }
    // 末窗结束仍为总时长
    expect(windows[windows.length - 1].end).toBeCloseTo(1, 6);
  });

  it("空 segments → 空数组", () => {
    expect(allocateSubtitleWindows([], 5)).toEqual([]);
  });

  it("单句 → 占满整个时长", () => {
    const windows = allocateSubtitleWindows(["独一句。"], 3);
    expect(windows).toEqual([{ text: "独一句。", start: 0, end: 3 }]);
  });

  it("退化总时长 0 → 所有窗口零宽且首尾相接", () => {
    const windows = allocateSubtitleWindows(["甲。", "乙。"], 0);
    expect(windows[0].start).toBe(0);
    expect(windows[0].end).toBe(0);
    expect(windows[1].start).toBe(0);
    expect(windows[1].end).toBe(0);
  });
});

describe("allocateSubtitleWindows — voiceDuration 配音对齐（批3）", () => {
  it("配音短于镜时长 → 逐句节奏按配音走完，末句停驻到镜末", () => {
    // 两句等宽、镜 10s、配音 4s：逐句节奏摊在 4s 内，末句 end 停到 10s
    const windows = allocateSubtitleWindows(["一二三四", "五六七八"], 10, 4);
    expect(windows).toHaveLength(2);
    // 首句在配音区间内结束（≤4s）
    expect(windows[0].end).toBeLessThanOrEqual(4 + 1e-9);
    // 末句 start 也在配音区间内（≈2s，等宽均分 4s）
    expect(windows[1].start).toBeLessThanOrEqual(4 + 1e-9);
    // 末句停驻到镜末
    expect(windows[windows.length - 1].end).toBeCloseTo(10, 6);
    // 窗口仍连续闭合
    expect(windows[0].end).toBe(windows[1].start);
  });

  it("单句 + 短配音 → 首句从 0 覆盖到镜末（末句停驻）", () => {
    const windows = allocateSubtitleWindows(["独一句。"], 8, 3);
    expect(windows).toEqual([{ text: "独一句。", start: 0, end: 8 }]);
  });

  it("配音 >= 镜时长 → 退化为按镜时长分配（零回归）", () => {
    const withVoice = allocateSubtitleWindows(["甲。", "乙。"], 6, 6);
    const withoutVoice = allocateSubtitleWindows(["甲。", "乙。"], 6);
    expect(withVoice).toEqual(withoutVoice);

    const longerVoice = allocateSubtitleWindows(["甲。", "乙。"], 6, 100);
    expect(longerVoice).toEqual(withoutVoice);
  });

  it("voiceDuration 缺省 → 与旧签名完全等价（零回归）", () => {
    const a = allocateSubtitleWindows(["甲。", "乙。", "丙。"], 9);
    const b = allocateSubtitleWindows(["甲。", "乙。", "丙。"], 9, undefined);
    expect(a).toEqual(b);
  });

  it("voiceDuration <= 0 视同缺省", () => {
    const a = allocateSubtitleWindows(["甲。", "乙。"], 6, 0);
    const b = allocateSubtitleWindows(["甲。", "乙。"], 6);
    expect(a).toEqual(b);
  });

  it("配音对齐后窗口仍首尾相接且首窗从 0 开始", () => {
    const windows = allocateSubtitleWindows(
      ["第一句。", "第二句。", "第三句。"],
      12,
      5
    );
    expect(windows[0].start).toBe(0);
    for (let i = 0; i < windows.length - 1; i += 1) {
      expect(windows[i].end).toBe(windows[i + 1].start);
    }
    expect(windows[windows.length - 1].end).toBeCloseTo(12, 6);
  });
});

describe("typewriterDelays（打字机逐字延迟，须与导出/预览两端同源）", () => {
  const charSec = SUBTITLE_ANIM.typewriterCharMs / 1000;

  it("窗口充裕时按名义间隔均匀铺开（第 i 字 = i × charMs）", () => {
    // 4 字，窗口 10s：名义总耗时 3×charSec 远小于 10×0.5=5s 上限 → 不压缩
    const delays = typewriterDelays("一二三四", 10);
    expect(delays).toHaveLength(4);
    expect(delays[0]).toBeCloseTo(0, 6);
    expect(delays[1]).toBeCloseTo(charSec, 6);
    expect(delays[2]).toBeCloseTo(2 * charSec, 6);
    expect(delays[3]).toBeCloseTo(3 * charSec, 6);
  });

  it("窗口过短触发压缩：末字起始恰为 窗口时长 × 上限比例", () => {
    // 长句 + 短窗：名义耗时超过 cap，须压缩使末字落在 cap
    const text = "一二三四五六七八九十"; // 10 字
    const windowSec = 1; // cap = 1 × 0.5 = 0.5s
    const cap = windowSec * SUBTITLE_ANIM.typewriterMaxRevealRatio;
    const nominalTotal = (10 - 1) * charSec; // 0.54s > 0.5 → 压缩
    expect(nominalTotal).toBeGreaterThan(cap);
    const delays = typewriterDelays(text, windowSec);
    expect(delays[0]).toBeCloseTo(0, 6);
    // 末字起始 = cap（等比压缩后）
    expect(delays[delays.length - 1]).toBeCloseTo(cap, 6);
    // 间隔均匀
    const step = delays[1] - delays[0];
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i] - delays[i - 1]).toBeCloseTo(step, 6);
    }
  });

  it("空文本 → 空数组；单字符 → [0]", () => {
    expect(typewriterDelays("", 5)).toEqual([]);
    expect(typewriterDelays("字", 5)).toEqual([0]);
  });

  it("Unicode 安全：多码元字符（emoji）按 Array.from 计一个槽", () => {
    // "😀A" 用 Array.from 是 2 个元素（emoji 是代理对，不能按 .length 数）
    const delays = typewriterDelays("😀A", 10);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeCloseTo(0, 6);
    expect(delays[1]).toBeCloseTo(charSec, 6);
  });

  it("换行也占一个延迟槽（索引与 Array.from 对齐，两端换行规则一致）", () => {
    // "甲\n乙"：3 个元素（甲、\n、乙），换行占中间槽
    const delays = typewriterDelays("甲\n乙", 10);
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeCloseTo(0, 6);
    expect(delays[1]).toBeCloseTo(charSec, 6);
    expect(delays[2]).toBeCloseTo(2 * charSec, 6);
  });
});
