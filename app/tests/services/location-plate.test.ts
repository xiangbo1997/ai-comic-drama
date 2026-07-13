import { describe, it, expect } from "vitest";
import {
  mergeLocations,
  parseDescribeOutput,
  parseLabelOutput,
  buildPlatePrompt,
  buildPlateNegative,
  buildDescribePrompt,
  PLATE_NEGATIVE_BASE,
  type LocationScene,
  type LocationRow,
  type DescribeTarget,
  type LabelScene,
} from "@/services/generation/location-plate";

function scene(
  id: string,
  order: number,
  locationKey?: string | null,
  description?: string
): LocationScene {
  return { id, order, locationKey, description: description ?? `镜${order}` };
}

describe("mergeLocations", () => {
  it("按分镜 locationKey 去重聚合并统计分镜数", () => {
    const scenes = [
      scene("a", 0, "客厅"),
      scene("b", 1, "客厅"),
      scene("c", 2, "操场"),
    ];
    const merged = mergeLocations(scenes, []);
    expect(merged).toHaveLength(2);
    const living = merged.find((m) => m.locationKey === "客厅");
    expect(living?.sceneCount).toBe(2);
    expect(living?.id).toBeUndefined();
    expect(living?.imageUrl).toBeNull();
  });

  it("左连接 ProjectLocation 行：带出 id / 描述 / 锚图", () => {
    const scenes = [scene("a", 0, "客厅")];
    const rows: LocationRow[] = [
      {
        id: "loc1",
        locationKey: "客厅",
        description: "温馨客厅",
        imageUrl: "https://x/plate.webp",
      },
    ];
    const merged = mergeLocations(scenes, rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("loc1");
    expect(merged[0].description).toBe("温馨客厅");
    expect(merged[0].imageUrl).toBe("https://x/plate.webp");
  });

  it("忽略 locationKey 为空/空白的分镜（不产生地点）", () => {
    const scenes = [
      scene("a", 0, null),
      scene("b", 1, "  "),
      scene("c", 2, ""),
    ];
    expect(mergeLocations(scenes, [])).toHaveLength(0);
  });

  it("已建行但无对应分镜也保留（sceneCount=0，锚图不凭空消失）", () => {
    const rows: LocationRow[] = [
      { id: "loc1", locationKey: "旧地点", imageUrl: "u" },
    ];
    const merged = mergeLocations([], rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].sceneCount).toBe(0);
    expect(merged[0].imageUrl).toBe("u");
  });

  it("按分镜数降序、地点名升序稳定排序", () => {
    const scenes = [
      scene("a", 0, "B地点"),
      scene("b", 1, "A地点"),
      scene("c", 2, "A地点"),
    ];
    const merged = mergeLocations(scenes, []);
    expect(merged.map((m) => m.locationKey)).toEqual(["A地点", "B地点"]);
  });
});

describe("parseDescribeOutput", () => {
  const targets: DescribeTarget[] = [
    { locationKey: "客厅", sceneDescriptions: [] },
    { locationKey: "操场", sceneDescriptions: [] },
  ];

  it("正常解析并 clamp 到 80 字", () => {
    const raw = JSON.stringify([
      { key: "客厅", description: "阳光洒入的温馨客厅" },
    ]);
    const out = parseDescribeOutput(raw, targets);
    expect(out).toHaveLength(1);
    expect(out[0].locationKey).toBe("客厅");
    expect(out[0].description).toBe("阳光洒入的温馨客厅");
  });

  it("容忍代码围栏 / 前后杂字", () => {
    const raw =
      '好的：```json\n[{"key":"操场","description":"空旷的学校操场"}]\n```';
    const out = parseDescribeOutput(raw, targets);
    expect(out).toHaveLength(1);
    expect(out[0].locationKey).toBe("操场");
  });

  it("丢弃 key 不在目标集 / 描述为空 / 重复 key 的条目", () => {
    const raw = JSON.stringify([
      { key: "不存在的地点", description: "x" },
      { key: "客厅", description: "" },
      { key: "操场", description: "描述1" },
      { key: "操场", description: "描述2" },
    ]);
    const out = parseDescribeOutput(raw, targets);
    expect(out).toHaveLength(1);
    expect(out[0].locationKey).toBe("操场");
    expect(out[0].description).toBe("描述1");
  });

  it("非 JSON 数组 → 抛错", () => {
    expect(() => parseDescribeOutput("no array here", targets)).toThrow();
  });
});

describe("parseLabelOutput", () => {
  const scenes: LabelScene[] = [
    { id: "s0", order: 0 },
    { id: "s1", order: 1 },
    { id: "s2", order: 2 },
  ];

  it("按 index 映射回 sceneId 并 clamp 标签", () => {
    const raw = JSON.stringify([
      { index: 0, locationKey: "客厅" },
      { index: 2, locationKey: "操场" },
    ]);
    const out = parseLabelOutput(raw, scenes);
    expect(out).toEqual([
      { sceneId: "s0", locationKey: "客厅" },
      { sceneId: "s2", locationKey: "操场" },
    ]);
  });

  it("丢弃越界 / 非整数 index / 空标签 / 重复 index", () => {
    const raw = JSON.stringify([
      { index: 5, locationKey: "越界" },
      { index: 1.5, locationKey: "非整数" },
      { index: 1, locationKey: "" },
      { index: 0, locationKey: "客厅" },
      { index: 0, locationKey: "重复" },
    ]);
    const out = parseLabelOutput(raw, scenes);
    expect(out).toEqual([{ sceneId: "s0", locationKey: "客厅" }]);
  });

  it("非 JSON 数组 → 抛错", () => {
    expect(() => parseLabelOutput("{}", scenes)).toThrow();
  });
});

describe("buildPlatePrompt", () => {
  it("含无人物空场景硬约束（正向）", () => {
    const p = buildPlatePrompt({
      locationKey: "客厅",
      description: "温馨客厅",
      sceneHints: ["沙发与茶几"],
      style: "anime",
    });
    expect(p.toLowerCase()).toContain("no people");
    expect(p.toLowerCase()).toContain("empty scene");
    expect(p.toLowerCase()).toContain("establishing shot");
    // 注入了画风锚定词 + 地点 + 描述 + 线索
    expect(p).toContain("客厅");
    expect(p).toContain("温馨客厅");
    expect(p).toContain("沙发与茶几");
    expect(p.toLowerCase()).toContain("anime");
  });

  it("注入画风包场景规则 / 色彩系统（完整包）", () => {
    const p = buildPlatePrompt({
      locationKey: "街道",
      description: null,
      sceneHints: [],
      style: "guofeng2d",
    });
    // guofeng2d 有 sceneRules（东方意境）+ colorSystem（中国传统色）
    expect(p).toContain("东方意境");
    expect(p).toContain("中国传统色");
  });

  it("legacy 平面风格：不产生空段落垃圾（无连续多空格）", () => {
    const p = buildPlatePrompt({
      locationKey: "地牢",
      description: null,
      sceneHints: [],
      style: "oil", // legacy：sceneRules/colorSystem 为空串
    });
    // legacy 包 anchor 仍在，但空的 sceneRules/colorSystem 被过滤，无双空格
    expect(p).not.toMatch(/\s{2,}/);
    expect(p.toLowerCase()).toContain("oil painting");
    expect(p.toLowerCase()).toContain("no people");
  });

  it("未知/空 style 回落日漫（不抛错）", () => {
    const p = buildPlatePrompt({
      locationKey: "x",
      sceneHints: [],
      style: null,
    });
    expect(p.toLowerCase()).toContain("anime");
  });
});

describe("buildPlateNegative", () => {
  it("含基础人物排斥词 + 画风包特化负向", () => {
    const neg = buildPlateNegative("realistic");
    expect(neg).toContain(PLATE_NEGATIVE_BASE);
    // realistic 负向含 cartoon
    expect(neg).toContain("cartoon");
  });

  it("legacy 风格也能拼（不抛错）", () => {
    const neg = buildPlateNegative("oil");
    expect(neg).toContain("person");
  });
});

describe("buildDescribePrompt", () => {
  it("每地点一行，含地点名与画面样本", () => {
    const targets: DescribeTarget[] = [
      { locationKey: "客厅", sceneDescriptions: ["母亲在做饭", "孩子看电视"] },
    ];
    const prompt = buildDescribePrompt(targets);
    expect(prompt).toContain("客厅");
    expect(prompt).toContain("母亲在做饭");
    // 要求 JSON 输出约束存在
    expect(prompt).toContain("JSON");
  });
});
