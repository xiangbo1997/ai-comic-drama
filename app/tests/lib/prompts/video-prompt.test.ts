import { describe, it, expect } from "vitest";
import {
  buildVideoScenePrompt,
  describeCameraMovement,
} from "@/lib/prompts/video-prompt";

describe("buildVideoScenePrompt — 全字段映射与段落顺序", () => {
  it("特写 + eye-level + sad + anime + lighting 命中验收参考", () => {
    const out = buildVideoScenePrompt({
      description: "林萧靠在墙边，泪水在眼眶里打转",
      style: "anime",
      shotType: "特写",
      cameraAngle: "eye-level",
      cameraMovement: null,
      lighting: "soft window light",
      emotion: "sad",
      duration: 5,
    });
    expect(out).toBe(
      "Extreme close-up, slow, smooth push-in, building intimacy. " +
        "林萧靠在墙边，泪水在眼眶里打转. " +
        "Melancholic, subdued mood, consistent 2D anime aesthetic, soft window light. " +
        "Maintain the exact character appearance, outfit, and setting from the first frame; consistent lighting throughout. " +
        "No spoken dialogue, no lip-sync, ambient sound only. " +
        "Avoid: on-screen text, subtitles, watermark, extra limbs, deformed hands, face morphing, flickering, photorealistic rendering, live-action look."
    );
  });

  it("low-angle 机位修饰追加到取景后", () => {
    const out = buildVideoScenePrompt({
      description: "动作",
      shotType: "近景",
      cameraAngle: "low-angle",
    });
    expect(out).toContain("Close-up from a low angle,");
  });
});

describe("buildVideoScenePrompt — cameraMovement 为空时按 shotType 派生", () => {
  it("中景 + angry → tracking 变体（快速情绪）", () => {
    const out = buildVideoScenePrompt({
      description: "对峙",
      shotType: "中景",
      emotion: "angry",
      cameraMovement: null,
    });
    expect(out).toContain("steady tracking shot with subtle handheld energy");
  });

  it("中景 + neutral → slow dolly-in", () => {
    const out = buildVideoScenePrompt({
      description: "对话",
      shotType: "中景",
      emotion: "neutral",
    });
    expect(out).toContain("slow dolly-in toward the subject");
  });

  it("全景 → pull-out 揭示环境", () => {
    const out = buildVideoScenePrompt({
      description: "远眺",
      shotType: "全景",
    });
    expect(out).toContain("slow, cinematic pull-out revealing the environment");
  });

  it("无 shotType → gentle camera drift 兜底", () => {
    const out = buildVideoScenePrompt({ description: "画面" });
    expect(out).toContain(
      "gentle, slow camera drift with subtle in-scene motion"
    );
  });

  it("特写 + fear → quick decisive push-in（情绪加速）", () => {
    const out = buildVideoScenePrompt({
      description: "惊恐",
      shotType: "特写",
      emotion: "fear",
    });
    expect(out).toContain("quick, decisive push-in");
  });
});

describe("buildVideoScenePrompt — FL 首尾帧模式", () => {
  it("hasLastFrame 替换运镜文案 + 用过渡连续性 + 不加 arc", () => {
    const out = buildVideoScenePrompt({
      description: "转场衔接",
      shotType: "中景",
      cameraMovement: "zoom_in",
      duration: 15,
      hasLastFrame: true,
    });
    expect(out).toContain(
      "Smooth continuous camera motion that begins on the first frame and seamlessly transitions to end on the final frame"
    );
    // 显式 cameraMovement 在 FL 模式下被忽略
    expect(out).not.toContain("push-in that gradually tightens");
    // 连续性用过渡文案
    expect(out).toContain(
      "Maintain character and setting continuity across the transition"
    );
    // FL 模式即使 duration>=10 也不加运动弧线
    expect(out).not.toContain("Beginning steady, then gradually intensifying");
  });
});

describe("buildVideoScenePrompt — 运动弧线仅在 duration>=10 且非 FL 出现", () => {
  it("duration=10 且非 FL → 追加 arc", () => {
    const out = buildVideoScenePrompt({
      description: "渐强",
      shotType: "中景",
      duration: 10,
    });
    expect(out).toContain(
      "Beginning steady, then gradually intensifying the movement toward the end"
    );
  });

  it("duration=5 → 无 arc", () => {
    const out = buildVideoScenePrompt({
      description: "短镜",
      shotType: "中景",
      duration: 5,
    });
    expect(out).not.toContain("Beginning steady, then gradually intensifying");
  });
});

describe("buildVideoScenePrompt — 降级：仅 description", () => {
  it("只有 description → 运镜兜底 + 连续性 + 音频 + Avoid，无悬挂分隔符", () => {
    const out = buildVideoScenePrompt({ description: "人物站立不动" });
    // 无双句号、无双逗号、无逗号紧接句号、不以逗号/句号开头
    expect(out).not.toMatch(/\.\s*\./);
    expect(out).not.toContain(", .");
    expect(out).not.toContain(",,");
    expect(out).not.toMatch(/^[,.]/);
    // 关键段都在
    expect(out).toContain("人物站立不动");
    expect(out).toContain("gentle, slow camera drift");
    expect(out).toContain(
      "Maintain the exact character appearance, outfit, and setting"
    );
    expect(out).toContain(
      "No spoken dialogue, no lip-sync, ambient sound only"
    );
    expect(out.startsWith("Avoid")).toBe(false);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("buildVideoScenePrompt — 负面词段纯 ASCII（内容安全硬约束）", () => {
  const styles = [
    "anime",
    "realistic",
    "comic",
    "watercolor",
    "cyberpunk",
    "fantasy",
    "3d",
    "oil",
    "sketch",
    null,
  ];

  for (const style of styles) {
    it(`style=${style ?? "null"} 时 Avoid 段落纯 ASCII`, () => {
      const out = buildVideoScenePrompt({
        description: "带中文的动作描述：林萧愤怒地转身",
        style,
        shotType: "特写",
        emotion: "angry",
      });
      const idx = out.indexOf("Avoid:");
      expect(idx).toBeGreaterThan(-1);
      const avoidSection = out.slice(idx);
      expect(avoidSection).toMatch(/^[\x20-\x7E]+$/);
    });
  }
});

describe("buildVideoScenePrompt — realistic vs anime 负面分支", () => {
  it("anime → 追加 photorealistic/live-action 负面", () => {
    const out = buildVideoScenePrompt({ description: "x", style: "anime" });
    expect(out).toContain("photorealistic rendering");
    expect(out).toContain("live-action look");
    expect(out).not.toContain("plastic texture");
  });

  it("realistic → 追加 cartoon/anime 负面（9 条上限截断 plastic texture）", () => {
    const out = buildVideoScenePrompt({ description: "x", style: "realistic" });
    // 7 通用 + 3 realistic = 10，上限 9 条截断末尾的 plastic texture
    expect(out).toContain("cartoon");
    expect(out).toContain("anime");
    expect(out).not.toContain("plastic texture");
    expect(out).not.toContain("photorealistic rendering");
  });

  it("负面词合并后不超过 9 条", () => {
    const out = buildVideoScenePrompt({ description: "x", style: "realistic" });
    const idx = out.indexOf("Avoid:");
    const list = out
      .slice(idx + "Avoid:".length)
      .replace(/\.$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(list.length).toBeLessThanOrEqual(9);
  });
});

describe("buildVideoScenePrompt — actionBeat 补进 Action 段", () => {
  it("有 actionBeat → Action = description。actionBeat（中文拼接）", () => {
    const out = buildVideoScenePrompt({
      description: "林萧站在窗边",
      actionBeat: "缓缓抬手拉开窗帘，晨光洒在脸上，睫毛轻颤",
      shotType: "近景",
      emotion: "neutral",
    });
    expect(out).toContain(
      "林萧站在窗边。缓缓抬手拉开窗帘，晨光洒在脸上，睫毛轻颤"
    );
  });

  it("无 actionBeat → Action 仅 description（不追加句号）", () => {
    const out = buildVideoScenePrompt({
      description: "林萧站在窗边",
      shotType: "近景",
    });
    expect(out).toContain("林萧站在窗边.");
    expect(out).not.toContain("林萧站在窗边。");
  });

  it("空白 actionBeat 视同无（不拼空节拍）", () => {
    const out = buildVideoScenePrompt({
      description: "林萧站在窗边",
      actionBeat: "   ",
      shotType: "近景",
    });
    expect(out).not.toContain("林萧站在窗边。");
  });
});

describe("buildVideoScenePrompt — atmosphereOverride 替换情绪氛围", () => {
  it("有 override → 用 override，丢弃 emotion 派生的 ATMOSPHERE_MAP 短语", () => {
    const out = buildVideoScenePrompt({
      description: "对峙",
      style: "anime",
      shotType: "中景",
      emotion: "sad", // ATMOSPHERE_MAP.sad = "melancholic, subdued mood"
      atmosphereOverride: "quiet dread before the storm",
    });
    expect(out).toContain("Quiet dread before the storm");
    expect(out).not.toContain("melancholic, subdued mood");
    // 风格短句不受影响，仍在氛围段
    expect(out).toContain("consistent 2D anime aesthetic");
  });

  it("无 override → 回落 emotion 派生氛围", () => {
    const out = buildVideoScenePrompt({
      description: "对峙",
      shotType: "中景",
      emotion: "sad",
    });
    expect(out).toContain("Melancholic, subdued mood");
  });

  it("空白 override 视同无 → 回落 emotion 派生氛围", () => {
    const out = buildVideoScenePrompt({
      description: "对峙",
      shotType: "中景",
      emotion: "sad",
      atmosphereOverride: "   ",
    });
    expect(out).toContain("Melancholic, subdued mood");
  });
});

describe("describeCameraMovement — 已知/未知/空", () => {
  it("已知标识符映射到复合运镜短语", () => {
    expect(describeCameraMovement("zoom_in")).toBe(
      "slow, smooth push-in that gradually tightens on the subject"
    );
    expect(describeCameraMovement("static")).toBe(
      "locked-off static frame with only subtle in-scene motion (hair, cloth, breathing)"
    );
    expect(describeCameraMovement("crane")).toBe(
      "crane shot rising to reveal the full scale of the scene"
    );
  });

  it("未知标识符下划线转空格降级", () => {
    expect(describeCameraMovement("whip_pan")).toBe("whip pan");
  });

  it("空值返回空串", () => {
    expect(describeCameraMovement(null)).toBe("");
    expect(describeCameraMovement(undefined)).toBe("");
    expect(describeCameraMovement("")).toBe("");
  });
});

describe("buildVideoScenePrompt — 长度守卫", () => {
  it("超长 description + 全字段 → 按优先级丢 lighting/atmosphere/style，保留 description+负面词", () => {
    const longDesc = "林".repeat(800);
    const out = buildVideoScenePrompt({
      description: longDesc,
      style: "anime",
      shotType: "中景",
      cameraAngle: "low-angle",
      cameraMovement: "tracking",
      lighting: "dramatic rim lighting with deep shadows across the frame",
      emotion: "sad",
      duration: 15,
    });
    // description 与负面词永不丢弃
    expect(out).toContain(longDesc);
    expect(out).toContain("Avoid:");
    // 连续性/音频/运镜永不丢弃
    expect(out).toContain("Maintain the exact character appearance");
    expect(out).toContain("No spoken dialogue");
    expect(out).toContain("tracking shot");
    // 优先丢弃：lighting → atmosphere → arc → style
    expect(out).not.toContain("dramatic rim lighting");
    expect(out).not.toContain("melancholic");
    expect(out).not.toContain("consistent 2D anime aesthetic");
  });
});

describe("buildVideoScenePrompt — 身份无关（不做前缀注入）", () => {
  it("description 含人名时不追加任何身份前缀 / Avoid 不重复", () => {
    const out = buildVideoScenePrompt({
      description: "林萧转身离开",
      shotType: "中景",
    });
    // 输出以运镜段开头（取景短语），而非人名/身份前缀
    expect(out.startsWith("Medium shot")).toBe(true);
    // Avoid 只出现一次
    const matches = out.match(/Avoid:/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
