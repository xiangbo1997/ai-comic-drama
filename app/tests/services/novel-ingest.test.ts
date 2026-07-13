import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chatCompletion（唯一外部副作用）：默认返回压缩标记，便于断言调用/降级。
const chatCompletionMock = vi.fn();
vi.mock("@/services/ai", () => ({
  chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
}));

import {
  splitNovelText,
  compressNovel,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  NOVEL_COMPRESS_THRESHOLD,
} from "@/services/novel-ingest";
import type { AIServiceConfig } from "@/types";

const llmConfig: AIServiceConfig = {
  apiKey: "k",
  baseUrl: "https://example.com",
  model: "m",
  protocol: "openai",
};

describe("splitNovelText", () => {
  it("空/空白文本返回空数组", () => {
    expect(splitNovelText("")).toEqual([]);
    expect(splitNovelText("   \n  ")).toEqual([]);
  });

  it("短于 chunkSize 的文本作为单块返回（已 trim）", () => {
    const text = "第一段。\n\n第二段。";
    expect(splitNovelText(text, 100, 10)).toEqual([text]);
  });

  it("按段落边界切分：不把段落拦腰截断", () => {
    // 三段，每段 ~40 字，chunkSize=50 → 每块最多一段
    const p1 = "甲".repeat(40);
    const p2 = "乙".repeat(40);
    const p3 = "丙".repeat(40);
    const chunks = splitNovelText(`${p1}\n\n${p2}\n\n${p3}`, 50, 0);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
    expect(chunks[2]).toBe(p3);
  });

  it("多段可合并进同一块直到超过 chunkSize", () => {
    // 每段 20 字，chunkSize=50 → 两段合一块（20+2+20=42<=50），第三段开新块
    const seg = "字".repeat(20);
    const chunks = splitNovelText(`${seg}\n\n${seg}\n\n${seg}`, 50, 0);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${seg}\n\n${seg}`);
    expect(chunks[1]).toBe(seg);
  });

  it("超长单段按句末标点硬切，不产出超过 chunkSize 的片段", () => {
    // 单段无换行，10 句每句 15 字（含句号），chunkSize=40
    const sentence = "这是一句测试用的文本内容。"; // 13 字
    const para = sentence.repeat(10);
    const chunks = splitNovelText(para, 40, 0);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(40);
    }
    // 无损：所有块拼起来应包含全部句子（顺序保留）
    expect(chunks.join("")).toContain(sentence);
  });

  it("单句超过 chunkSize 时定长兜底切，仍不超限", () => {
    // 无标点的超长串，chunkSize=30
    const blob = "无标点长文本".repeat(20); // 120 字，无句末标点
    const chunks = splitNovelText(blob, 30, 0);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(30);
    }
    expect(chunks.join("")).toBe(blob);
  });

  it("overlap 正确：相邻块以上一块尾部 overlap 字符开头", () => {
    const p1 = "甲".repeat(40);
    const p2 = "乙".repeat(40);
    const overlap = 10;
    const chunks = splitNovelText(`${p1}\n\n${p2}`, 50, overlap);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    // 第二块 = 上一块尾部 overlap 字符 + 本块
    expect(chunks[1].startsWith("甲".repeat(overlap))).toBe(true);
    expect(chunks[1]).toBe("甲".repeat(overlap) + p2);
  });

  it("默认参数：长文按 CHUNK_SIZE 切分且带 CHUNK_OVERLAP", () => {
    const para = "情".repeat(CHUNK_SIZE - 100);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = splitNovelText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // 从第二块起带 overlap 前缀
    expect(chunks[1].length).toBeGreaterThan(para.length);
    expect(chunks[1].startsWith("情".repeat(CHUNK_OVERLAP))).toBe(true);
  });
});

describe("compressNovel", () => {
  beforeEach(() => {
    chatCompletionMock.mockReset();
  });

  it("短文本（≤阈值）原样返回，不调用 LLM", async () => {
    const text = "短文本".repeat(10); // 远小于阈值
    const result = await compressNovel(text, llmConfig);
    expect(result.compressed).toBe(false);
    expect(result.text).toBe(text);
    expect(result.originalLength).toBe(text.length);
    expect(result.compressedLength).toBe(text.length);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("长文本触发压缩：并行压缩每块并拼接", async () => {
    // 每块压缩返回固定短串，拼接后小于聚合阈值 → 不触发聚合
    chatCompletionMock.mockResolvedValue("压缩块");
    const para = "情".repeat(CHUNK_SIZE - 200);
    const text = `${para}\n\n${para}`; // 两块，均超阈值
    const result = await compressNovel(text, llmConfig);
    expect(result.compressed).toBe(true);
    expect(result.originalLength).toBe(text.length);
    // 每块一次调用（拼接结果远小于聚合阈值，无聚合调用）
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("压缩块\n\n压缩块");
  });

  it("单块压缩失败：重试后仍失败则原文降级保留（不丢块）", async () => {
    // 该块两次调用都抛错 → 降级为原文
    chatCompletionMock.mockRejectedValue(new Error("上游超时"));
    const para = "情".repeat(NOVEL_COMPRESS_THRESHOLD + 500); // 单块超阈值
    const result = await compressNovel(para, llmConfig);
    expect(result.compressed).toBe(true);
    // 原文降级：产出应包含原文（未被丢弃）
    expect(result.text).toContain("情");
    expect(result.text.length).toBeGreaterThan(0);
    // 单块 = 1 次 + 1 次重试 = 2 次调用
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
  });

  it("压缩返回空串视为失败并原文降级", async () => {
    chatCompletionMock.mockResolvedValue("   ");
    const para = "情".repeat(NOVEL_COMPRESS_THRESHOLD + 500);
    const result = await compressNovel(para, llmConfig);
    expect(result.text).toContain("情");
    // 空串两次都失败 → 2 次调用
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
  });

  it("onProgress 回调随块完成推进", async () => {
    chatCompletionMock.mockResolvedValue("压缩块");
    const para = "情".repeat(CHUNK_SIZE - 200);
    const text = `${para}\n\n${para}`;
    const progress: Array<[number, number]> = [];
    await compressNovel(text, llmConfig, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    // 首次 (0,total) + 每块完成一次
    expect(progress[0]).toEqual([0, 2]);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
});
