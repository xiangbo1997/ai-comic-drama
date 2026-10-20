import { describe, expect, it } from "vitest";
import {
  checkDramaScriptWorldviewSafety,
  checkTextSafety,
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
