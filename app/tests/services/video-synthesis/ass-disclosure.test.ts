/**
 * 导出端 AI 生成提示标识的 ASS 产出单测（合规，广电总局令第 16 号第三十四条）。
 *
 * 守住导出侧的三条硬契约：
 * ① 标识事件走 Layer 1（高于正文字幕 Layer 0）——法定标识不被字幕遮挡；
 * ② 时间窗与 lib/ai-disclosure 的 disclosureTimeWindow 一致（与预览端同源）；
 * ③ 文案经 escapeAssText 转义——用户文案里的 `{`/`}` 不能破坏 ASS 标签结构
 *    （否则标识渲染错乱甚至整条事件失效，等于没加标识）。
 */

import { describe, it, expect } from "vitest";
import {
  buildAssHeader,
  buildDisclosureEvents,
  opacityToAssAlpha,
  withAssAlpha,
} from "@/services/video-synthesis/ass/builder";
import { resolveAiDisclosure, disclosureAssPos } from "@/lib/ai-disclosure";

const W = 1080;
const H = 1920;

describe("buildDisclosureEvents · 事件结构", () => {
  it("启用时产出一条 Dialogue，Layer=1 且样式为 AiDisclosure", () => {
    const d = resolveAiDisclosure(undefined);
    const events = buildDisclosureEvents(d, 60, W, H);
    expect(events).toHaveLength(1);
    // Layer 1 保证高于正文字幕（Layer 0）
    expect(events[0].startsWith("Dialogue: 1,")).toBe(true);
    expect(events[0]).toContain(",AiDisclosure,");
  });

  it("未启用 → 零事件（用户显式关闭时成片不带标识）", () => {
    const d = resolveAiDisclosure({ enabled: false });
    expect(buildDisclosureEvents(d, 60, W, H)).toEqual([]);
  });

  it("总时长非正 → 零事件（无片可标，不产生非法时间窗）", () => {
    const d = resolveAiDisclosure(undefined);
    expect(buildDisclosureEvents(d, 0, W, H)).toEqual([]);
  });

  it("mode=always → 时间窗覆盖整片（0 到总时长）", () => {
    const d = resolveAiDisclosure({ mode: "always" });
    const [ev] = buildDisclosureEvents(d, 65.5, W, H);
    // 起点 0:00:00.00，终点 0:01:05.50
    expect(ev).toContain("0:00:00.00,0:01:05.50");
  });

  it("mode=head → 时间窗只到 headSec", () => {
    const d = resolveAiDisclosure({ mode: "head", headSec: 5 });
    const [ev] = buildDisclosureEvents(d, 120, W, H);
    expect(ev).toContain("0:00:00.00,0:00:05.00");
  });

  it("定位标签用 disclosureAssPos 的锚点与 \\an 对齐码（与预览端同源）", () => {
    const d = resolveAiDisclosure({ position: "tr" });
    const { x, y, an } = disclosureAssPos("tr", W, H);
    const [ev] = buildDisclosureEvents(d, 60, W, H);
    expect(ev).toContain(`{\\an${an}\\pos(${x},${y})}`);
  });

  it("六个位置都能产出合法的 \\an + \\pos（无位置导致事件畸形）", () => {
    for (const position of ["tl", "tr", "bl", "br", "top", "bottom"] as const) {
      const d = resolveAiDisclosure({ position });
      const [ev] = buildDisclosureEvents(d, 60, W, H);
      expect(ev).toMatch(/\{\\an[1-9]\\pos\(\d+,\d+\)\}/);
    }
  });
});

describe("buildDisclosureEvents · 文案转义（防 ASS 标签注入）", () => {
  it("文案中的大括号被转义，不破坏标签结构", () => {
    const d = resolveAiDisclosure({ text: "AI{\\b1}生成" });
    const [ev] = buildDisclosureEvents(d, 60, W, H);
    // 正文里的大括号必须是转义形态 \{ \}，而非裸 {}
    const body = ev.slice(ev.indexOf("}") + 1);
    expect(body).toContain("\\{");
    expect(body).toContain("\\}");
  });

  it("文案被渲染进事件正文（标识真的有字）", () => {
    const d = resolveAiDisclosure({ text: "本片由 AI 生成" });
    const [ev] = buildDisclosureEvents(d, 60, W, H);
    expect(ev).toContain("本片由 AI 生成");
  });
});

describe("opacityToAssAlpha / withAssAlpha · 透明度换算", () => {
  it("ASS alpha 与 CSS opacity 方向相反（1→00 不透明，0→FF 全透）", () => {
    expect(opacityToAssAlpha(1)).toBe("00");
    expect(opacityToAssAlpha(0)).toBe("FF");
  });

  it("中间值换算正确且恒为两位十六进制", () => {
    expect(opacityToAssAlpha(0.5)).toBe("80");
    expect(opacityToAssAlpha(0.85)).toMatch(/^[0-9A-F]{2}$/);
  });

  it("越界 opacity 被夹住（不产出非法 alpha）", () => {
    expect(opacityToAssAlpha(5)).toBe("00");
    expect(opacityToAssAlpha(-5)).toBe("FF");
  });

  it("withAssAlpha 只替换 alpha 通道，保留 BGR 分量", () => {
    // hexToAssColor("#FFFFFF") = &H00FFFFFF
    expect(withAssAlpha("&H00FFFFFF", "80")).toBe("&H80FFFFFF");
    expect(withAssAlpha("&H001A2B3C", "FF")).toBe("&HFF1A2B3C");
  });
});

describe("buildAssHeader · AiDisclosure 样式声明", () => {
  it("传入 disclosure 时声明 AiDisclosure 样式行", () => {
    const d = resolveAiDisclosure(undefined);
    const header = buildAssHeader(W, H, undefined, d);
    expect(header).toContain("Style: AiDisclosure,");
  });

  it("不传 disclosure 时不写该样式行（存量调用零影响）", () => {
    const header = buildAssHeader(W, H, undefined);
    expect(header).not.toContain("Style: AiDisclosure,");
  });

  it("片头信息位样式 CardCredential 恒声明（第二十七条编号行用）", () => {
    const header = buildAssHeader(W, H, undefined);
    expect(header).toContain("Style: CardCredential,");
  });

  it("标识字号随 fontScale 缩放（倍率生效，非硬编码）", () => {
    const small = buildAssHeader(
      W,
      H,
      { fontSize: 24 } as never,
      resolveAiDisclosure({ fontScale: 0.5 })
    );
    const large = buildAssHeader(
      W,
      H,
      { fontSize: 24 } as never,
      resolveAiDisclosure({ fontScale: 1.5 })
    );
    const sizeOf = (header: string): number => {
      const line = header
        .split("\n")
        .find((l) => l.startsWith("Style: AiDisclosure,"))!;
      return Number(line.split(",")[2]);
    };
    expect(sizeOf(large)).toBeGreaterThan(sizeOf(small));
  });
});
