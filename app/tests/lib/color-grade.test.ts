import { describe, it, expect } from "vitest";
import {
  resolveLutPreset,
  suggestLutFromTone,
  LUT_PRESETS,
  DEFAULT_COLOR_GRADE,
} from "@/lib/color-grade";

describe("resolveLutPreset · 白名单", () => {
  it("命中白名单 id 返回预设（含 .cube 路径）", () => {
    const preset = resolveLutPreset("vivid-anime");
    expect(preset).not.toBeNull();
    expect(preset!.id).toBe("vivid-anime");
    expect(preset!.cubeFile).toBe("public/luts/vivid-anime.cube");
  });

  it("三个内置预设全部可解析", () => {
    for (const p of LUT_PRESETS) {
      expect(resolveLutPreset(p.id)).toEqual(p);
    }
  });

  it("白名单外的 id 拒斥（返回 null，防任意路径注入 ffmpeg）", () => {
    expect(resolveLutPreset("../../etc/passwd")).toBeNull();
    expect(resolveLutPreset("unknown-lut")).toBeNull();
    expect(resolveLutPreset("")).toBeNull();
  });

  it("缺省 / null / undefined → null", () => {
    expect(resolveLutPreset(null)).toBeNull();
    expect(resolveLutPreset(undefined)).toBeNull();
  });
});

describe("DEFAULT_COLOR_GRADE", () => {
  it("默认关闭（避免预览与导出近似色差误触发）", () => {
    expect(DEFAULT_COLOR_GRADE.enabled).toBe(false);
  });

  it("默认预设 id 在白名单内", () => {
    expect(resolveLutPreset(DEFAULT_COLOR_GRADE.lutId)).not.toBeNull();
  });
});

describe("suggestLutFromTone · 圣经色调启发式", () => {
  it("暖调关键词 → 暖黄怀旧", () => {
    expect(suggestLutFromTone("warm amber sunset")).toBe("warm-nostalgic");
    expect(suggestLutFromTone("golden nostalgic memories")).toBe(
      "warm-nostalgic"
    );
  });

  it("冷调关键词 → 冷峻蓝", () => {
    expect(suggestLutFromTone("cold steel blue noir")).toBe("cold-steel");
    expect(suggestLutFromTone("desaturated muted teal")).toBe("cold-steel");
  });

  it("高饱和关键词 → 高饱和漫感", () => {
    expect(suggestLutFromTone("vivid vibrant anime pop")).toBe("vivid-anime");
  });

  it("无法判断 / 空 → null（UI 不强推）", () => {
    expect(suggestLutFromTone("")).toBeNull();
    expect(suggestLutFromTone(null)).toBeNull();
    expect(suggestLutFromTone(undefined)).toBeNull();
    expect(suggestLutFromTone("something neutral")).toBeNull();
  });
});
