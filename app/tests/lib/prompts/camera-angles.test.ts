import { describe, expect, it } from "vitest";

import {
  normalizeCameraAngle,
  CAMERA_ANGLES,
} from "@/lib/prompts/camera-angles";
import { buildVideoScenePrompt } from "@/lib/prompts/video-prompt";
import {
  DRAMA_SCRIPT_SYSTEM,
  buildDramaScriptUserPrompt,
} from "@/lib/prompts/agent-prompts/drama-script";

/**
 * 机位角度归一契约。
 *
 * 背景：`video-prompt.ts` 的 ANGLE_MODIFIER_MAP 键全英文，而
 * `agent-prompts/drama-script.ts` 此前教 LLM 输出中文（"低角度仰拍"）——
 * 查表必然 miss、静默返回空串。结果：短剧创作路径产出的所有机位角度
 * 在视频端 100% 失效，用户以为设计了仰拍压迫感，成片是平视。
 */
describe("normalizeCameraAngle", () => {
  it("中文别名归一到英文枚举", () => {
    expect(normalizeCameraAngle("低角度仰拍")).toBe("low-angle");
    expect(normalizeCameraAngle("俯视")).toBe("high-angle");
    expect(normalizeCameraAngle("平视")).toBe("eye-level");
    expect(normalizeCameraAngle("过肩")).toBe("over-the-shoulder");
    expect(normalizeCameraAngle("主观视角")).toBe("pov");
    expect(normalizeCameraAngle("鸟瞰")).toBe("birds-eye");
  });

  it("长词优先——「低角度仰拍」不被「仰拍」截断成不同结果", () => {
    // 两者都映射到 low-angle，但长词必须先命中（保证语义完整）
    expect(normalizeCameraAngle("低角度仰拍")).toBe("low-angle");
    expect(normalizeCameraAngle("仰拍")).toBe("low-angle");
  });

  it("子串包含匹配——带后缀的写法也能识别", () => {
    expect(normalizeCameraAngle("低角度仰拍镜头")).toBe("low-angle");
    expect(normalizeCameraAngle("略微俯视的角度")).toBe("high-angle");
  });

  it("已是规范值时原样返回（大小写不敏感，兼容历史 POV 写法）", () => {
    expect(normalizeCameraAngle("low-angle")).toBe("low-angle");
    expect(normalizeCameraAngle("POV")).toBe("pov");
    expect(normalizeCameraAngle("Dutch-Angle")).toBe("dutch-angle");
  });

  it("无法识别返回 null——不瞎猜", () => {
    expect(normalizeCameraAngle("斜四十五度俯冲加旋转")).toBeNull();
    expect(normalizeCameraAngle("随便什么")).toBeNull();
  });

  it("空值返回 null", () => {
    expect(normalizeCameraAngle("")).toBeNull();
    expect(normalizeCameraAngle(null)).toBeNull();
    expect(normalizeCameraAngle(undefined)).toBeNull();
    expect(normalizeCameraAngle("   ")).toBeNull();
  });
});

describe("视频 prompt 消费归一后的机位", () => {
  it("中文机位不再被静默丢弃——这是本次修复的核心", () => {
    const prompt = buildVideoScenePrompt({
      description: "她抬头看着高处的男人",
      shotType: "中景",
      cameraAngle: "低角度仰拍",
    });
    expect(prompt).toContain("from a low angle");
  });

  it("英文机位照常生效（解析路径零回归）", () => {
    const prompt = buildVideoScenePrompt({
      description: "她抬头看着高处的男人",
      shotType: "中景",
      cameraAngle: "low-angle",
    });
    expect(prompt).toContain("from a low angle");
  });

  it("eye-level 归一成功但不注入修饰——平视是默认状态不是效果", () => {
    const prompt = buildVideoScenePrompt({
      description: "两人对坐交谈",
      shotType: "中景",
      cameraAngle: "平视",
    });
    // 归一识别了它（不会走 log.warn 分支），但不产出修饰串
    expect(prompt).not.toContain("eye level");
    expect(normalizeCameraAngle("平视")).toBe("eye-level");
  });

  it("无法识别的机位不注入残缺修饰", () => {
    const prompt = buildVideoScenePrompt({
      description: "她抬头看着高处的男人",
      shotType: "中景",
      cameraAngle: "莫名其妙的角度",
    });
    expect(prompt).not.toContain("from a");
    expect(prompt).not.toContain("undefined");
  });
});

describe("创作路径 prompt 直接要求英文枚举", () => {
  it("列出全部合法枚举值，不再教 LLM 输出中文", () => {
    for (const angle of CAMERA_ANGLES) {
      expect(DRAMA_SCRIPT_SYSTEM).toContain(angle);
    }
  });

  it("JSON 示例用英文枚举（示例是 LLM 最强的模仿锚点）", () => {
    // 示例在 user prompt 构建函数里，不在 system prompt
    const userPrompt = buildDramaScriptUserPrompt({ worldview: "测试世界观" });
    expect(userPrompt).toContain('"cameraAngle": "low-angle"');
    expect(userPrompt).not.toContain('"cameraAngle": "低角度仰拍"');
  });
});
