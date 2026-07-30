/**
 * normalizeGenerationParams 白名单完备性（round-trip）单测。
 *
 * 这个函数是【白名单重建】：只有显式挂了分支的字段才会进 DB。历史上 subtitleStyle /
 * BGM / SFX / 花字都踩过「前端存了但这里没挂分支 → 静默丢弃」的坑（各分支注释有留痕）。
 *
 * 本测试的作用是当护栏：FULL_FIXTURE 覆盖 GenerationParams 的【全部字段】，断言过一遍
 * normalize 后输出键集合不缩小。将来给 GenerationParams 加字段却忘了挂白名单分支，
 * 这里就会红——而不是等到用户发现"配了没生效"。
 *
 * 新增字段时要做三件事：① 在 normalizeGenerationParams 里挂校验分支；
 * ② 在 GENERATION_PARAM_KEY_MAP 登记；③ 在下面 FULL_FIXTURE 补一个合法值。
 */

import { describe, it, expect } from "vitest";
import {
  normalizeGenerationParams,
  GENERATION_PARAM_KEY_MAP,
} from "@/lib/generation-params-normalize";
import type { GenerationParams } from "@/types/project";

/**
 * 含 GenerationParams 全部字段的合法 fixture。
 * 每个值都必须能通过对应分支的校验（否则该字段不会出现在输出里，测试会红）。
 */
const FULL_FIXTURE: Required<GenerationParams> = {
  temperature: 0.8,
  topP: 0.9,
  styleStrength: 0.6,
  negativePreset: "anime",
  customNegative: "blurry, extra fingers",
  subtitleStyle: {
    fontSize: 24,
    fontColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 2,
    position: "bottom",
    bold: false,
    backgroundBox: false,
    animation: "fade",
  },
  subtitlePositions: [{ sceneId: "scene-1", x: 0.5, y: 0.88 }],
  watermark: {
    enabled: true,
    imageUrl: "https://example.com/logo.png",
    position: "br",
    opacity: 0.8,
    scale: 0.12,
  },
  stickers: [
    {
      id: "sticker-1",
      imageUrl: "https://example.com/s.png",
      sceneId: "scene-1",
      x: 0.5,
      y: 0.5,
      scale: 0.2,
    },
  ],
  transitions: [{ type: "fade", duration: 0.3 }],
  sceneEffects: [{ sceneId: "scene-1", effect: "vivid", speed: 1 }],
  backgroundMusic: {
    enabled: true,
    trackId: "calm-1",
    url: "/bgm/calm-1.mp3",
    volume: 0.25,
    fadeIn: 1.5,
    fadeOut: 2,
    loop: true,
    ducking: false,
  },
  // sfxId 必须命中内置音效库（getSfxById），否则该条被过滤掉
  sfx: [{ sceneId: "scene-1", sfxId: "glass-shatter", offsetSec: 1 }],
  emphasis: ["scene-1"],
  colorGrade: { enabled: true, lutId: "vivid-anime" },
  titleCards: { title: true, end: true },
  producerReview: {
    createdByProducer: true,
    confirmed: {
      worldview: true,
      script: true,
      characters: ["char-1"],
      scenes: ["scene-1"],
    },
  },
  renderStrategy: "hybrid",
};

describe("normalizeGenerationParams · round-trip 白名单完备性", () => {
  it("FULL_FIXTURE 的每个字段都能过白名单（无静默丢弃）", () => {
    const out = normalizeGenerationParams(FULL_FIXTURE);
    expect(out).toBeDefined();

    const missing = Object.keys(FULL_FIXTURE).filter((k) => !(k in out!));
    // 断言里带上缺失键名，红的时候直接告诉你哪个字段漏挂了白名单
    expect(
      missing,
      `以下字段被 normalize 丢弃（白名单漏挂）: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("FULL_FIXTURE 覆盖 GenerationParams 全部字段（fixture 自身不许落后于类型）", () => {
    const declared = Object.keys(GENERATION_PARAM_KEY_MAP).sort();
    const fixtureKeys = Object.keys(FULL_FIXTURE).sort();
    expect(fixtureKeys).toEqual(declared);
  });

  it("GENERATION_PARAM_KEY_MAP 与实际放行的键一致（无登记了却没挂分支的字段）", () => {
    const out = normalizeGenerationParams(FULL_FIXTURE)!;
    expect(Object.keys(out).sort()).toEqual(
      Object.keys(GENERATION_PARAM_KEY_MAP).sort()
    );
  });
});

describe("normalizeGenerationParams · 白名单外字段仍被拒", () => {
  it("未知字段不进输出（防呆告警只记日志，绝不放行）", () => {
    const out = normalizeGenerationParams({
      temperature: 0.5,
      evilPayload: { nested: "x" },
      __proto__hack: "y",
    });
    expect(out).toEqual({ temperature: 0.5 });
  });

  it("非对象入参返回 undefined（PATCH 据此跳过写库）", () => {
    expect(normalizeGenerationParams(null)).toBeUndefined();
    expect(normalizeGenerationParams("nope")).toBeUndefined();
    expect(normalizeGenerationParams(42)).toBeUndefined();
  });

  it("空对象 → 空输出（合法的「清空所有配置」语义）", () => {
    expect(normalizeGenerationParams({})).toEqual({});
  });
});

describe("normalizeGenerationParams · 逐镜数组上限对齐（C4）", () => {
  it("sceneEffects 与 subtitlePositions 上限一致，均为 500", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ sceneId: `s${i}` }));
    const out = normalizeGenerationParams({
      sceneEffects: many(600).map((e) => ({ ...e, effect: "bw", speed: 1 })),
      subtitlePositions: many(600).map((p) => ({ ...p, x: 0.5, y: 0.8 })),
    })!;
    expect((out.sceneEffects as unknown[]).length).toBe(500);
    expect((out.subtitlePositions as unknown[]).length).toBe(500);
  });

  it("500 项以内的 sceneEffects 不被截断（修复前 200 以后静默丢尾）", () => {
    const effects = Array.from({ length: 420 }, (_, i) => ({
      sceneId: `s${i}`,
      effect: "vivid",
      speed: 1,
    }));
    const out = normalizeGenerationParams({ sceneEffects: effects })!;
    expect((out.sceneEffects as unknown[]).length).toBe(420);
  });
});

describe("normalizeGenerationParams · 范围钳制仍生效（抽出为 lib 后语义不变）", () => {
  it("temperature 越界被 clamp 到 0-1.5", () => {
    expect(normalizeGenerationParams({ temperature: 99 })).toEqual({
      temperature: 1.5,
    });
    expect(normalizeGenerationParams({ temperature: -5 })).toEqual({
      temperature: 0,
    });
  });

  it("非法 sfxId 的条目被丢弃（未命中音效库）", () => {
    const out = normalizeGenerationParams({
      sfx: [
        { sceneId: "s1", sfxId: "not-a-real-sfx", offsetSec: 0 },
        { sceneId: "s1", sfxId: "glass-shatter", offsetSec: 0 },
      ],
    })!;
    expect(out.sfx).toHaveLength(1);
  });

  it("非法 lutId 回退默认预设而非放行任意字符串", () => {
    const out = normalizeGenerationParams({
      colorGrade: { enabled: true, lutId: "../../etc/passwd" },
    })!;
    const cg = out.colorGrade as { enabled: boolean; lutId: string };
    expect(cg.lutId).not.toBe("../../etc/passwd");
    expect(cg.enabled).toBe(true);
  });
});
