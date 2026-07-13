/**
 * 爆款方法论 Prompt 层测试
 *
 * 覆盖：
 * - episode-structure.ts 四块规则非空 + 含关键短语
 * - 两条解析路径（script-parse / script-parser）均注入方法论
 * - drama-script 凑时长文本已删除、结尾钩子规则无条件（含第 1 集）
 */

import { describe, it, expect } from "vitest";
import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  EPISODE_CONFLICT_RULES,
  SHOT_RHYTHM_RULES,
  buildEpisodeStructureBlock,
} from "@/lib/prompts/episode-structure";
import {
  SCRIPT_PARSE_SYSTEM,
  buildScriptParseUserPrompt,
} from "@/lib/prompts/script-parse";
import {
  SCRIPT_PARSER_SYSTEM,
  buildScriptParserUserPrompt,
} from "@/lib/prompts/agent-prompts/script-parser";
import {
  DRAMA_SCRIPT_SYSTEM,
  buildDramaScriptUserPrompt,
} from "@/lib/prompts/agent-prompts/drama-script";
import {
  STORYBOARD_TABLE_SYSTEM,
  buildStoryboardTableUserPrompt,
} from "@/lib/prompts/agent-prompts/storyboard-table";
import { STORYBOARD_REVIEW_SYSTEM } from "@/lib/prompts/agent-prompts/narrative-review";
import type { DramaScriptArtifact } from "@/types/drama";

describe("episode-structure 规则块", () => {
  it("五块规则均非空", () => {
    for (const block of [
      EPISODE_HOOK_RULES,
      EPISODE_PACING_RULES,
      EPISODE_ENDING_RULES,
      EPISODE_CONFLICT_RULES,
      SHOT_RHYTHM_RULES,
    ]) {
      expect(block.trim().length).toBeGreaterThan(50);
    }
  });

  it("冲突升级块含矛盾四级阶梯 / 反转三式 / 反同质化关键短语", () => {
    // 矛盾四级阶梯
    expect(EPISODE_CONFLICT_RULES).toContain("矛盾四级阶梯");
    expect(EPISODE_CONFLICT_RULES).toContain("两个好人");
    // 股价级反转三式
    expect(EPISODE_CONFLICT_RULES).toContain("预期误导");
    expect(EPISODE_CONFLICT_RULES).toContain("人设颠覆");
    expect(EPISODE_CONFLICT_RULES).toContain("动机置换");
    // 反转须预埋 + 反转≠钩子
    expect(EPISODE_CONFLICT_RULES).toContain("预埋");
    expect(EPISODE_CONFLICT_RULES).toContain("反转 ≠ 钩子");
    // 反同质化
    expect(EPISODE_CONFLICT_RULES).toContain("反同质化");
  });

  it("含爆款方法论关键短语", () => {
    // 结尾钩子轮换
    expect(EPISODE_ENDING_RULES).toContain("连续 3 集禁同型");
    // 五类钩子对齐 series-bible HOOK_TYPES
    for (const t of ["悬念", "反转", "情绪", "信息", "危机"]) {
      expect(EPISODE_ENDING_RULES).toContain(t);
    }
    // 单镜节奏：急推特写 + 禁止凑时长
    expect(SHOT_RHYTHM_RULES).toContain("急推特写");
    expect(SHOT_RHYTHM_RULES).toContain("凑时长");
    // 开场：0-3 秒留存 + 严禁慢开场
    expect(EPISODE_HOOK_RULES).toContain("冲突最高点");
    // 节奏：打脸四步公式 + 爽点
    expect(EPISODE_PACING_RULES).toContain("打脸");
  });

  it("buildEpisodeStructureBlock 默认含冲突升级、不含分镜层，includeShotRhythm 时追加", () => {
    const base = buildEpisodeStructureBlock();
    expect(base).toContain(EPISODE_HOOK_RULES);
    expect(base).toContain(EPISODE_ENDING_RULES);
    // 冲突升级默认包含（剧本层通用方法论）
    expect(base).toContain(EPISODE_CONFLICT_RULES);
    expect(base).not.toContain(SHOT_RHYTHM_RULES);

    const withRhythm = buildEpisodeStructureBlock({ includeShotRhythm: true });
    expect(withRhythm).toContain(SHOT_RHYTHM_RULES);
  });

  it("buildEpisodeStructureBlock includeConflict:false 时排除冲突升级块", () => {
    const noConflict = buildEpisodeStructureBlock({ includeConflict: false });
    expect(noConflict).not.toContain(EPISODE_CONFLICT_RULES);
    expect(noConflict).toContain(EPISODE_HOOK_RULES);
  });
});

describe("小说解析路径：两条 system prompt 均注入方法论", () => {
  it("script-parse.ts 与 script-parser.ts 都含五块规则（含冲突升级）", () => {
    for (const sys of [SCRIPT_PARSE_SYSTEM, SCRIPT_PARSER_SYSTEM]) {
      expect(sys).toContain(EPISODE_HOOK_RULES);
      expect(sys).toContain(EPISODE_PACING_RULES);
      expect(sys).toContain(EPISODE_ENDING_RULES);
      expect(sys).toContain(EPISODE_CONFLICT_RULES);
      expect(sys).toContain(SHOT_RHYTHM_RULES);
    }
  });

  it("旧的固定分镜数 / 2-5 秒表述已改为密度化 + 自动分段", () => {
    expect(SCRIPT_PARSE_SYSTEM).not.toContain("通常2-5秒");
    expect(SCRIPT_PARSER_SYSTEM).not.toContain("通常 2-5 秒");
    // user prompt 改为密度化，不再写死 10-30
    const u1 = buildScriptParseUserPrompt("测试小说文本正文");
    const u2 = buildScriptParserUserPrompt("测试小说文本正文");
    for (const u of [u1, u2]) {
      expect(u).not.toContain("10-30");
      expect(u).toContain("每分钟成片约 15-25 个分镜");
      expect(u).toContain("禁止凑数");
    }
  });
});

describe("短剧创作路径：凑时长根因已移除", () => {
  const baseInput = { worldview: "苍潮界，群岛与古代遗迹的世界" };

  it("system + user prompt 均不含「之和应接近」/「之和接近」凑时长表述", () => {
    expect(DRAMA_SCRIPT_SYSTEM).not.toContain("之和应接近");
    const u = buildDramaScriptUserPrompt(baseInput);
    expect(u).not.toContain("之和接近");
    expect(u).not.toContain("之和应接近");
  });

  it("显式出现「禁止拉长镜头凑时长」反向约束", () => {
    expect(DRAMA_SCRIPT_SYSTEM).toContain("禁止拉长镜头凑时长");
    const u = buildDramaScriptUserPrompt(baseInput);
    expect(u).toContain("禁止拉长镜头凑时长");
  });

  it("hookType 进入输出格式 + 顶层字段说明", () => {
    expect(DRAMA_SCRIPT_SYSTEM).toContain("hookType");
    const u = buildDramaScriptUserPrompt(baseInput);
    expect(u).toContain("hookType");
  });

  it("创作 system prompt 注入冲突升级方法论块", () => {
    expect(DRAMA_SCRIPT_SYSTEM).toContain(EPISODE_CONFLICT_RULES);
  });
});

describe("结尾钩子规则：无条件适用（含第 1 集）", () => {
  it("第 1 集（无系列记忆）prompt 仍要求结尾留钩", () => {
    const u = buildDramaScriptUserPrompt({
      worldview: "第一集独立世界观",
    });
    // 无续集专属文本
    expect(u).not.toContain("系列记忆");
    expect(u).not.toContain("本集是系列续集");
    // 但结尾钩子要求仍在（system 块无条件 + user 第 5 条）
    expect(DRAMA_SCRIPT_SYSTEM).toContain("每集必须留钩");
    expect(u).toContain("结尾必须留钩");
  });

  it("续集 prompt 保留承接前情专属要求（不破坏系列记忆注入）", () => {
    const u = buildDramaScriptUserPrompt({
      worldview: "苍潮界",
      previousEpisodeRecap: "第1集《启程》\n梗概：发现碎片",
    });
    expect(u).toContain("系列记忆");
    expect(u).toContain("本集是系列续集");
    expect(u).toContain("引向下一集的悬念钩子");
  });
});

describe("九宫格分镜表：钩子分明", () => {
  const script: DramaScriptArtifact = {
    filmTitle: "苍潮",
    genre: "热血",
    durationSec: 90,
    aspectRatio: "9:16",
    style: "anime",
    protagonist: "少年",
    worldview: "群岛世界",
    logline: "少年逆袭",
    scenes: [
      {
        index: 1,
        title: "开场",
        description: "少年立于崖边，狂风卷起碎片",
        dialogue: null,
        narration: null,
        emotion: "neutral",
        durationSec: 8,
      },
    ],
  };

  it("system + user 强调第 1 格冲突最高点、第 9 格悬念钩子", () => {
    expect(STORYBOARD_TABLE_SYSTEM).toContain("冲突最高点");
    expect(STORYBOARD_TABLE_SYSTEM).toContain("悬念钩子");
    const u = buildStoryboardTableUserPrompt(script);
    expect(u).toContain("冲突最高点");
  });
});

describe("叙事评审：新增开场/结尾钩子维度", () => {
  it("STORYBOARD_REVIEW_SYSTEM 含 hook_strength 与 cliffhanger 维度", () => {
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("hook_strength");
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("cliffhanger");
  });

  it("STORYBOARD_REVIEW_SYSTEM 含三大密度总标尺（情绪/信息/情节密度）", () => {
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("三大密度");
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("情绪密度");
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("信息密度");
    expect(STORYBOARD_REVIEW_SYSTEM).toContain("情节密度");
  });
});
