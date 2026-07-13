import { describe, it, expect } from "vitest";
import {
  buildDirectorPrompt,
  parseDirectorResponse,
  type VideoDirectorInput,
} from "@/services/generation/video-director";

/** 构造最小合法输入 */
function baseInput(
  overrides: Partial<VideoDirectorInput> = {}
): VideoDirectorInput {
  return {
    scene: {
      description: "林萧站在窗边望向远方",
      duration: 5,
    },
    characters: [],
    ...overrides,
  };
}

describe("buildDirectorPrompt — 上下文注入", () => {
  it("按名字列出角色（身份供理解，禁止复述）", () => {
    const out = buildDirectorPrompt(
      baseInput({
        characters: [
          { name: "林萧", identity: "24岁黑长直女性，纤细身材" },
          { name: "陈默", identity: "30岁短发男性，西装" },
        ],
      })
    );
    expect(out).toContain("林萧");
    expect(out).toContain("陈默");
    expect(out).toContain("24岁黑长直女性，纤细身材");
    // 明确写入「禁止复述外貌」的约束提示
    expect(out).toContain("禁止复述");
  });

  it("有 prevScene / nextScene → 承接与铺垫都进 prompt", () => {
    const out = buildDirectorPrompt(
      baseInput({
        prevScene: {
          description: "林萧收到辞职信被拒",
          actionBeat: "攥紧信纸，肩膀颤抖",
        },
        nextScene: { description: "林萧转身冲出办公室" },
      })
    );
    expect(out).toContain("上一镜");
    expect(out).toContain("林萧收到辞职信被拒");
    expect(out).toContain("攥紧信纸，肩膀颤抖");
    expect(out).toContain("下一镜");
    expect(out).toContain("林萧转身冲出办公室");
  });

  it("无 prevScene / nextScene → 不出现相邻镜区块", () => {
    const out = buildDirectorPrompt(baseInput());
    expect(out).not.toContain("上一镜");
    expect(out).not.toContain("下一镜");
  });

  it("有 seriesRecap → 前情提要进 prompt（跨集记忆）", () => {
    const out = buildDirectorPrompt(
      baseInput({ seriesRecap: "第1集《觉醒》：林萧发现自己拥有异能" })
    );
    expect(out).toContain("前情提要");
    expect(out).toContain("第1集《觉醒》：林萧发现自己拥有异能");
  });

  it("无 seriesRecap → 不出现前情提要区块", () => {
    const out = buildDirectorPrompt(baseInput());
    expect(out).not.toContain("前情提要");
  });

  it("本镜的 description / shotType / emotion 进 prompt", () => {
    const out = buildDirectorPrompt(
      baseInput({
        scene: {
          description: "林萧站在窗边望向远方",
          shotType: "近景",
          emotion: "sad",
          duration: 8,
        },
      })
    );
    expect(out).toContain("林萧站在窗边望向远方");
    expect(out).toContain("近景");
    expect(out).toContain("sad");
  });
});

describe("parseDirectorResponse — 合法 JSON", () => {
  it("裸 JSON 全字段", () => {
    const out = parseDirectorResponse(
      '{"cameraMovement": "dolly_in", "actionBeat": "缓步向前，抬手推门", "atmosphere": "quiet tension"}'
    );
    expect(out.cameraMovement).toBe("dolly_in");
    expect(out.actionBeat).toBe("缓步向前，抬手推门");
    expect(out.atmosphere).toBe("quiet tension");
  });

  it("markdown 代码围栏内的 JSON 也能提取", () => {
    const raw =
      '```json\n{"cameraMovement": "pan_left", "actionBeat": "目光横扫全场"}\n```';
    const out = parseDirectorResponse(raw);
    expect(out.cameraMovement).toBe("pan_left");
    expect(out.actionBeat).toBe("目光横扫全场");
    expect(out.atmosphere).toBeUndefined();
  });
});

describe("parseDirectorResponse — 非法值处理", () => {
  it("非 13 值枚举的 cameraMovement 被丢弃（不整条失败）", () => {
    const out = parseDirectorResponse(
      '{"cameraMovement": "whip_pan", "actionBeat": "急速转身"}'
    );
    expect(out.cameraMovement).toBeUndefined();
    expect(out.actionBeat).toBe("急速转身");
  });

  it("缺失 actionBeat → 抛错", () => {
    expect(() =>
      parseDirectorResponse('{"cameraMovement": "static"}')
    ).toThrow();
  });

  it("空 actionBeat → 抛错", () => {
    expect(() =>
      parseDirectorResponse('{"actionBeat": "   ", "cameraMovement": "static"}')
    ).toThrow();
  });

  it("无法解析为 JSON → 抛错", () => {
    expect(() => parseDirectorResponse("这不是 JSON")).toThrow();
  });

  it("超长 actionBeat（>120 字）→ 截断到 120 字（保留导演意图，不整条丢）", () => {
    const long = "动".repeat(200);
    const out = parseDirectorResponse(
      JSON.stringify({ cameraMovement: "static", actionBeat: long })
    );
    expect(out.actionBeat.length).toBe(120);
  });

  it("超长 atmosphere（>60 字符）→ 丢弃（可选字段）", () => {
    const longAtmosphere = "a".repeat(80);
    const out = parseDirectorResponse(
      JSON.stringify({
        cameraMovement: "static",
        actionBeat: "静止呼吸",
        atmosphere: longAtmosphere,
      })
    );
    expect(out.atmosphere).toBeUndefined();
    expect(out.actionBeat).toBe("静止呼吸");
  });

  it("actionBeat 是中文（不要求纯 ASCII，与 Avoid 段无关）", () => {
    const out = parseDirectorResponse(
      '{"cameraMovement": "zoom_in", "actionBeat": "泪水在眼眶里打转，将落未落"}'
    );
    expect(out.actionBeat).toBe("泪水在眼眶里打转，将落未落");
  });
});

describe("parseDirectorResponse — 镜内首尾帧分解字段（包 B）", () => {
  it("large + endFrameDesc → 两者都保留", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        cameraMovement: "dolly_in",
        actionBeat: "由全景快速推进到人物特写",
        variationType: "large",
        endFrameDesc: "林萧的脸占满画面，双眼直视镜头，背景虚化",
      })
    );
    expect(out.variationType).toBe("large");
    expect(out.endFrameDesc).toBe("林萧的脸占满画面，双眼直视镜头，背景虚化");
  });

  it("medium + endFrameDesc → 两者都保留", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "陈默从画面左侧走入，转身面对林萧",
        variationType: "medium",
        endFrameDesc: "陈默站在画面中央，正面朝向镜头，林萧在其右侧",
      })
    );
    expect(out.variationType).toBe("medium");
    expect(out.endFrameDesc).toBe(
      "陈默站在画面中央，正面朝向镜头，林萧在其右侧"
    );
  });

  it("small → endFrameDesc 被丢弃（语义自洽：不生成尾帧无需尾帧描述）", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "林萧微微皱眉",
        variationType: "small",
        endFrameDesc: "这段描述应被丢弃",
      })
    );
    expect(out.variationType).toBe("small");
    expect(out.endFrameDesc).toBeUndefined();
  });

  it("variationType 缺失 → endFrameDesc 被丢弃（缺失等价不生成尾帧）", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "林萧转身",
        endFrameDesc: "缺 variationType 时这段应被丢弃",
      })
    );
    expect(out.variationType).toBeUndefined();
    expect(out.endFrameDesc).toBeUndefined();
  });

  it("非法 variationType → 丢弃（连带丢弃 endFrameDesc）", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "林萧转身",
        variationType: "huge",
        endFrameDesc: "非法枚举，尾帧描述也应被丢弃",
      })
    );
    expect(out.variationType).toBeUndefined();
    expect(out.endFrameDesc).toBeUndefined();
    // actionBeat 不受影响（非法值不整条失败）
    expect(out.actionBeat).toBe("林萧转身");
  });

  it("超长 endFrameDesc（>160 字）→ 截断到 160 字（保留终态描述，不整条丢）", () => {
    const long = "终".repeat(300);
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "大幅推进",
        variationType: "large",
        endFrameDesc: long,
      })
    );
    expect(out.endFrameDesc?.length).toBe(160);
  });

  it("large 但 endFrameDesc 为空串 → variationType 保留、endFrameDesc undefined", () => {
    const out = parseDirectorResponse(
      JSON.stringify({
        actionBeat: "大幅推进",
        variationType: "large",
        endFrameDesc: "   ",
      })
    );
    expect(out.variationType).toBe("large");
    expect(out.endFrameDesc).toBeUndefined();
  });

  it("完全无这两个字段（老缓存/旧响应）→ 二者 undefined，零回归", () => {
    const out = parseDirectorResponse(
      '{"cameraMovement": "static", "actionBeat": "静止呼吸"}'
    );
    expect(out.variationType).toBeUndefined();
    expect(out.endFrameDesc).toBeUndefined();
  });
});
