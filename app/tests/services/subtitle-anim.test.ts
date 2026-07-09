import { describe, it, expect } from "vitest";
import {
  buildAssAnimTags,
  buildAssEventText,
} from "@/services/video-synthesis";
import { SUBTITLE_ANIM, typewriterDelays } from "@/lib/subtitle-segments";

// 固定坐标/画面高，便于断言精确标签串（与导出端 1080p 竖屏一致）
const PX = 540;
const PY = 1680;
const HEIGHT = 1920;

describe("buildAssAnimTags（入场动效 libass 标签前缀，须与预览端时序对齐）", () => {
  it("none：仅居中定位，无淡入/位移", () => {
    expect(buildAssAnimTags("none", PX, PY, HEIGHT)).toBe(
      `{\\an5\\pos(${PX},${PY})}`
    );
  });

  it("fade：\\fad 淡入淡出，时长取 SUBTITLE_ANIM.fadeMs", () => {
    const f = SUBTITLE_ANIM.fadeMs;
    expect(buildAssAnimTags("fade", PX, PY, HEIGHT)).toBe(
      `{\\an5\\pos(${PX},${PY})\\fad(${f},${f})}`
    );
  });

  it("缺省（未知动效回退 fade）与 fade 一致", () => {
    // @ts-expect-error 故意传非法值验证 default 分支回退 fade
    expect(buildAssAnimTags("unknown", PX, PY, HEIGHT)).toBe(
      buildAssAnimTags("fade", PX, PY, HEIGHT)
    );
  });

  it("slideup：\\move 从下方 dy 处上滑到位 + 轻淡入", () => {
    const dy = Math.round(HEIGHT * SUBTITLE_ANIM.slideUpOffsetRatio);
    const fadeIn = Math.round(SUBTITLE_ANIM.slideUpMs * 0.82);
    expect(buildAssAnimTags("slideup", PX, PY, HEIGHT)).toBe(
      `{\\an5\\move(${PX},${PY + dy},${PX},${PY},0,${SUBTITLE_ANIM.slideUpMs})\\fad(${fadeIn},${fadeIn})}`
    );
  });

  it("pop：从 popStartScale 缩放弹入 + 轻淡入", () => {
    const start = Math.round(SUBTITLE_ANIM.popStartScale * 100);
    const fadeIn = Math.round(SUBTITLE_ANIM.popMs * 0.67);
    expect(buildAssAnimTags("pop", PX, PY, HEIGHT)).toBe(
      `{\\an5\\pos(${PX},${PY})\\fscx${start}\\fscy${start}\\t(0,${SUBTITLE_ANIM.popMs},\\fscx100\\fscy100)\\fad(${fadeIn},${fadeIn})}`
    );
  });

  it("typewriter：定位标签同 none（逐字 alpha 在正文构造）", () => {
    expect(buildAssAnimTags("typewriter", PX, PY, HEIGHT)).toBe(
      `{\\an5\\pos(${PX},${PY})}`
    );
  });
});

describe("buildAssEventText（Dialogue 完整正文，含转义与逐字构造）", () => {
  it("非 typewriter：前缀标签 + 整段转义文本", () => {
    const out = buildAssEventText("你好", "fade", PX, PY, HEIGHT, 3);
    const f = SUBTITLE_ANIM.fadeMs;
    expect(out).toBe(`{\\an5\\pos(${PX},${PY})\\fad(${f},${f})}你好`);
  });

  it("非 typewriter：折行 \\n 转成字面 \\N", () => {
    const out = buildAssEventText("甲\n乙", "none", PX, PY, HEIGHT, 3);
    expect(out).toBe(`{\\an5\\pos(${PX},${PY})}甲\\N乙`);
  });

  it("非 typewriter：用户文本含大括号被转义，不破坏标签", () => {
    const out = buildAssEventText("a{b}", "none", PX, PY, HEIGHT, 3);
    // { } 各被转义为 \{ \}
    expect(out).toBe(`{\\an5\\pos(${PX},${PY})}a\\{b\\}`);
  });

  it("typewriter：逐字符 alpha 揭示块 + 延迟与 typewriterDelays 同源", () => {
    const text = "打字机";
    const windowSec = 3;
    const delays = typewriterDelays(text, windowSec);
    const out = buildAssEventText(
      text,
      "typewriter",
      PX,
      PY,
      HEIGHT,
      windowSec
    );
    // 前缀标签同 none
    expect(out.startsWith(`{\\an5\\pos(${PX},${PY})}`)).toBe(true);
    // 每个字符各带 alpha 块，startMs = round(delay*1000)
    const chars = Array.from(text);
    let expectedBody = "";
    for (let i = 0; i < chars.length; i += 1) {
      const startMs = Math.round(delays[i] * 1000);
      expectedBody += `{\\alpha&HFF&\\t(${startMs},${startMs + 80},\\alpha&H00&)}${chars[i]}`;
    }
    expect(out).toBe(`{\\an5\\pos(${PX},${PY})}${expectedBody}`);
    // 不叠加 \fad（避免 libass alpha 交互边界）
    expect(out.includes("\\fad(")).toBe(false);
  });

  it("typewriter：\\N 换行作为字面分隔，不被包进 per-char alpha 块", () => {
    const text = "甲\n乙";
    const windowSec = 3;
    const delays = typewriterDelays(text, windowSec);
    const out = buildAssEventText(
      text,
      "typewriter",
      PX,
      PY,
      HEIGHT,
      windowSec
    );
    // 换行位于 index 1：该处应是字面 \N，而非 alpha 块包裹
    const s0 = Math.round(delays[0] * 1000);
    const s2 = Math.round(delays[2] * 1000);
    const expected =
      `{\\an5\\pos(${PX},${PY})}` +
      `{\\alpha&HFF&\\t(${s0},${s0 + 80},\\alpha&H00&)}甲` +
      `\\N` +
      `{\\alpha&HFF&\\t(${s2},${s2 + 80},\\alpha&H00&)}乙`;
    expect(out).toBe(expected);
  });

  it("typewriter：单字符文本正确构造（无越界）", () => {
    const out = buildAssEventText("字", "typewriter", PX, PY, HEIGHT, 2);
    expect(out).toBe(
      `{\\an5\\pos(${PX},${PY})}{\\alpha&HFF&\\t(0,80,\\alpha&H00&)}字`
    );
  });
});
