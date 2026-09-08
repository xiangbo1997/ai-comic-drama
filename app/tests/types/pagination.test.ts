import { describe, it, expect } from "vitest";
import {
  parsePageLimit,
  parseCursor,
  sliceCursorPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/types/pagination";

describe("parsePageLimit", () => {
  it("未传 limit 返回 null（走旧版全量数组，向后兼容）", () => {
    expect(parsePageLimit(null)).toBeNull();
  });

  it("正常整数原样返回", () => {
    expect(parsePageLimit("1")).toBe(1);
    expect(parsePageLimit("24")).toBe(24);
    expect(parsePageLimit("100")).toBe(100);
  });

  it("超过上限夹紧到 MAX_PAGE_SIZE", () => {
    expect(parsePageLimit("101")).toBe(MAX_PAGE_SIZE);
    expect(parsePageLimit("999999")).toBe(MAX_PAGE_SIZE);
  });

  it("存在但非法回落 DEFAULT_PAGE_SIZE", () => {
    expect(parsePageLimit("")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("   ")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("0")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("-5")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("12.5")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("NaN")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageLimit("Infinity")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("带空白的合法数字仍被接受", () => {
    expect(parsePageLimit(" 30 ")).toBe(30);
  });
});

describe("parseCursor", () => {
  it("未传或空串视为首页（undefined）", () => {
    expect(parseCursor(null)).toBeUndefined();
    expect(parseCursor("")).toBeUndefined();
    expect(parseCursor("   ")).toBeUndefined();
  });

  it("非空游标 trim 后返回", () => {
    expect(parseCursor("abc")).toBe("abc");
    expect(parseCursor("  abc  ")).toBe("abc");
  });
});

describe("sliceCursorPage", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

  it("多取的第 N+1 条被裁掉，nextCursor 指向本页末条", () => {
    const page = sliceCursorPage(rows(4), 3);
    expect(page.items.map((r) => r.id)).toEqual(["id-0", "id-1", "id-2"]);
    expect(page.nextCursor).toBe("id-2");
  });

  it("刚好填满一页但无多余条时视为末页", () => {
    const page = sliceCursorPage(rows(3), 3);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("不足一页为末页", () => {
    const page = sliceCursorPage(rows(1), 3);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("空结果 nextCursor 为 null 且不越界", () => {
    const page = sliceCursorPage(rows(0), 3);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
