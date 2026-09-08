/**
 * GenerationAttempt 按分镜保留期裁剪 —— 选择逻辑单测
 *
 * 只测纯函数 selectAttemptsToPrune（哪些历史版本该删），
 * DB / 存储副作用由 pruneSceneAttempts 承担，不在此覆盖。
 */

import { describe, it, expect } from "vitest";
// 直接从纯逻辑模块导入：attempt-retention.ts 顶层 import prisma，
// 测试进程无 DATABASE_URL，导入即抛
import {
  selectAttemptsToPrune,
  type PrunableAttempt,
} from "@/lib/cleanup/select-attempts-to-prune";

/** 造一批 attempt：id 为 a0..aN-1，createdAt 依次递增（a0 最旧） */
function makeAttempts(
  count: number,
  overrides: Partial<Record<number, Partial<PrunableAttempt>>> = {}
): PrunableAttempt[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
    isCurrent: false,
    outputUrl: `https://cdn.example.com/a${i}.png`,
    ...overrides[i],
  }));
}

describe("selectAttemptsToPrune", () => {
  it("条数未超保留数时不删任何版本", () => {
    expect(selectAttemptsToPrune(makeAttempts(5), 20)).toEqual([]);
    expect(selectAttemptsToPrune(makeAttempts(20), 20)).toEqual([]);
  });

  it("超出保留数时删最旧的，保留最新 N 条", () => {
    const pruned = selectAttemptsToPrune(makeAttempts(25), 20);
    expect(pruned.map((a) => a.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
  });

  it("返回顺序为从旧到新", () => {
    const pruned = selectAttemptsToPrune(makeAttempts(24), 20);
    const times = pruned.map((a) => a.createdAt.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it("isCurrent 的版本再老也不删", () => {
    // a0 最旧但是当前选中版本
    const attempts = makeAttempts(25, { 0: { isCurrent: true } });
    const pruned = selectAttemptsToPrune(attempts, 20);
    expect(pruned.map((a) => a.id)).not.toContain("a0");
    // 保留集 = a0 + 最新 19 条，故被删的是次旧的 5 条
    expect(pruned.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("保留集含多条 isCurrent 时不会超删", () => {
    const attempts = makeAttempts(10, {
      0: { isCurrent: true },
      1: { isCurrent: true },
    });
    const pruned = selectAttemptsToPrune(attempts, 3);
    // 保留 a0 / a1（current）+ 最新的 a9，删剩下 7 条
    expect(pruned.map((a) => a.id)).toEqual([
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
      "a7",
      "a8",
    ]);
  });

  it("keepPerScene 为 0 时删除所有非当前版本", () => {
    const attempts = makeAttempts(3, { 2: { isCurrent: true } });
    const pruned = selectAttemptsToPrune(attempts, 0);
    expect(pruned.map((a) => a.id)).toEqual(["a0", "a1"]);
  });

  it("空输入返回空", () => {
    expect(selectAttemptsToPrune([], 20)).toEqual([]);
  });

  it("createdAt 相同时按 id 稳定排序，结果确定", () => {
    const same = new Date(2026, 0, 1);
    const attempts: PrunableAttempt[] = ["c", "a", "b"].map((id) => ({
      id,
      createdAt: same,
      isCurrent: false,
      outputUrl: null,
    }));
    const pruned = selectAttemptsToPrune(attempts, 1);
    // 降序排序中同时间按 id 升序 → a 在最前被保留，删 b 与 c
    expect(pruned.map((a) => a.id).sort()).toEqual(["b", "c"]);
  });
});
