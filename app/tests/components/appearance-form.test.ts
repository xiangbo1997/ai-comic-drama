import { describe, it, expect } from "vitest";
import {
  mergeAppearanceDraft,
  toAppearanceFormData,
  isAppearanceEmpty,
  hasAdvancedValue,
  type AppearanceFormData,
} from "@/components/appearance-editor";

/** 空表单（每个字段都要在这里出现，新增字段漏填即编译失败） */
const EMPTY: AppearanceFormData = {
  hairStyle: "",
  hairColor: "",
  faceShape: "",
  eyeColor: "",
  bodyType: "",
  height: "",
  skinTone: "",
  accessories: "",
  freeText: "",
  clothingPresets: [],
  defaultOutfit: "",
  outfitDetails: "",
  headToBodyRatio: "",
  hairParting: "",
  eyeHighlight: "",
  asymmetry: "",
};

describe("mergeAppearanceDraft（只填空字段）", () => {
  /**
   * 回归钉子：merged 此前是手写字段枚举，新增外貌字段时漏改这里会让
   * AI 起草的值被静默丢弃——表单看起来没填，用户完全无从察觉。
   * 现改为从字段键集派生，本测试锁死「每个文本字段都能被 AI 填入」。
   */
  it("所有文本字段都能被 AI 起草值填入（无字段被静默丢弃）", () => {
    const textFields = (
      Object.keys(EMPTY) as (keyof AppearanceFormData)[]
    ).filter((k) => k !== "clothingPresets");

    const draft = Object.fromEntries(
      textFields.map((k) => [k, `AI-${k}`])
    ) as Partial<AppearanceFormData>;

    const { merged, filledCount } = mergeAppearanceDraft(EMPTY, draft);

    for (const field of textFields) {
      expect(merged[field], `${field} 未被填入`).toBe(`AI-${field}`);
    }
    expect(filledCount).toBe(textFields.length);
  });

  it("用户已填的字段绝不被覆盖", () => {
    const current: AppearanceFormData = {
      ...EMPTY,
      defaultOutfit: "用户填的常服",
      headToBodyRatio: "8",
    };
    const { merged, filledCount } = mergeAppearanceDraft(current, {
      defaultOutfit: "AI 常服",
      headToBodyRatio: "7",
      asymmetry: "左耳银色耳环",
    });

    expect(merged.defaultOutfit).toBe("用户填的常服");
    expect(merged.headToBodyRatio).toBe("8");
    // 空字段照常填入
    expect(merged.asymmetry).toBe("左耳银色耳环");
    expect(filledCount).toBe(1);
  });

  it("起草结果为空串时不计入 filledCount，也不改动现值", () => {
    const { merged, filledCount } = mergeAppearanceDraft(EMPTY, {
      defaultOutfit: "   ",
      outfitDetails: "",
    });
    expect(merged.defaultOutfit).toBe("");
    expect(filledCount).toBe(0);
  });

  it("不可变：不修改传入的 current 对象", () => {
    const current = { ...EMPTY };
    mergeAppearanceDraft(current, { defaultOutfit: "灰色连帽衫" });
    expect(current.defaultOutfit).toBe("");
  });
});

describe("toAppearanceFormData（DB → 表单）", () => {
  it("新增的 6 个美术工业字段从 DB 读回表单", () => {
    const form = toAppearanceFormData({
      id: "a1",
      characterId: "c1",
      defaultOutfit: "白衬衫内搭藏青开衫",
      outfitDetails: "左胸银色校徽",
      headToBodyRatio: "7.5",
      hairParting: "左三七分",
      eyeHighlight: "右上圆点",
      asymmetry: "右眼下泪痣",
    });
    expect(form.defaultOutfit).toBe("白衬衫内搭藏青开衫");
    expect(form.outfitDetails).toBe("左胸银色校徽");
    expect(form.headToBodyRatio).toBe("7.5");
    expect(form.hairParting).toBe("左三七分");
    expect(form.eyeHighlight).toBe("右上圆点");
    expect(form.asymmetry).toBe("右眼下泪痣");
  });

  it("null 外貌回落全空表单", () => {
    expect(isAppearanceEmpty(toAppearanceFormData(null))).toBe(true);
  });

  it("只填了新字段时不算空表单（否则编辑卡片会默认折叠藏起已填内容）", () => {
    expect(isAppearanceEmpty({ ...EMPTY, defaultOutfit: "灰色连帽衫" })).toBe(
      false
    );
    expect(isAppearanceEmpty({ ...EMPTY, hairParting: "中分" })).toBe(false);
  });
});

describe("hasAdvancedValue（折叠区展开判定）", () => {
  it("折叠区有值即需展开——否则填过的内容被藏起来等同于没填", () => {
    expect(hasAdvancedValue(EMPTY)).toBe(false);
    expect(hasAdvancedValue({ ...EMPTY, headToBodyRatio: "7.5" })).toBe(true);
    expect(hasAdvancedValue({ ...EMPTY, hairParting: "中分" })).toBe(true);
    expect(hasAdvancedValue({ ...EMPTY, eyeHighlight: "双高光" })).toBe(true);
    expect(hasAdvancedValue({ ...EMPTY, asymmetry: "左耳耳环" })).toBe(true);
  });

  it("主区字段有值不触发折叠区展开", () => {
    expect(hasAdvancedValue({ ...EMPTY, defaultOutfit: "灰色连帽衫" })).toBe(
      false
    );
  });
});
