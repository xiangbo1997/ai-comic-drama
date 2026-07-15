import { describe, it, expect } from "vitest";
import { dramaScriptToScenes, scriptToInputText } from "@/lib/drama-to-scenes";
import type { DramaScriptArtifact, StoryboardTableArtifact } from "@/types";

function makeDoc(
  overrides: Partial<DramaScriptArtifact> = {}
): DramaScriptArtifact {
  return {
    filmTitle: "被删除的人",
    genre: "赛博悬疑",
    durationSec: 90,
    aspectRatio: "9:16",
    style: "cyberpunk",
    protagonist: "系统维护工程师",
    worldview: "AI 治理的城市",
    logline: "被系统抹除的工程师觉醒改写底层代码的能力",
    scenes: [
      {
        index: 1,
        title: "天幕之下",
        description: "雨夜天幕城的霓虹，大全景俯瞰",
        dialogue: null,
        narration: "这座城市由 AI 管理一切",
        emotion: "压抑",
        durationSec: 9,
      },
      {
        index: 2,
        title: "删除程序启动",
        description: "林烬盯着屏幕上自己的档案被逐行抹除",
        dialogue: "林烬：不……这不可能！",
        narration: null,
        emotion: "恐惧",
        durationSec: 11,
      },
    ],
    ...overrides,
  };
}

const storyboard: StoryboardTableArtifact = {
  cells: [
    {
      index: 1,
      sceneTitle: "天幕之下",
      shot: "大全景·高速俯冲",
      dialogue: null,
      closeup: "雨滴撞碎在霓虹灯牌上",
      transition: "淡入",
    },
    {
      index: 2,
      sceneTitle: "删除程序启动",
      shot: "中景→特写·快速推近",
      dialogue: "格内兜底对白",
      closeup: "瞳孔里倒映的红色警告",
      transition: "故障闪白",
    },
  ],
};

describe("dramaScriptToScenes", () => {
  it("无九宫格：逐场景映射基础字段", () => {
    const scenes = dramaScriptToScenes(makeDoc(), null);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      shotType: null,
      description: "雨夜天幕城的霓虹，大全景俯瞰",
      dialogue: null,
      narration: "这座城市由 AI 管理一切",
      emotion: "压抑",
      // 时长改为对白/旁白驱动（断裂 C 修复）：旁白 9 汉字 + "AI" 1 词 ≈ 4s 朗读，
      // LLM 给的 9s 超出「空镜软上限」故不采信，校准为 4s。
      duration: 4,
    });
    expect(scenes[1].dialogue).toBe("林烬：不……这不可能！");
  });

  it("有九宫格：shot 进 shotType、特写并入描述、按 index 对位", () => {
    const scenes = dramaScriptToScenes(makeDoc(), storyboard);
    expect(scenes[0].shotType).toBe("大全景·高速俯冲");
    expect(scenes[0].description).toBe(
      "雨夜天幕城的霓虹，大全景俯瞰\n特写要点：雨滴撞碎在霓虹灯牌上"
    );
    expect(scenes[1].shotType).toBe("中景→特写·快速推近");
  });

  it("脚本对白优先，缺失时用九宫格格内对白兜底", () => {
    // 场景2 脚本有对白 → 保留脚本对白
    const scenes = dramaScriptToScenes(makeDoc(), storyboard);
    expect(scenes[1].dialogue).toBe("林烬：不……这不可能！");

    // 抹掉脚本对白 → 兜底格内对白
    const doc = makeDoc();
    doc.scenes[1].dialogue = null;
    const fallback = dramaScriptToScenes(doc, storyboard);
    expect(fallback[1].dialogue).toBe("格内兜底对白");
  });

  it("角色名出现在场景文本中时写入 characters", () => {
    const scenes = dramaScriptToScenes(makeDoc(), null, ["林烬", "苏离"]);
    expect(scenes[0].characters).toEqual([]);
    expect(scenes[1].characters).toEqual(["林烬"]);
  });

  it("时长校准：LLM 异常值被对白/旁白驱动的确定时长取代", () => {
    // 断裂 C 修复：durationSec 异常值不再简单 clamp，而是回落到对白/旁白朗读时长。
    const doc = makeDoc();
    doc.scenes[0].durationSec = 0; // 旁白 9 汉字 + AI ≈ 4s → 校准为 4
    doc.scenes[1].durationSec = 999; // 对白「林烬不这不可能」7 汉字 ≈ 2.8s，超软上限故回落 3
    const scenes = dramaScriptToScenes(doc, null);
    expect(scenes[0].duration).toBe(4);
    expect(scenes[1].duration).toBe(3);
  });

  it("九宫格 index 与场景错位时不串格", () => {
    const partial: StoryboardTableArtifact = {
      cells: [storyboard.cells[1]], // 只有 index=2 的格
    };
    const scenes = dramaScriptToScenes(makeDoc(), partial);
    expect(scenes[0].shotType).toBeNull();
    expect(scenes[1].shotType).toBe("中景→特写·快速推近");
  });

  it("空场景数组安全返回空", () => {
    expect(dramaScriptToScenes(makeDoc({ scenes: [] }), storyboard)).toEqual(
      []
    );
  });

  it("C4：镜头语言字段携带时透传到分镜草稿", () => {
    const doc = makeDoc();
    doc.scenes[0].cameraAngle = "低角度仰拍";
    doc.scenes[0].lighting = "冷调夜景";
    doc.scenes[0].composition = "三分法";
    doc.scenes[0].colorPalette = "冷蓝调";
    doc.scenes[0].actionBeat = "雨滴砸落，霓虹明灭";
    doc.scenes[0].cameraMovement = "dolly_in";
    const scenes = dramaScriptToScenes(doc, null);
    expect(scenes[0]).toMatchObject({
      cameraAngle: "低角度仰拍",
      lighting: "冷调夜景",
      composition: "三分法",
      colorPalette: "冷蓝调",
      actionBeat: "雨滴砸落，霓虹明灭",
      cameraMovement: "dolly_in",
    });
  });

  it("C4：镜头语言字段缺省时不出现在分镜草稿（向后兼容）", () => {
    // 未携带镜头语言的老脚本：这些键根本不该出现，保持产出对象干净
    const scenes = dramaScriptToScenes(makeDoc(), null);
    expect(scenes[0]).not.toHaveProperty("cameraAngle");
    expect(scenes[0]).not.toHaveProperty("lighting");
    expect(scenes[0]).not.toHaveProperty("cameraMovement");
    expect(scenes[0]).not.toHaveProperty("actionBeat");
  });
});

describe("scriptToInputText", () => {
  it("拼装标题 + logline + 逐场景（对白/旁白按有无输出）", () => {
    const text = scriptToInputText(makeDoc());
    expect(text).toContain("《被删除的人》");
    expect(text).toContain("场景1 天幕之下");
    expect(text).toContain("旁白：这座城市由 AI 管理一切");
    expect(text).toContain("对白：林烬：不……这不可能！");
    // 场景1 无对白 → 不输出空行
    expect(text).not.toContain(
      "场景1 天幕之下\n雨夜天幕城的霓虹，大全景俯瞰\n对白"
    );
  });
});
