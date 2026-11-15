import { describe, expect, it } from "vitest";
import { legacyTitleLocationIds } from "@/lib/drama-locations";

describe("历史短剧地点校准识别", () => {
  const scenes = [
    {
      id: "s1",
      order: 0,
      locationKey: "剑悬颈",
      description: "刑台上剑悬颈边",
    },
    {
      id: "s2",
      order: 1,
      locationKey: "手动地点",
      description: "刑台上玉简将焚",
    },
  ];
  const doc = {
    scenes: [
      { title: "剑悬颈", description: "刑台上剑悬颈边" },
      { title: "玉简将焚", description: "刑台上玉简将焚" },
    ],
  };
  it("仅识别确实来自旧脚本标题的标签，保留手动地点", () => {
    expect([...legacyTitleLocationIds(scenes, doc)]).toEqual(["s1"]);
  });
  it("显式地点、新改画面、非短剧来源不自动重标", () => {
    expect([
      ...legacyTitleLocationIds(scenes, {
        scenes: [{ ...doc.scenes[0], locationKey: "剑悬颈" }],
      }),
    ]).toEqual([]);
    expect([
      ...legacyTitleLocationIds(
        [{ ...scenes[0], description: "用户修改的新画面" }],
        doc
      ),
    ]).toEqual([]);
    expect([...legacyTitleLocationIds(scenes, null)]).toEqual([]);
  });
});
