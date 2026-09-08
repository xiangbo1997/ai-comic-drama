import { describe, it, expect } from "vitest";
import {
  aspectRatioToCss,
  emptyAspectClass,
  resolveEffect,
  resolveTransition,
  injectTitleCards,
  computeDurations,
  overallProgressAt,
  elapsedAt,
  formatTime,
  visibleStickers,
  watermarkPositionClass,
  stageScale,
} from "@/components/preview-player/helpers";
import type { ScenePreview } from "@/types";
import type { SceneEffect, Sticker, Transition } from "@/types/export-style";
import {
  TITLE_CARD_SCENE_ID,
  END_CARD_SCENE_ID,
  type CardSpec,
} from "@/lib/title-cards";

const scene = (over: Partial<ScenePreview> & { id: string }): ScenePreview => ({
  order: 0,
  duration: 3,
  imageUrl: null,
  videoUrl: null,
  audioUrl: null,
  dialogue: null,
  narration: null,
  ...over,
});

describe("aspectRatioToCss（画面框比例）", () => {
  it("合法比例原样换算为 CSS aspect-ratio", () => {
    expect(aspectRatioToCss("9:16")).toBe("9 / 16");
    expect(aspectRatioToCss("1:1")).toBe("1 / 1");
    expect(aspectRatioToCss("16:9")).toBe("16 / 9");
  });

  it("非法/缺省值回退 16/9", () => {
    expect(aspectRatioToCss("abc")).toBe("16 / 9");
    expect(aspectRatioToCss("0:0")).toBe("16 / 9");
    expect(aspectRatioToCss("")).toBe("16 / 9");
  });
});

describe("emptyAspectClass（空态占位比例类）", () => {
  it("按比例映射到 Tailwind 类，未知值回退 aspect-video", () => {
    expect(emptyAspectClass("9:16")).toBe("aspect-[9/16]");
    expect(emptyAspectClass("1:1")).toBe("aspect-square");
    expect(emptyAspectClass("16:9")).toBe("aspect-video");
    expect(emptyAspectClass("4:3")).toBe("aspect-video");
  });
});

describe("resolveEffect（分镜滤镜/变速/运镜/冲击）", () => {
  it("无配置时 motion 为 undefined（区别于显式关闭的 null）", () => {
    const r = resolveEffect("s1", []);
    expect(r.motion).toBeUndefined();
    expect(r.effect).toBeNull();
    expect(r.speed).toBe(1);
    expect(r.impact).toBeNull();
  });

  it("有配置但未设 motion 时为 null（显式关闭）", () => {
    const effects = [
      { sceneId: "s1", effect: null },
    ] as unknown as SceneEffect[];
    expect(resolveEffect("s1", effects).motion).toBeNull();
  });

  it("变速夹到 [0.25, 4]，非法值回退 1", () => {
    const mk = (speed: unknown) =>
      [{ sceneId: "s1", speed }] as unknown as SceneEffect[];
    expect(resolveEffect("s1", mk(0.1)).speed).toBe(0.25);
    expect(resolveEffect("s1", mk(9)).speed).toBe(4);
    expect(resolveEffect("s1", mk(2)).speed).toBe(2);
    expect(resolveEffect("s1", mk("x")).speed).toBe(1);
  });
});

describe("resolveTransition（转场类型与时长）", () => {
  it("无任何存储配置时默认硬切 none，时长 0", () => {
    expect(resolveTransition(0, undefined)).toEqual({
      type: "none",
      duration: 0,
    });
    expect(resolveTransition(0, [])).toEqual({ type: "none", duration: 0 });
  });

  it("有存储配置但该项缺失时回落 fade 0.3（存量兼容）", () => {
    const ts = [{ type: "wipeleft", duration: 0.5 }] as Transition[];
    expect(resolveTransition(1, ts)).toEqual({ type: "fade", duration: 0.3 });
  });

  it("显式转场时长夹到 [0.1, 2]", () => {
    const mk = (duration: number) =>
      [{ type: "fade", duration }] as Transition[];
    expect(resolveTransition(0, mk(0.01)).duration).toBe(0.1);
    expect(resolveTransition(0, mk(5)).duration).toBe(2);
    expect(resolveTransition(0, mk(1.2)).duration).toBe(1.2);
  });

  it("显式 none 视为无转场（时长 0）", () => {
    const ts = [{ type: "none", duration: 1 }] as Transition[];
    expect(resolveTransition(0, ts)).toEqual({ type: "none", duration: 0 });
  });
});

describe("injectTitleCards（片头/片尾卡注入虚拟分镜）", () => {
  const card = (durationSec: number): CardSpec =>
    ({
      durationSec,
      imageUrl: "https://example.com/c.png",
      lines: [{ role: "title", text: "标题" }],
    }) as CardSpec;

  it("两卡都为 null 时原样返回（同一引用，不产生新数组）", () => {
    const raw = [scene({ id: "s1" })];
    const r = injectTitleCards(raw, { intro: null, outro: null });
    expect(r.scenes).toBe(raw);
    expect(r.cardSpecById.size).toBe(0);
  });

  it("intro 前置、outro 后置，并用保留 sceneId 建立查表", () => {
    const raw = [scene({ id: "s1" }), scene({ id: "s2" })];
    const r = injectTitleCards(raw, { intro: card(2), outro: card(3) });
    expect(r.scenes.map((s) => s.id)).toEqual([
      TITLE_CARD_SCENE_ID,
      "s1",
      "s2",
      END_CARD_SCENE_ID,
    ]);
    expect(r.scenes[0].duration).toBe(2);
    expect(r.scenes[3].duration).toBe(3);
    // 卡片为图片分镜：无视频/配音/对白 → 天然不出普通字幕
    expect(r.scenes[0].videoUrl).toBeNull();
    expect(r.scenes[0].dialogue).toBeNull();
    expect(r.cardSpecById.get(TITLE_CARD_SCENE_ID)?.durationSec).toBe(2);
    expect(r.cardSpecById.get(END_CARD_SCENE_ID)?.durationSec).toBe(3);
  });

  it("只有 outro 时不注入片头", () => {
    const raw = [scene({ id: "s1" })];
    const r = injectTitleCards(raw, { intro: null, outro: card(3) });
    expect(r.scenes.map((s) => s.id)).toEqual(["s1", END_CARD_SCENE_ID]);
  });
});

describe("computeDurations（有效时长 + 前缀和）", () => {
  it("图片分镜用 DB 声明时长，视频分镜优先实测时长", () => {
    const scenes = [
      scene({ id: "img", duration: 3 }),
      scene({ id: "vid", duration: 3, videoUrl: "v.mp4" }),
    ];
    const r = computeDurations(scenes, [], { vid: 8 });
    expect(r.effDurs).toEqual([3, 8]);
    expect(r.prefixDurations).toEqual([0, 3, 11]);
    expect(r.totalDuration).toBe(11);
  });

  it("视频无实测时长时回退 DB 声明值", () => {
    const scenes = [scene({ id: "vid", duration: 3, videoUrl: "v.mp4" })];
    expect(computeDurations(scenes, [], {}).effDurs).toEqual([3]);
  });

  it("变速影响有效时长（时长 / speed），倍率夹到 [0.25, 4]", () => {
    const scenes = [scene({ id: "s1", duration: 4 })];
    const fx = (speed: number) =>
      [{ sceneId: "s1", speed }] as unknown as SceneEffect[];
    expect(computeDurations(scenes, fx(2), {}).effDurs).toEqual([2]);
    expect(computeDurations(scenes, fx(0.5), {}).effDurs).toEqual([8]);
    // 超界夹取：9 → 4
    expect(computeDurations(scenes, fx(9), {}).effDurs).toEqual([1]);
  });

  it("空分镜列表时总时长为 0", () => {
    const r = computeDurations([], [], {});
    expect(r.totalDuration).toBe(0);
    expect(r.prefixDurations).toEqual([0]);
  });
});

describe("overallProgressAt / elapsedAt（整片时钟）", () => {
  const prefix = [0, 3, 11];
  const eff = [3, 8];

  it("整片已播时刻 = 前缀和 + 当前镜有效时长 × progress", () => {
    expect(elapsedAt(prefix, eff, 0, 0)).toBe(0);
    expect(elapsedAt(prefix, eff, 0, 0.5)).toBe(1.5);
    expect(elapsedAt(prefix, eff, 1, 0.5)).toBe(7);
  });

  it("整体进度按总时长归一", () => {
    expect(overallProgressAt(prefix, eff, 0, 0, 11, true)).toBe(0);
    expect(overallProgressAt(prefix, eff, 1, 1, 11, true)).toBe(1);
    expect(overallProgressAt(prefix, eff, 1, 0, 11, true)).toBeCloseTo(3 / 11);
  });

  it("无当前镜时只计已完成镜；总时长为 0 时返回 0", () => {
    expect(overallProgressAt(prefix, eff, 1, 0.9, 11, false)).toBeCloseTo(
      3 / 11
    );
    expect(overallProgressAt([0], [], 0, 0.5, 0, true)).toBe(0);
  });
});

describe("formatTime（m:ss）", () => {
  it("秒数向下取整并补零", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9.9)).toBe("0:09");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
});

describe("visibleStickers（贴图时间窗过滤）", () => {
  const mk = (over: Partial<Sticker> & { id: string }): Sticker =>
    ({
      sceneId: "s1",
      imageUrl: "a.png",
      x: 0.5,
      y: 0.5,
      scale: 0.2,
      ...over,
    }) as Sticker;

  it("只保留属于当前分镜且有图的贴图", () => {
    const list = [
      mk({ id: "a" }),
      mk({ id: "b", sceneId: "other" }),
      mk({ id: "c", imageUrl: "" }),
    ];
    expect(visibleStickers(list, "s1", 0, 5).map((s) => s.id)).toEqual(["a"]);
  });

  it("startOffset 之前不显示，窗口内显示（左闭右开）", () => {
    const list = [
      mk({ id: "a", startOffset: 1, duration: 2 } as Partial<Sticker> & {
        id: string;
      }),
    ];
    expect(visibleStickers(list, "s1", 0.5, 5)).toHaveLength(0);
    expect(visibleStickers(list, "s1", 1, 5)).toHaveLength(1);
    expect(visibleStickers(list, "s1", 2.9, 5)).toHaveLength(1);
    expect(visibleStickers(list, "s1", 3, 5)).toHaveLength(0);
  });

  it("stickers 为 undefined 时返回空数组", () => {
    expect(visibleStickers(undefined, "s1", 0, 5)).toEqual([]);
  });
});

describe("watermarkPositionClass（水印定位）", () => {
  it("四角与居中各有定位类，未知值回退右下", () => {
    expect(watermarkPositionClass("tl")).toBe("top-3 left-3");
    expect(watermarkPositionClass("tr")).toBe("top-3 right-3");
    expect(watermarkPositionClass("bl")).toBe("bottom-3 left-3");
    expect(watermarkPositionClass("center")).toContain("-translate-x-1/2");
    expect(watermarkPositionClass("br")).toBe("right-3 bottom-3");
    expect(watermarkPositionClass(undefined)).toBe("right-3 bottom-3");
  });
});

describe("stageScale（描边随画面高等比缩放）", () => {
  it("未测得画面高（0）时回退基准高，系数为 1", () => {
    expect(stageScale(0, 1080)).toBe(1);
  });

  it("按 画面框高 / 基准高 缩放", () => {
    expect(stageScale(540, 1080)).toBe(0.5);
    expect(stageScale(2160, 1080)).toBe(2);
  });
});
