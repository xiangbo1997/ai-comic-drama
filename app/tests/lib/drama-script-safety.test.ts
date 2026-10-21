import { describe, expect, it } from "vitest";
import {
  checkDramaScriptWorldviewSafety,
  checkImagePromptSafety,
  checkTextSafety,
  contentSafetyMiddleware,
} from "@/lib/content-safety";

describe("checkDramaScriptWorldviewSafety", () => {
  it("允许剧情设定提及自杀，同时保持通用审核规则不变", () => {
    const worldview = "主角调查一桩被伪装成自杀的旧案。";
    expect(checkTextSafety(worldview).safe).toBe(false);
    expect(checkDramaScriptWorldviewSafety(worldview).safe).toBe(true);
  });

  it.each(["如何自杀", "自杀方法", "自杀步骤", "自杀教程"])(
    "拒绝索取自伤做法：%s",
    (worldview) => {
      expect(checkDramaScriptWorldviewSafety(worldview).safe).toBe(false);
    }
  );

  it("继续拦截其他违规词", () => {
    expect(checkDramaScriptWorldviewSafety("赌博诈骗的剧情")).toMatchObject({
      safe: false,
      blockedKeywords: ["赌博", "诈骗"],
    });
  });
});

describe("image prompt safety", () => {
  const scenePrompt =
    "地铁车厢里，手机弹出标注七天后的热搜预览：#林知夏狱中自杀#。";

  it("允许图片提示词中的剧情事件描述", async () => {
    expect(checkImagePromptSafety(scenePrompt).safe).toBe(true);
    expect(await contentSafetyMiddleware(scenePrompt, "image")).toMatchObject({
      safe: true,
    });
    expect(checkTextSafety(scenePrompt).safe).toBe(false);
  });

  it.each(["如何自杀", "怎么自杀", "自杀方法", "自杀步骤"])(
    "继续拒绝自伤做法：%s",
    async (prompt) => {
      expect(checkImagePromptSafety(prompt).safe).toBe(false);
      expect(await contentSafetyMiddleware(prompt, "image")).toMatchObject({
        safe: false,
      });
    }
  );

  it("继续拒绝其他违规关键词", async () => {
    expect(await contentSafetyMiddleware("血腥画面", "image")).toMatchObject({
      safe: false,
      blockedKeywords: ["血腥"],
    });
  });
});
