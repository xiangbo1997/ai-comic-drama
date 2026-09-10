/**
 * 系统配置校验单测（纯函数）
 *
 * validateSystemConfigValue 是「运营改价」这条链路上唯一的守门员：
 * 后台 PUT 与 DB 回读都走它。这里覆盖四种类型 × 边界，重点是
 * 「非法值必须被拒绝」而不是被静默转换成脏数据。
 */

import { describe, it, expect, vi } from "vitest";

// lib/system-config 顶层 import 了 lib/prisma，而后者在模块加载时就要求
// DATABASE_URL。本文件只测纯函数（validateSystemConfigValue 等，不碰 DB），
// 故把 prisma 桩成空对象，避免为纯函数测试引入数据库依赖。
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

import {
  SYSTEM_CONFIG_DEFS,
  isSystemConfigKey,
  listSystemConfigKeys,
  validateSystemConfigValue,
} from "@/lib/system-config";
import type { SystemConfigDef } from "@/lib/system-config";

describe("isSystemConfigKey — 键白名单", () => {
  it("注册表内的键返回 true", () => {
    expect(isSystemConfigKey("INITIAL_CREDITS")).toBe(true);
    expect(isSystemConfigKey("COST_IMAGE_WITH_REF")).toBe(true);
  });

  it("未注册的键返回 false", () => {
    expect(isSystemConfigKey("NOT_A_REAL_KEY")).toBe(false);
    expect(isSystemConfigKey("")).toBe(false);
  });

  it("不把 Object 原型上的属性名误判为合法键", () => {
    // hasOwnProperty 而非 in：否则 "toString"/"constructor" 会被放行
    expect(isSystemConfigKey("toString")).toBe(false);
    expect(isSystemConfigKey("constructor")).toBe(false);
  });
});

describe("validateSystemConfigValue — 未知键", () => {
  it("拒绝未注册的键", () => {
    const result = validateSystemConfigValue("NOT_A_REAL_KEY", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("未知配置项");
  });
});

describe("validateSystemConfigValue — int 类型", () => {
  const key = "INITIAL_CREDITS"; // int, min 0, max 100000

  it("接受整数", () => {
    expect(validateSystemConfigValue(key, 500)).toEqual({
      ok: true,
      value: 500,
    });
  });

  it("接受可无歧义解析的数字字符串（表单提交天然是字符串）", () => {
    expect(validateSystemConfigValue(key, "500")).toEqual({
      ok: true,
      value: 500,
    });
  });

  it("拒绝小数", () => {
    const result = validateSystemConfigValue(key, 1.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("整数");
  });

  it("拒绝空串", () => {
    expect(validateSystemConfigValue(key, "").ok).toBe(false);
  });

  it("拒绝非数字字符串", () => {
    expect(validateSystemConfigValue(key, "abc").ok).toBe(false);
  });

  it("拒绝 NaN / Infinity", () => {
    expect(validateSystemConfigValue(key, NaN).ok).toBe(false);
    expect(validateSystemConfigValue(key, Infinity).ok).toBe(false);
  });

  it("拒绝 null / undefined / 对象", () => {
    expect(validateSystemConfigValue(key, null).ok).toBe(false);
    expect(validateSystemConfigValue(key, undefined).ok).toBe(false);
    expect(validateSystemConfigValue(key, {}).ok).toBe(false);
  });
});

describe("validateSystemConfigValue — min / max 边界", () => {
  const key = "INITIAL_CREDITS"; // min 0, max 100000

  it("边界值本身合法（闭区间）", () => {
    expect(validateSystemConfigValue(key, 0)).toEqual({ ok: true, value: 0 });
    expect(validateSystemConfigValue(key, 100000)).toEqual({
      ok: true,
      value: 100000,
    });
  });

  it("低于 min 被拒绝", () => {
    const result = validateSystemConfigValue(key, -1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不能小于");
  });

  it("高于 max 被拒绝", () => {
    const result = validateSystemConfigValue(key, 100001);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不能大于");
  });

  it("负数单价被拒绝（防止「生成一次反而加积分」）", () => {
    expect(validateSystemConfigValue("COST_IMAGE_NORMAL", -5).ok).toBe(false);
  });
});

describe("validateSystemConfigValue — boolean / string / number 类型", () => {
  // 注册表已含 int 与 boolean 两类（boolean 来自 CLOSED_LOOP_* 闭环开关）。
  // 本用例是「新增类型必须补测」的绊线：类型集合变化时会失败，提醒补充对应分支用例。
  it("注册表类型集合为 int + boolean（新增其他类型时请补充对应用例）", () => {
    const types = new Set(
      listSystemConfigKeys().map((k) => SYSTEM_CONFIG_DEFS[k].type)
    );
    expect([...types].sort()).toEqual(["boolean", "int"]);
  });

  it("boolean 键接受真布尔值", () => {
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", true)).toEqual({
      ok: true,
      value: true,
    });
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", false)).toEqual({
      ok: true,
      value: false,
    });
  });

  // DB 里存的是字符串，回读时必须能还原成布尔
  it("boolean 键接受 'true' / 'false' 字符串（DB 回读形态）", () => {
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", "true")).toEqual(
      { ok: true, value: true }
    );
    expect(
      validateSystemConfigValue("CLOSED_LOOP_VIDEO_COHERENCE", "false")
    ).toEqual({ ok: true, value: false });
  });

  it("boolean 键拒绝非布尔值（不静默转换成脏数据）", () => {
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", 1).ok).toBe(
      false
    );
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", "yes").ok).toBe(
      false
    );
    expect(validateSystemConfigValue("CLOSED_LOOP_STORYBOARD", null).ok).toBe(
      false
    );
  });
});

describe("SYSTEM_CONFIG_DEFS — 注册表自身的完整性", () => {
  it("每一项的默认值都能通过自己的校验（否则「不配置即不可用」）", () => {
    for (const key of listSystemConfigKeys()) {
      const def = SYSTEM_CONFIG_DEFS[key];
      const result = validateSystemConfigValue(key, def.default);
      expect(result, `${key} 的默认值未通过校验`).toEqual({
        ok: true,
        value: def.default,
      });
    }
  });

  it("每一项都有非空 label 与 description（后台设置页直接展示）", () => {
    for (const key of listSystemConfigKeys()) {
      const def = SYSTEM_CONFIG_DEFS[key];
      expect(def.label.length, `${key} 缺 label`).toBeGreaterThan(0);
      expect(def.description.length, `${key} 缺 description`).toBeGreaterThan(
        0
      );
    }
  });

  it("min 不大于 max", () => {
    for (const key of listSystemConfigKeys()) {
      // 按声明的接口读：boolean 类型的配置项没有 min/max 字段，
      // 直接读联合类型的字面量会因缺字段而类型报错（运行时判断本就有 undefined 守卫）。
      const def: SystemConfigDef = SYSTEM_CONFIG_DEFS[key];
      if (def.min !== undefined && def.max !== undefined) {
        expect(def.min, `${key} 的 min > max`).toBeLessThanOrEqual(def.max);
      }
    }
  });
});
