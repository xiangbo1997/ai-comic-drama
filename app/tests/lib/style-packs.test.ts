import { describe, expect, it } from "vitest";

import {
  FULL_STYLE_PACK_OPTIONS,
  LEGACY_STYLE_PACK_OPTIONS,
  STYLE_PACKS,
  STYLE_PACK_OPTIONS,
  getStylePack,
  getStylePaletteBaseline,
} from "@/lib/prompts/style-packs";

/**
 * 画风包分组契约守卫。
 *
 * 背景：legacy 画风包只有 anchor + negative 两层，色彩系统 / 情绪色盘 /
 * 角色规则 / 场景规则均为空串，且 getStylePaletteBaseline 返回空串会让
 * Observer 色调门禁一并失效。UI 必须把这两档分开展示，否则用户选到
 * legacy 档时无从知晓能力差异（曾经三处下拉都平铺展示，无任何标识）。
 */
describe("画风包分组", () => {
  it("legacy 标记与注册表一致，两个子集互补且无重叠", () => {
    const full = new Set(FULL_STYLE_PACK_OPTIONS.map((o) => o.value));
    const legacy = new Set(LEGACY_STYLE_PACK_OPTIONS.map((o) => o.value));

    expect(full.size + legacy.size).toBe(STYLE_PACK_OPTIONS.length);
    for (const id of full) expect(legacy.has(id)).toBe(false);

    for (const pack of STYLE_PACKS) {
      const inLegacy = legacy.has(pack.id);
      expect(inLegacy).toBe(pack.legacy === true);
    }
  });

  it("完整画风包的各层字段非空——新增包漏填即失败", () => {
    for (const option of FULL_STYLE_PACK_OPTIONS) {
      const pack = getStylePack(option.value);
      expect(pack.anchor.trim(), `${pack.id} anchor`).not.toBe("");
      expect(pack.colorSystem.trim(), `${pack.id} colorSystem`).not.toBe("");
      expect(pack.colorSystemEn.trim(), `${pack.id} colorSystemEn`).not.toBe(
        ""
      );
      expect(pack.moodPalettes.trim(), `${pack.id} moodPalettes`).not.toBe("");
      expect(pack.characterRules.trim(), `${pack.id} characterRules`).not.toBe(
        ""
      );
      expect(
        pack.characterRulesEn.trim(),
        `${pack.id} characterRulesEn`
      ).not.toBe("");
      expect(pack.sceneRules.trim(), `${pack.id} sceneRules`).not.toBe("");
      expect(pack.sceneRulesEn.trim(), `${pack.id} sceneRulesEn`).not.toBe("");
    }
  });

  /**
   * 头身比是**角色级属性**：同一部片里儿童 5 头身、男主 7.5 头身、巨汉 8 头身
   * 三个数字全部合法。画风包只能给区间默认值，若英文规则写成祈使句
   * （"6.5-7 head-to-body ratio"），指令遵循型模型会把它当硬约束，
   * 反过来覆盖角色设定里的具体数字——角色设定表白填。
   */
  it("英文角色规则必须声明「角色设定优先」，避免画风包头身比压过角色设定", () => {
    for (const option of FULL_STYLE_PACK_OPTIONS) {
      const pack = getStylePack(option.value);
      expect(
        pack.characterRulesEn,
        `${pack.id} characterRulesEn 缺少 per-character spec overrides 声明`
      ).toContain("per-character spec overrides");
    }
  });

  it("legacy 包确实缺色彩基线——这正是要与完整包区分展示的原因", () => {
    expect(LEGACY_STYLE_PACK_OPTIONS.length).toBeGreaterThan(0);
    for (const option of LEGACY_STYLE_PACK_OPTIONS) {
      // anchor 仍生效（选了 legacy 至少还有一行风格词）
      expect(getStylePack(option.value).anchor.trim()).not.toBe("");
      // 但色调门禁拿不到基线
      expect(getStylePaletteBaseline(option.value)).toBe("");
      // 角色规则同样缺失，出图路径按空串跳过注入
      expect(getStylePack(option.value).characterRulesEn).toBe("");
    }
  });

  it("完整画风包能产出色彩基线", () => {
    for (const option of FULL_STYLE_PACK_OPTIONS) {
      expect(getStylePaletteBaseline(option.value).trim()).not.toBe("");
    }
  });
});
