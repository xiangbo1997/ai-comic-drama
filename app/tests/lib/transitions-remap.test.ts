/**
 * 转场索引对齐重建（remapTransitionsByKeepMask）单测。
 *
 * 背景缺陷：导出端滤掉无媒体分镜后，transitions（按【全量分镜】索引对齐的
 * gap 数组）原样透传，用户配在第 N 镜后的转场跑到别的位置。
 *
 * gap 合并语义（被测契约）：被滤掉的第 k 镜，其入边 gap(k-1) 与出边 gap(k) 在保留
 * 序列里合并成同一条边 → 保留前一个 gap 的配置、丢弃被删镜自身出边的配置。
 */

import { describe, it, expect } from "vitest";
import { remapTransitionsByKeepMask } from "@/lib/title-cards";

/** 用可读字符串代替 Transition 对象，断言更直观（函数是泛型的，与元素类型无关） */
const T = (n: number) => `t${n}`;

describe("remapTransitionsByKeepMask · 中间缺图", () => {
  it("滤掉中间一镜 → 合并该处两个 gap，保留前一个 gap 的配置", () => {
    // 全量 5 镜，gap: t0(0-1) t1(1-2) t2(2-3) t3(3-4)
    // 滤掉第 2 镜 → 保留 [0,1,3,4]
    // 期望 gap: 0-1 用 t0；1-3（合并 t1 入边与 t2 出边）用 t1；3-4 用 t3
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2), T(3)],
      [true, true, false, true, true]
    );
    expect(out).toEqual([T(0), T(1), T(3)]);
  });

  it("输出长度恒为「保留镜数 - 1」", () => {
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2), T(3)],
      [true, true, false, true, true]
    );
    expect(out).toHaveLength(4 - 1); // 保留 4 镜 → 3 条边
  });
});

describe("remapTransitionsByKeepMask · 连续缺图", () => {
  it("连续滤掉两镜 → 三条边合并为一条，仍取最前那个 gap 的配置", () => {
    // 全量 5 镜，滤掉第 1、2 镜 → 保留 [0,3,4]
    // 0-3 这条边由 t0(0-1) / t1(1-2) / t2(2-3) 合并而来 → 取 t0
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2), T(3)],
      [true, false, false, true, true]
    );
    expect(out).toEqual([T(0), T(3)]);
  });

  it("只剩一镜 → 无边可留，输出空数组", () => {
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2)],
      [false, false, true, false]
    );
    expect(out).toEqual([]);
  });

  it("全滤掉 → 空数组（导出端此前已按 length===0 拦截，这里保证不抛错）", () => {
    const out = remapTransitionsByKeepMask([T(0), T(1)], [false, false, false]);
    expect(out).toEqual([]);
  });
});

describe("remapTransitionsByKeepMask · 首尾缺图", () => {
  it("首镜被滤 → 其出边 gap(0) 直接丢弃（前面没有可保留的 gap）", () => {
    // 全量 4 镜，滤掉第 0 镜 → 保留 [1,2,3]，边为 1-2 / 2-3 → t1 / t2
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2)],
      [false, true, true, true]
    );
    expect(out).toEqual([T(1), T(2)]);
  });

  it("末镜被滤 → 末镜入边随之消失，前面各边不受影响", () => {
    // 全量 4 镜，滤掉第 3 镜 → 保留 [0,1,2]，边为 0-1 / 1-2 → t0 / t1
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2)],
      [true, true, true, false]
    );
    expect(out).toEqual([T(0), T(1)]);
  });

  it("首尾同时被滤 → 只剩中间镜之间的边", () => {
    // 全量 5 镜，滤掉第 0、4 镜 → 保留 [1,2,3]，边为 1-2 / 2-3 → t1 / t2
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2), T(3)],
      [false, true, true, true, false]
    );
    expect(out).toEqual([T(1), T(2)]);
  });
});

describe("remapTransitionsByKeepMask · 零回归与边界", () => {
  it("全部保留 → 原样返回（长度按「镜数-1」收敛，末镜出边丢弃）", () => {
    const out = remapTransitionsByKeepMask(
      [T(0), T(1), T(2)],
      [true, true, true, true]
    );
    expect(out).toEqual([T(0), T(1), T(2)]);
  });

  it("transitions 短于「镜数-1」时缺位以 undefined 占位，保持索引对齐", () => {
    // 用户只配了前 1 个 gap；保留 [0,1,3]，边 0-1 取 t0、1-3 取缺位 undefined
    const out = remapTransitionsByKeepMask([T(0)], [true, true, false, true]);
    expect(out).toEqual([T(0), undefined]);
  });

  it("不修改入参数组（immutability）", () => {
    const input = [T(0), T(1), T(2)];
    const snapshot = [...input];
    remapTransitionsByKeepMask(input, [true, false, true, true]);
    expect(input).toEqual(snapshot);
  });

  it("空 transitions + 有保留镜 → 全 undefined 占位，长度仍为保留镜数-1", () => {
    const out = remapTransitionsByKeepMask([], [true, true, true]);
    expect(out).toEqual([undefined, undefined]);
  });
});

describe("remapTransitionsByKeepMask · 与卡片位移叠加（导出端顺序契约）", () => {
  it("先掩码重建、后 unshift/push 卡片边界 → 卡片转场落在真正的首尾", () => {
    const cardTransition = "card";
    // 全量 4 镜，滤掉第 1 镜 → 保留 [0,2,3]
    const remapped = remapTransitionsByKeepMask(
      [T(0), T(1), T(2)],
      [true, false, true, true]
    );
    expect(remapped).toEqual([T(0), T(2)]);

    // 叠加片头 + 片尾卡
    const withCards = [cardTransition, ...remapped, cardTransition];
    // 保留 3 镜 + 双卡 = 5 段 → 4 条边
    expect(withCards).toHaveLength(4);
    expect(withCards[0]).toBe(cardTransition);
    expect(withCards[withCards.length - 1]).toBe(cardTransition);
  });
});
