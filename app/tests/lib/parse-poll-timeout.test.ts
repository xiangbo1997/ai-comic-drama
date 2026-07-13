import { describe, it, expect } from "vitest";
import { parsePollTimeoutMs } from "@/app/(dashboard)/editor/[id]/hooks/use-editor-project";

const MIN = 60 * 1000;

describe("parsePollTimeoutMs（解析轮询超时自适应）", () => {
  it("≤10000 字维持 5 分钟基线", () => {
    expect(parsePollTimeoutMs(0)).toBe(5 * MIN);
    expect(parsePollTimeoutMs(5000)).toBe(5 * MIN);
    expect(parsePollTimeoutMs(10000)).toBe(5 * MIN);
  });

  it("每多 2 万字 +2 分钟（向上取整）", () => {
    // 10001~30000 字 → 第 1 阶 → 7 分钟
    expect(parsePollTimeoutMs(10001)).toBe(7 * MIN);
    expect(parsePollTimeoutMs(30000)).toBe(7 * MIN);
    // 30001~50000 字 → 第 2 阶 → 9 分钟
    expect(parsePollTimeoutMs(30001)).toBe(9 * MIN);
    expect(parsePollTimeoutMs(50000)).toBe(9 * MIN);
  });

  it("上限 20 分钟，超长文本封顶", () => {
    // 20 万字：ceil((200000-10000)/20000)=ceil(9.5)=10 步 → 5+20=25 分钟 → 封顶 20
    expect(parsePollTimeoutMs(200000)).toBe(20 * MIN);
    expect(parsePollTimeoutMs(1_000_000)).toBe(20 * MIN);
  });

  it("封顶边界：恰好 20 分钟前后", () => {
    // 第 7 阶：ceil((150000-10000)/20000)=ceil(7)=7 → 5+14=19 分钟
    expect(parsePollTimeoutMs(150000)).toBe(19 * MIN);
    // 第 8 阶：ceil((150001-10000)/20000)=ceil(7.00005)=8 → 5+16=21 → 封顶 20
    expect(parsePollTimeoutMs(150001)).toBe(20 * MIN);
    expect(parsePollTimeoutMs(170000)).toBe(20 * MIN);
  });
});
