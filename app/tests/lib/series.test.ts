import { describe, it, expect } from "vitest";
import {
  nextEpisodeNumber,
  buildEpisodeTitle,
  pickCarryOverGenerationParams,
  buildPreviousEpisodeRecap,
} from "@/lib/series";
import { buildDramaScriptUserPrompt } from "@/lib/prompts/agent-prompts";
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

describe("buildPreviousEpisodeRecap", () => {
  it("完整上下文：片名 + 梗概 + 结尾场景（含对白/旁白）", () => {
    const recap = buildPreviousEpisodeRecap({
      episodeNumber: 1,
      title: "苍潮界·启程",
      logline: "少年发现失落航路的第一块碎片",
      endingScenes: [
        {
          description: "船首破浪，远方风暴中隐约浮现遗迹轮廓",
          dialogue: "那就是……古代航路的入口？",
          narration: "命运的罗盘，从这一刻开始转动",
        },
      ],
    });
    expect(recap).toContain("第1集《苍潮界·启程》");
    expect(recap).toContain("梗概：少年发现失落航路的第一块碎片");
    expect(recap).toContain("结尾场景：");
    expect(recap).toContain("对白「那就是……古代航路的入口？」");
    expect(recap).toContain("旁白「命运的罗盘，从这一刻开始转动」");
  });

  it("只取最后两个结尾场景，且描述截断到 300 字", () => {
    const longDesc = "很".repeat(500);
    const recap = buildPreviousEpisodeRecap({
      episodeNumber: 2,
      title: "t",
      logline: null,
      endingScenes: [
        { description: "场景A" },
        { description: "场景B" },
        { description: longDesc },
      ],
    });
    expect(recap).not.toContain("场景A");
    expect(recap).toContain("场景B");
    expect(recap).not.toContain("很".repeat(301));
  });

  it("无实质剧情信息（只有标题）返回 null", () => {
    expect(
      buildPreviousEpisodeRecap({
        episodeNumber: 1,
        title: "只有标题",
        logline: null,
        endingScenes: [],
      })
    ).toBeNull();
    expect(
      buildPreviousEpisodeRecap({
        episodeNumber: null,
        title: null,
        logline: null,
        endingScenes: [{ description: "   " }],
      })
    ).toBeNull();
  });
});

describe("buildDramaScriptUserPrompt 系列记忆注入", () => {
  const baseInput = { worldview: "苍潮界，群岛与古代遗迹的世界" };

  it("有系列记忆：注入记忆块 + 续集承接要求", () => {
    const prompt = buildDramaScriptUserPrompt({
      ...baseInput,
      previousEpisodeRecap: "第1集《启程》\n梗概：发现碎片",
    });
    expect(prompt).toContain("系列记忆");
    expect(prompt).toContain("第1集《启程》");
    expect(prompt).toContain("本集是系列续集");
    expect(prompt).toContain("引向下一集的悬念钩子");
  });

  it("无系列记忆（第一集/独立项目）：不出现续集相关内容", () => {
    const prompt = buildDramaScriptUserPrompt(baseInput);
    expect(prompt).not.toContain("系列记忆");
    expect(prompt).not.toContain("本集是系列续集");
  });
});
