import { describe, it, expect } from "vitest";
import { resolveDialogueDelivery } from "@/lib/dialogue-delivery";
import { buildVideoScenePrompt } from "@/lib/prompts/video-prompt";
import { buildDirectorPrompt } from "@/services/generation/video-director";
import {
  getVideoDirectionCache,
  setVideoDirectionCache,
} from "@/lib/cache/video-direction-cache";

describe("对白来源进入真实视频提示词", () => {
  it("当面对白变更为OS后，导演缓存不能重用张嘴动作", async () => {
    const input = {
      scene: { description: "缓存声源测试", duration: 5, dialogue: "别开门" },
      characters: [],
    };
    await setVideoDirectionCache(input, '{"actionBeat":"张嘴说话"}');
    expect(await getVideoDirectionCache(input)).toContain("张嘴");
    expect(
      await getVideoDirectionCache({
        ...input,
        scene: { ...input.scene, dialogue: "OS: 别开门" },
      })
    ).toBeNull();
  });
  it("混合声源中有当面对白时保留口型，未知括号不猜", () => {
    expect(resolveDialogueDelivery("阿宁（OS）：别开门\n阿明：谁？")).toBe(
      "onscreen"
    );
    expect(resolveDialogueDelivery("阿宁（惊讶）：什么？")).toBe("onscreen");
  });
  it.each([
    "（内心独白）别开门",
    "阿宁（OS）：别开门",
    "OS: 别开门",
    "【心声】别开门",
  ])("显式内心标记：%s", (dialogue) =>
    expect(resolveDialogueDelivery(dialogue)).toBe("inner")
  );
  it.each([
    "阿宁（画外音）：别开门",
    "VO: 别开门",
    "[V.O.] 别开门",
    "【旁白】别开门",
  ])("显式画外标记：%s", (dialogue) =>
    expect(resolveDialogueDelivery(dialogue)).toBe("offscreen")
  );
  it.each([
    "我心想这不可能",
    "我听见画外音了",
    "OS系统坏了",
    "她说：我没有说画外音",
  ])("正文关键词不能被猜成画外：%s", (dialogue) =>
    expect(resolveDialogueDelivery(dialogue)).toBe("onscreen")
  );
  it("空对白无口型，当面对白与兼容boolean行为保持", () => {
    expect(resolveDialogueDelivery(null)).toBe("none");
    expect(
      buildVideoScenePrompt({
        description: "看向门外",
        shotType: "近景",
        dialogue: "你好",
      })
    ).toContain("lip flap");
    expect(
      buildVideoScenePrompt({
        description: "看向门外",
        shotType: "近景",
        hasDialogue: true,
      })
    ).toContain("lip flap");
  });
  it.each(["（内心独白）别开门", "阿宁（画外音）：别开门"])(
    "显式画外压过旧hasDialogue：%s",
    (dialogue) => {
      const prompt = buildVideoScenePrompt({
        description: "看向门外",
        shotType: "近景",
        dialogue,
        hasDialogue: true,
      });
      expect(prompt).toContain("no lip-sync");
      expect(prompt).not.toContain("lip flap");
      const director = buildDirectorPrompt({
        scene: { description: "看向门外", duration: 5, dialogue },
        characters: [],
      });
      expect(director).toContain("禁止让画面中角色张嘴说话");
    }
  );
});
