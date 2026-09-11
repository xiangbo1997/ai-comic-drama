import { describe, it, expect } from "vitest";
import {
  EXPRESSION_KEYS,
  EXPRESSION_SPECS,
  EXPRESSION_POSE_PREFIX,
  getExpressionSpec,
  toExpressionPose,
  parseExpressionPose,
  isExpressionPose,
  inferExpressionKey,
  pickExpressionAssetUrl,
  extractExpressionSheet,
} from "@/lib/expression-sheet";

describe("表情规格表", () => {
  it("6 种表情，key 与 EXPRESSION_KEYS 一一对应且无重复", () => {
    expect(EXPRESSION_SPECS).toHaveLength(6);
    expect(EXPRESSION_SPECS.map((s) => s.key)).toEqual([...EXPRESSION_KEYS]);
    expect(new Set(EXPRESSION_KEYS).size).toBe(EXPRESSION_KEYS.length);
  });

  it("每种表情都有中文名与非空英文 prompt", () => {
    for (const spec of EXPRESSION_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.prompt.length).toBeGreaterThan(0);
    }
  });

  it("prompt 写到五官粒度，而非 'angry face' 这类标签词", () => {
    // 标签词只会让模型套用它自己的平均脸，各次生成之间仍然漂移
    for (const spec of EXPRESSION_SPECS) {
      expect(spec.prompt).toMatch(/eyebrow|eyes|mouth/);
    }
  });

  it("prompt 不含会触发九宫格拼版的措辞（血泪教训）", () => {
    for (const spec of EXPRESSION_SPECS) {
      expect(spec.prompt.toLowerCase()).not.toContain("expression sheet");
      expect(spec.prompt.toLowerCase()).not.toContain("character sheet");
      expect(spec.prompt.toLowerCase()).not.toContain("reference sheet");
    }
  });

  it("羞怯有独立的脸红与视线回避描述（入选的结构性判据）", () => {
    const spec = getExpressionSpec("embarrassed");
    expect(spec?.prompt).toMatch(/blush/);
    expect(spec?.prompt).toMatch(/averted|away/);
  });

  it("getExpressionSpec 对未知/空输入返回 undefined", () => {
    expect(getExpressionSpec("smug")).toBeUndefined();
    expect(getExpressionSpec("")).toBeUndefined();
    expect(getExpressionSpec(null)).toBeUndefined();
    expect(getExpressionSpec(undefined)).toBeUndefined();
  });
});

describe("pose 命名空间编解码", () => {
  it("toExpressionPose 加前缀，parseExpressionPose 可逆", () => {
    for (const key of EXPRESSION_KEYS) {
      const pose = toExpressionPose(key);
      expect(pose).toBe(`${EXPRESSION_POSE_PREFIX}${key}`);
      expect(parseExpressionPose(pose)).toBe(key);
    }
  });

  it("三视图 pose 不会被误解析为表情（命名空间隔离）", () => {
    for (const pose of ["front", "side", "back", "3quarter"]) {
      expect(parseExpressionPose(pose)).toBeUndefined();
      expect(isExpressionPose(pose)).toBe(false);
    }
  });

  it("空/null pose 安全", () => {
    expect(parseExpressionPose(null)).toBeUndefined();
    expect(parseExpressionPose(undefined)).toBeUndefined();
    expect(parseExpressionPose("")).toBeUndefined();
    expect(isExpressionPose(null)).toBe(false);
  });

  it("脏数据 expr:unknown 不被当作合法表情消费", () => {
    // 它属于表情命名空间（不该进朝向兜底），但解析不出 key（不该被当参考图用）
    expect(isExpressionPose("expr:whatever")).toBe(true);
    expect(parseExpressionPose("expr:whatever")).toBeUndefined();
  });
});

describe("inferExpressionKey — 分镜 → 表情锚", () => {
  it("按 Scene.emotion 枚举映射", () => {
    expect(inferExpressionKey({ emotion: "neutral" })).toBe("neutral");
    expect(inferExpressionKey({ emotion: "happy" })).toBe("joy");
    expect(inferExpressionKey({ emotion: "sad" })).toBe("sorrow");
    expect(inferExpressionKey({ emotion: "angry" })).toBe("anger");
    expect(inferExpressionKey({ emotion: "surprised" })).toBe("surprise");
  });

  it("fear 复用 surprise（核心五官几何相同）", () => {
    expect(inferExpressionKey({ emotion: "fear" })).toBe("surprise");
  });

  it("大小写与空白容忍", () => {
    expect(inferExpressionKey({ emotion: " ANGRY " })).toBe("anger");
  });

  it("羞怯线索优先于 emotion 映射", () => {
    expect(
      inferExpressionKey({ emotion: "happy", description: "她害羞地低下头" })
    ).toBe("embarrassed");
    expect(
      inferExpressionKey({ emotion: "happy", description: "she blushed" })
    ).toBe("embarrassed");
  });

  it("无 emotion 时不回落 neutral（环境镜不该被塞平静脸特写）", () => {
    expect(inferExpressionKey({})).toBeUndefined();
    expect(inferExpressionKey({ emotion: null })).toBeUndefined();
    expect(inferExpressionKey({ emotion: "" })).toBeUndefined();
  });

  it("未知 emotion 值返回 undefined", () => {
    expect(inferExpressionKey({ emotion: "excited" })).toBeUndefined();
  });

  it("「气得脸红」不被误判为羞怯", () => {
    // 只收显式害羞信号；裸「脸红」不进模式表
    expect(
      inferExpressionKey({ emotion: "angry", description: "他气得脸红脖子粗" })
    ).toBe("anger");
  });
});

describe("pickExpressionAssetUrl — 选表情图", () => {
  const assets = [
    { url: "/front.png", pose: "front" },
    { url: "/anger.png", pose: "expr:anger" },
    { url: "/joy.png", pose: "expr:joy" },
  ];

  it("命中对应表情", () => {
    expect(pickExpressionAssetUrl(assets, "anger")).toBe("/anger.png");
    expect(pickExpressionAssetUrl(assets, "joy")).toBe("/joy.png");
  });

  it("没有该表情时返回 undefined，绝不退而求其次拿另一种表情", () => {
    // 用愤怒的脸去锚一个悲伤镜比没有表情锚更糟
    expect(pickExpressionAssetUrl(assets, "sorrow")).toBeUndefined();
  });

  it("空资产安全", () => {
    expect(pickExpressionAssetUrl([], "anger")).toBeUndefined();
    expect(pickExpressionAssetUrl(null, "anger")).toBeUndefined();
    expect(pickExpressionAssetUrl(undefined, "anger")).toBeUndefined();
  });
});

describe("extractExpressionSheet — UI 展示用", () => {
  it("提取全部表情图，忽略三视图", () => {
    const sheet = extractExpressionSheet([
      { url: "/front.png", pose: "front" },
      { url: "/anger.png", pose: "expr:anger" },
      { url: "/joy.png", pose: "expr:joy" },
    ]);
    expect(sheet).toEqual({ anger: "/anger.png", joy: "/joy.png" });
  });

  it("同一表情多张时取最后一张（重生成覆盖旧图）", () => {
    const sheet = extractExpressionSheet([
      { url: "/old.png", pose: "expr:anger" },
      { url: "/new.png", pose: "expr:anger" },
    ]);
    expect(sheet.anger).toBe("/new.png");
  });

  it("空输入返回空对象", () => {
    expect(extractExpressionSheet([])).toEqual({});
    expect(extractExpressionSheet(null)).toEqual({});
  });
});

describe("extractExpressionSheet — 按 createdAt 取最新（不依赖入参顺序）", () => {
  it("desc 顺序传入也取最新那张", () => {
    // characters 路由按 createdAt desc 返回；若依赖遍历顺序会取到最旧的
    const sheet = extractExpressionSheet([
      { url: "/new.png", pose: "expr:anger", createdAt: "2026-02-01" },
      { url: "/old.png", pose: "expr:anger", createdAt: "2026-01-01" },
    ]);
    expect(sheet.anger).toBe("/new.png");
  });

  it("asc 顺序传入结果一致", () => {
    const sheet = extractExpressionSheet([
      { url: "/old.png", pose: "expr:anger", createdAt: "2026-01-01" },
      { url: "/new.png", pose: "expr:anger", createdAt: "2026-02-01" },
    ]);
    expect(sheet.anger).toBe("/new.png");
  });
});
