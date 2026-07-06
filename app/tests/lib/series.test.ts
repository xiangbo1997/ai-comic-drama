import { describe, it, expect } from "vitest";
import {
  nextEpisodeNumber,
  buildEpisodeTitle,
  pickCarryOverGenerationParams,
} from "@/lib/series";
import type { GenerationParams } from "@/types/project";

describe("nextEpisodeNumber", () => {
  it("空系列从第 1 集开始", () => {
    expect(nextEpisodeNumber([])).toBe(1);
  });

  it("取最大集数 +1", () => {
    expect(nextEpisodeNumber([1, 2, 3])).toBe(4);
  });

  it("容忍空洞（删了中间某集不回填编号）", () => {
    expect(nextEpisodeNumber([1, 5])).toBe(6);
  });

  it("忽略 null/undefined 集数", () => {
    expect(nextEpisodeNumber([null, undefined, 2])).toBe(3);
    expect(nextEpisodeNumber([null, undefined])).toBe(1);
  });
});

describe("buildEpisodeTitle", () => {
  it("拼接「系列名 第N集」", () => {
    expect(buildEpisodeTitle("苍潮界", 7)).toBe("苍潮界 第7集");
  });
});

describe("pickCarryOverGenerationParams", () => {
  it("空/非法输入返回空对象", () => {
    expect(pickCarryOverGenerationParams(null)).toEqual({});
    expect(pickCarryOverGenerationParams(undefined)).toEqual({});
  });

  it("继承全片级参数，丢弃分镜键控参数", () => {
    const params: GenerationParams = {
      temperature: 0.8,
      topP: 0.9,
      styleStrength: 0.5,
      negativePreset: "anime",
      customNegative: "blurry",
      subtitleStyle: {
        fontSize: 24,
        fontColor: "#FFFFFF",
        outlineColor: "#000000",
        outlineWidth: 2,
        position: "bottom",
        bold: false,
        backgroundBox: false,
      },
      watermark: {
        enabled: true,
        imageUrl: "/uploads/logo.png",
        position: "br",
        opacity: 0.8,
        scale: 0.12,
      },
      backgroundMusic: {
        enabled: true,
        url: "/bgm/theme.mp3",
        volume: 0.25,
        fadeIn: 1.5,
        fadeOut: 2,
        loop: true,
        ducking: false,
      },
      // 以下均为分镜键控/数量相关，不应带入新集
      subtitlePositions: [{ sceneId: "old-scene-1", x: 0.5, y: 0.9 }],
      stickers: [
        {
          id: "st1",
          imageUrl: "/uploads/st.png",
          sceneId: "old-scene-1",
          x: 0.5,
          y: 0.5,
          scale: 0.2,
        },
      ],
      transitions: [{ type: "fade", duration: 0.3 }],
      sceneEffects: [{ sceneId: "old-scene-1", effect: "warm", speed: 1 }],
    };

    const picked = pickCarryOverGenerationParams(params);

    expect(picked.temperature).toBe(0.8);
    expect(picked.topP).toBe(0.9);
    expect(picked.styleStrength).toBe(0.5);
    expect(picked.negativePreset).toBe("anime");
    expect(picked.customNegative).toBe("blurry");
    expect(picked.subtitleStyle).toEqual(params.subtitleStyle);
    expect(picked.watermark).toEqual(params.watermark);
    expect(picked.backgroundMusic).toEqual(params.backgroundMusic);

    expect(picked).not.toHaveProperty("subtitlePositions");
    expect(picked).not.toHaveProperty("stickers");
    expect(picked).not.toHaveProperty("transitions");
    expect(picked).not.toHaveProperty("sceneEffects");
  });

  it("返回的是拷贝而非引用（不共享嵌套对象）", () => {
    const params: GenerationParams = {
      watermark: {
        enabled: true,
        imageUrl: "/uploads/logo.png",
        position: "br",
        opacity: 0.8,
        scale: 0.12,
      },
    };
    const picked = pickCarryOverGenerationParams(params);
    expect(picked.watermark).not.toBe(params.watermark);
    expect(picked.watermark).toEqual(params.watermark);
  });
});
