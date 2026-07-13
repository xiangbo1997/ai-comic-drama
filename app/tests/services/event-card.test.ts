/**
 * 事件卡纯函数测试（Toonflow 事件表借鉴）
 *
 * 覆盖：
 * - extractEventCard：卡存在/缺失/前导空白与 BOM 容忍/多行正文保留
 * - buildEventMapBlock：空数组 → ""，非空 → 含地图标题与使用规则
 */

import { describe, it, expect } from "vitest";
import { extractEventCard } from "@/services/novel-ingest";
import { buildEventMapBlock } from "@/lib/prompts/script-parse";

describe("extractEventCard", () => {
  it("卡存在：剥离首行【事件卡】前缀，卡后空行不进正文", () => {
    const raw =
      "【事件卡】林逸｜事业崩塌触发系统｜主线关系:强\n\n林逸颓废地瘫在椅子上，屏幕的冷光映着脸。";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBe("林逸｜事业崩塌触发系统｜主线关系:强");
    expect(prose).toBe("林逸颓废地瘫在椅子上，屏幕的冷光映着脸。");
  });

  it("卡缺失：card 为 null，prose 原样返回（一字不动）", () => {
    const raw = "林逸颓废地瘫在椅子上。\n\n他喃喃：「如果会魔法就好了。」";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBeNull();
    expect(prose).toBe(raw);
  });

  it("前导空白与 BOM 容忍：仍能识别并剥离事件卡", () => {
    const raw =
      "﻿  \n 【事件卡】白有容｜登场引出悬念｜主线关系:中\n\n白有容立于门口，逆光看不清神情。";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBe("白有容｜登场引出悬念｜主线关系:中");
    expect(prose).toBe("白有容立于门口，逆光看不清神情。");
  });

  it("多行正文完整保留：卡后所有段落不丢失", () => {
    const raw =
      "【事件卡】林逸、白有容｜密谈揭真相｜主线关系:强\n\n第一段正文。\n\n第二段正文。\n第三行紧随其后。";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBe("林逸、白有容｜密谈揭真相｜主线关系:强");
    expect(prose).toBe("第一段正文。\n\n第二段正文。\n第三行紧随其后。");
  });

  it("只有事件卡无正文：card 提取成功，prose 为空串", () => {
    const raw = "【事件卡】林逸｜过场｜主线关系:弱";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBe("林逸｜过场｜主线关系:弱");
    expect(prose).toBe("");
  });

  it("前缀存在但内容为空：card 归 null（不产出空卡）", () => {
    const raw = "【事件卡】\n\n林逸颓废地瘫在椅子上。";
    const { card, prose } = extractEventCard(raw);
    expect(card).toBeNull();
    expect(prose).toBe("林逸颓废地瘫在椅子上。");
  });
});

describe("buildEventMapBlock", () => {
  it("空数组返回空串", () => {
    expect(buildEventMapBlock([])).toBe("");
  });

  it("全空白项过滤后仍为空：返回空串", () => {
    expect(buildEventMapBlock(["  ", "\n"])).toBe("");
  });

  it("非空：含地图标题、逐行事件卡与使用规则", () => {
    const cards = [
      "第1段：林逸｜事业崩塌触发系统｜主线关系:强",
      "第2段：白有容｜登场引出悬念｜主线关系:中",
    ];
    const block = buildEventMapBlock(cards);
    expect(block).toContain("【全书事件地图（按原文顺序，来自分块压缩）】");
    expect(block).toContain("第1段：林逸｜事业崩塌触发系统｜主线关系:强");
    expect(block).toContain("第2段：白有容｜登场引出悬念｜主线关系:中");
    expect(block).toContain("【地图使用规则】");
    // 主线关系「弱」压缩、「强」完整呈现的取舍规则在位
    expect(block).toContain("主线关系「弱」");
    expect(block).toContain("「强」的必须完整呈现");
  });
});
