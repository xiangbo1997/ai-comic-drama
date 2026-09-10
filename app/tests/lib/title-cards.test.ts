import { describe, it, expect } from "vitest";
import {
  buildTitleCards,
  buildCredentialLines,
  resolveTitleCardsEnabled,
  isCardSceneId,
  TITLE_CARD_SCENE_ID,
  END_CARD_SCENE_ID,
  TITLE_CARD_SEC,
  END_CARD_SEC,
  CREDENTIAL_MAX_LEN,
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

/**
 * 片头信息位编号（合规）——《微短剧管理办法》（广电总局令第 16 号，
 * 2026-09-01 施行）第二十七条：片头应「在明显位置标注剧名、许可证号、
 * 批准文件编号、节目编号」。
 *
 * 关键契约：只渲染用户实际填写的项，绝不编造占位编号（编造的许可证号
 * 比不填更糟——那是虚假标注）。
 */
describe("buildCredentialLines · 片头信息位（第二十七条）", () => {
  it("缺省 / 空对象 → 无编号行（片头卡回到剧名+集数旧行为）", () => {
    expect(buildCredentialLines(undefined)).toEqual([]);
    expect(buildCredentialLines(null)).toEqual([]);
    expect(buildCredentialLines({})).toEqual([]);
  });

  it("三项齐全 → 三行 credential，顺序为许可证号/批准文号/节目编号", () => {
    const lines = buildCredentialLines({
      licenseNo: "甲第123号",
      approvalNo: "批2026-001",
      programNo: "节目0007",
    });
    expect(lines.map((l) => l.role)).toEqual([
      "credential",
      "credential",
      "credential",
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "许可证号：甲第123号",
      "批准文号：批2026-001",
      "节目编号：节目0007",
    ]);
  });

  it("只填部分 → 只渲染填了的项（不编造占位号）", () => {
    const lines = buildCredentialLines({ licenseNo: "甲第123号" });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("许可证号：甲第123号");
  });

  it("空串 / 纯空白视为未填（不产出空编号行）", () => {
    expect(buildCredentialLines({ licenseNo: "", approvalNo: "   " })).toEqual(
      []
    );
  });

  it("超长编号被裁剪到 CREDENTIAL_MAX_LEN（防压画面）", () => {
    const long = "A".repeat(CREDENTIAL_MAX_LEN + 50);
    const lines = buildCredentialLines({ licenseNo: long });
    // 文案 = 前缀「许可证号：」+ 裁剪后的编号
    expect(lines[0].text).toBe(`许可证号：${"A".repeat(CREDENTIAL_MAX_LEN)}`);
  });

  it("编号内换行被折叠（卡片是一行标注不是段落）", () => {
    const lines = buildCredentialLines({ licenseNo: "甲第\n123号" });
    expect(lines[0].text).toBe("许可证号：甲第 123号");
  });
});

describe("buildTitleCards · 片头信息位接入（第二十七条）", () => {
  it("config.credentials 填了 → 片头卡在剧名/集数之后追加编号行", () => {
    const { intro } = buildTitleCards({
      projectTitle: "我的剧",
      episodeNumber: 3,
      config: { title: true, credentials: { licenseNo: "甲第123号" } },
      coverImageUrl: "https://example.com/a.png",
      isSeries: true,
    });
    expect(intro).not.toBeNull();
    // 顺序：剧名 → 集数 → 编号
    expect(intro!.lines.map((l) => l.role)).toEqual([
      "title",
      "sub",
      "credential",
    ]);
    expect(intro!.lines[2].text).toBe("许可证号：甲第123号");
  });

  it("未填 credentials → 片头卡行数与旧行为一致（零回归）", () => {
    const { intro } = buildTitleCards({
      projectTitle: "我的剧",
      episodeNumber: 3,
      config: { title: true },
      isSeries: true,
    });
    expect(intro!.lines.map((l) => l.role)).toEqual(["title", "sub"]);
  });

  it("编号不会出现在片尾钩子卡上（第二十七条只约束片头）", () => {
    const { outro } = buildTitleCards({
      projectTitle: "我的剧",
      hookText: "悬念",
      config: { end: true, credentials: { licenseNo: "甲第123号" } },
      isSeries: true,
    });
    expect(outro!.lines.some((l) => l.role === "credential")).toBe(false);
  });
});
