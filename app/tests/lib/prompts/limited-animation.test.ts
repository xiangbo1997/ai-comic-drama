import { describe, it, expect } from "vitest";
import {
  buildLimitedAnimationBlock,
  NO_APPEARANCE_RESTATEMENT,
  MICRO_EXPRESSION_RULES,
  PARALLAX_RULES,
  CAMERA_DELTA_RULES,
  LIMITED_ANIMATION_CAMERA_MOVEMENTS,
  HIGH_RISK_CAMERA_MOVEMENTS,
  isHighRiskCameraMovement,
} from "@/lib/prompts/limited-animation";
import { CAMERA_MOVEMENTS } from "@/lib/prompts/camera-movements";
import { buildVideoScenePrompt } from "@/lib/prompts/video-prompt";

describe("buildLimitedAnimationBlock — 规则块组合", () => {
  it("默认（无 options）注入完整四块，顺序固定", () => {
    const block = buildLimitedAnimationBlock();
    expect(block).toBe(
      [
        NO_APPEARANCE_RESTATEMENT,
        MICRO_EXPRESSION_RULES,
        PARALLAX_RULES,
        CAMERA_DELTA_RULES,
      ].join(". ")
    );
  });

  it("确定性：重复调用逐字相同", () => {
    const first = buildLimitedAnimationBlock();
    for (let i = 0; i < 10; i++) {
      expect(buildLimitedAnimationBlock()).toBe(first);
    }
  });

  it("allowLargeMotion 关掉微表情限制，其余保留", () => {
    const block = buildLimitedAnimationBlock({ allowLargeMotion: true });
    expect(block).not.toContain(MICRO_EXPRESSION_RULES);
    expect(block).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(block).toContain(PARALLAX_RULES);
  });

  it("skipParallax / skipCameraDelta 各自生效", () => {
    const block = buildLimitedAnimationBlock({
      skipParallax: true,
      skipCameraDelta: true,
    });
    expect(block).not.toContain(PARALLAX_RULES);
    expect(block).not.toContain(CAMERA_DELTA_RULES);
    expect(block).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(block).toContain(MICRO_EXPRESSION_RULES);
  });

  it("全部关闭时返回空串", () => {
    expect(
      buildLimitedAnimationBlock({
        allowAppearanceRestatement: true,
        allowLargeMotion: true,
        skipParallax: true,
        skipCameraDelta: true,
      })
    ).toBe("");
  });
});

describe("半动规则块 — 内容硬约束", () => {
  const blocks = [
    NO_APPEARANCE_RESTATEMENT,
    MICRO_EXPRESSION_RULES,
    PARALLAX_RULES,
    CAMERA_DELTA_RULES,
  ];

  it("全部纯 ASCII（服务端 content-safety 会拦中文敏感词，中文会致自我 400）", () => {
    for (const b of blocks) {
      expect(/^[\x20-\x7E]+$/.test(b)).toBe(true);
    }
  });

  it("视差比例与旋转上限写成具体数字（模型可量化执行）", () => {
    expect(PARALLAX_RULES).toContain("1.5 : 1 : 0.5");
    expect(PARALLAX_RULES).toContain("5 degrees");
  });

  it("视角 delta 按 30 度档位递进", () => {
    expect(CAMERA_DELTA_RULES).toContain("30-degree");
  });

  it("微表情块列出允许的微动作，并把大幅位移交给运镜", () => {
    expect(MICRO_EXPRESSION_RULES).toContain("blink");
    expect(MICRO_EXPRESSION_RULES).toContain("come from the camera");
  });

  it("不重述外貌块明确把身份归给首帧", () => {
    expect(NO_APPEARANCE_RESTATEMENT).toContain("first frame");
    expect(NO_APPEARANCE_RESTATEMENT).toContain("Do not describe");
  });
});

describe("半动运镜子集 — 与 13 值枚举对齐", () => {
  it("推荐 + 高风险 = 完整 13 值枚举（无遗漏、无越界）", () => {
    const union = [
      ...LIMITED_ANIMATION_CAMERA_MOVEMENTS,
      ...HIGH_RISK_CAMERA_MOVEMENTS,
    ];
    expect(union.length).toBe(CAMERA_MOVEMENTS.length);
    expect([...union].sort()).toEqual([...CAMERA_MOVEMENTS].sort());
  });

  it("高风险项即环绕/跟拍/摇臂/手持", () => {
    expect([...HIGH_RISK_CAMERA_MOVEMENTS].sort()).toEqual([
      "crane",
      "handheld",
      "orbit",
      "tracking",
    ]);
  });

  it("isHighRiskCameraMovement 判定", () => {
    expect(isHighRiskCameraMovement("orbit")).toBe(true);
    expect(isHighRiskCameraMovement("tracking")).toBe(true);
    expect(isHighRiskCameraMovement("zoom_in")).toBe(false);
    expect(isHighRiskCameraMovement("static")).toBe(false);
    // 未知值宽容降级为非高风险，不阻断生成
    expect(isHighRiskCameraMovement("unknown_move")).toBe(false);
    expect(isHighRiskCameraMovement(null)).toBe(false);
    expect(isHighRiskCameraMovement(undefined)).toBe(false);
  });
});

describe("buildVideoScenePrompt — 半动纪律接入", () => {
  it("默认开启：prompt 含半动四块", () => {
    const out = buildVideoScenePrompt({
      description: "人物站在窗边",
      shotType: "近景",
    });
    expect(out).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(out).toContain(MICRO_EXPRESSION_RULES);
    expect(out).toContain(PARALLAX_RULES);
    expect(out).toContain(CAMERA_DELTA_RULES);
  });

  it("limitedAnimation:false 时完全不注入（廉价回滚，prompt 回到改动前形态）", () => {
    const out = buildVideoScenePrompt({
      description: "人物站在窗边",
      shotType: "近景",
      limitedAnimation: false,
    });
    expect(out).not.toContain(NO_APPEARANCE_RESTATEMENT);
    expect(out).not.toContain(MICRO_EXPRESSION_RULES);
    expect(out).not.toContain(PARALLAX_RULES);
    expect(out).not.toContain(CAMERA_DELTA_RULES);
    // 且长度回到 900 上限体系（原有段落仍在）
    expect(out).toContain("Maintain the exact character appearance");
  });

  it("impact 节拍镜自动放宽微表情限制（打击镜本该大动）", () => {
    const out = buildVideoScenePrompt({
      description: "拳头砸向桌面",
      shotType: "特写",
      beatType: "impact",
    });
    expect(out).not.toContain(MICRO_EXPRESSION_RULES);
    // 但「别重画人」仍然保留
    expect(out).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(out).toContain("snappy, forceful motion");
  });

  it("FL 首尾帧模式跳过视差与视角 delta（关键帧已钉死两端角度）", () => {
    const out = buildVideoScenePrompt({
      description: "人物转身",
      hasLastFrame: true,
    });
    expect(out).not.toContain(PARALLAX_RULES);
    expect(out).not.toContain(CAMERA_DELTA_RULES);
    expect(out).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(out).toContain(MICRO_EXPRESSION_RULES);
  });

  it("半动纪律紧跟连续性段之后、音频指令之前", () => {
    const out = buildVideoScenePrompt({
      description: "人物站在窗边",
      shotType: "近景",
    });
    const continuityIdx = out.indexOf(
      "Maintain the exact character appearance"
    );
    const limitedIdx = out.indexOf(NO_APPEARANCE_RESTATEMENT);
    const audioIdx = out.indexOf("No spoken dialogue");
    expect(continuityIdx).toBeGreaterThanOrEqual(0);
    expect(limitedIdx).toBeGreaterThan(continuityIdx);
    expect(audioIdx).toBeGreaterThan(limitedIdx);
  });

  it("半动开启时长度守卫不丢半动块（上限抬到 1800）", () => {
    const out = buildVideoScenePrompt({
      description: "长".repeat(400),
      shotType: "近景",
      style: "anime",
      emotion: "sad",
      lighting: "golden hour warm backlight",
      duration: 12,
    });
    expect(out).toContain(NO_APPEARANCE_RESTATEMENT);
    expect(out).toContain(MICRO_EXPRESSION_RULES);
    // 负面词段与音频指令始终保留在末尾
    expect(out).toContain("Avoid:");
  });

  it("仍然身份无关：半动块不引入任何外貌词汇", () => {
    const out = buildVideoScenePrompt({ description: "人物站立" });
    expect(out).not.toMatch(/hair color|wearing a|outfit is/i);
  });
});
