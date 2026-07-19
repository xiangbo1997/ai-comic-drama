import { describe, it, expect } from "vitest";
import {
  buildTitleCards,
  resolveTitleCardsEnabled,
  isCardSceneId,
  TITLE_CARD_SCENE_ID,
  END_CARD_SCENE_ID,
  TITLE_CARD_SEC,
  END_CARD_SEC,
} from "@/lib/title-cards";

describe("resolveTitleCardsEnabled · 缺省契约", () => {
  it("系列项目缺省双卡开启", () => {
    const r = resolveTitleCardsEnabled(null, true);
    expect(r).toEqual({ title: true, end: true });
  });

  it("非系列项目缺省双卡关闭", () => {
    const r = resolveTitleCardsEnabled(null, false);
    expect(r).toEqual({ title: false, end: false });
  });

  it("已存配置逐项优先（即便与系列缺省相反）", () => {
    // 系列项目但显式关掉片头，保留片尾缺省
    const r = resolveTitleCardsEnabled({ title: false }, true);
    expect(r).toEqual({ title: false, end: true });
  });

  it("非系列显式开启片尾 → 生效", () => {
    const r = resolveTitleCardsEnabled({ end: true }, false);
    expect(r).toEqual({ title: false, end: true });
  });

  it("undefined config 等价于缺省契约", () => {
    expect(resolveTitleCardsEnabled(undefined, true)).toEqual({
      title: true,
      end: true,
    });
  });
});

describe("isCardSceneId", () => {
  it("识别片头/片尾卡保留 id", () => {
    expect(isCardSceneId(TITLE_CARD_SCENE_ID)).toBe(true);
    expect(isCardSceneId(END_CARD_SCENE_ID)).toBe(true);
  });

  it("普通分镜 id 非卡片", () => {
    expect(isCardSceneId("cku7abc123")).toBe(false);
    expect(isCardSceneId("")).toBe(false);
  });
});

describe("buildTitleCards · 系列双卡", () => {
  it("系列项目产出片头（剧名+集数）与片尾（钩子+追更）双卡", () => {
    const { intro, outro } = buildTitleCards({
      projectTitle: "重生之逆袭人生",
      episodeNumber: 3,
      hookText: "她的秘密即将被揭穿",
      coverImageUrl: "https://x/first.webp",
      endImageUrl: "https://x/last.webp",
      config: null,
      isSeries: true,
    });

    expect(intro).not.toBeNull();
    expect(intro!.kind).toBe("title");
    expect(intro!.durationSec).toBe(TITLE_CARD_SEC);
    expect(intro!.imageUrl).toBe("https://x/first.webp");
    // 首行剧名（title），次行集数（sub）
    expect(intro!.lines[0]).toEqual({
      text: "重生之逆袭人生",
      role: "title",
    });
    expect(
      intro!.lines.some((l) => l.role === "sub" && l.text.includes("3"))
    ).toBe(true);

    expect(outro).not.toBeNull();
    expect(outro!.kind).toBe("end");
    expect(outro!.durationSec).toBe(END_CARD_SEC);
    expect(outro!.imageUrl).toBe("https://x/last.webp");
    // 钩子行用传入文案，追更行为 cta
    expect(outro!.lines.some((l) => l.role === "hook")).toBe(true);
    expect(outro!.lines.some((l) => l.role === "cta")).toBe(true);
  });

  it("无 hookText → 片尾用通用追更文案（仍产卡）", () => {
    const { outro } = buildTitleCards({
      projectTitle: "剧",
      hookText: null,
      endImageUrl: "https://x/e.webp",
      isSeries: true,
    });
    expect(outro).not.toBeNull();
    const hook = outro!.lines.find((l) => l.role === "hook");
    expect(hook?.text).toBeTruthy();
  });

  it("无集数 → 片头只有剧名一行", () => {
    const { intro } = buildTitleCards({
      projectTitle: "独立剧名",
      coverImageUrl: "https://x/c.webp",
      isSeries: true,
    });
    expect(intro!.lines.filter((l) => l.role === "sub")).toHaveLength(0);
    expect(intro!.lines[0].role).toBe("title");
  });
});

describe("buildTitleCards · 非系列缺省关闭", () => {
  it("非系列且无配置 → 双卡均 null", () => {
    const { intro, outro } = buildTitleCards({
      projectTitle: "单片",
      coverImageUrl: "https://x/c.webp",
      endImageUrl: "https://x/e.webp",
      isSeries: false,
    });
    expect(intro).toBeNull();
    expect(outro).toBeNull();
  });

  it("非系列显式开启片头 → 产片头卡", () => {
    const { intro, outro } = buildTitleCards({
      projectTitle: "单片",
      coverImageUrl: "https://x/c.webp",
      config: { title: true },
      isSeries: false,
    });
    expect(intro).not.toBeNull();
    expect(outro).toBeNull();
  });
});

describe("buildTitleCards · 底图缺省", () => {
  it("底图为 null 时卡片 imageUrl 为 null（调用方据此跳过注入）", () => {
    const { intro, outro } = buildTitleCards({
      projectTitle: "剧",
      episodeNumber: 1,
      isSeries: true,
    });
    // 卡片仍产出（enabled），但 imageUrl=null 由导出端跳过注入
    expect(intro!.imageUrl).toBeNull();
    expect(outro!.imageUrl).toBeNull();
  });
});
