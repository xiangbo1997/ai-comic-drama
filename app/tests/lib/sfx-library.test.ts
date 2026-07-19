import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import path from "path";
import {
  SFX_LIBRARY,
  SFX_CATEGORIES,
  SFX_TAGS,
  getSfxById,
  listSfxByCategory,
  resolveSfxTag,
} from "@/lib/sfx-library";

describe("SFX_LIBRARY 完整性", () => {
  it("id 全局唯一", () => {
    const ids = SFX_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条 category 都在分类白名单内", () => {
    const catIds = new Set(SFX_CATEGORIES.map((c) => c.id));
    for (const s of SFX_LIBRARY) {
      expect(catIds.has(s.category)).toBe(true);
    }
  });

  it("每个分类至少有一条音效（resolveSfxTag 分类兜底不落空）", () => {
    for (const cat of SFX_CATEGORIES) {
      expect(listSfxByCategory(cat.id).length).toBeGreaterThan(0);
    }
  });

  it("清单与磁盘实体一一对应（防止清单/文件漂移导致导出静默缺音效）", () => {
    for (const s of SFX_LIBRARY) {
      const diskPath = path.join(process.cwd(), "public", s.file);
      expect(existsSync(diskPath), `${s.id} → ${s.file} 不存在`).toBe(true);
    }
  });

  it("durationSec / defaultVolume 在合理范围", () => {
    for (const s of SFX_LIBRARY) {
      expect(s.durationSec).toBeGreaterThan(0);
      expect(s.durationSec).toBeLessThanOrEqual(30);
      expect(s.defaultVolume).toBeGreaterThan(0);
      expect(s.defaultVolume).toBeLessThanOrEqual(1);
    }
  });

  it("credit 合规留痕齐全（来源 URL + 授权）", () => {
    for (const s of SFX_LIBRARY) {
      expect(s.credit.sourceUrl).toMatch(/^https:\/\//);
      expect(s.credit.license.length).toBeGreaterThan(0);
    }
  });
});

describe("查找与标签解析", () => {
  it("getSfxById 命中与未命中", () => {
    expect(getSfxById("whoosh-fast")?.category).toBe("whoosh");
    expect(getSfxById("nope-xx")).toBeUndefined();
  });

  it("resolveSfxTag：具体 id 直取，分类 id 取该类第一条，未知 undefined", () => {
    expect(resolveSfxTag("glass-shatter")?.id).toBe("glass-shatter");
    const first = listSfxByCategory("hit")[0];
    expect(resolveSfxTag("hit")?.id).toBe(first.id);
    expect(resolveSfxTag("explosion")).toBeUndefined();
  });

  it("SFX_TAGS 覆盖全部分类 id + 音效 id", () => {
    for (const c of SFX_CATEGORIES) expect(SFX_TAGS).toContain(c.id);
    for (const s of SFX_LIBRARY) expect(SFX_TAGS).toContain(s.id);
  });
});
