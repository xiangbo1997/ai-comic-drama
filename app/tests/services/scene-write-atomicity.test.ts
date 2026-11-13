import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptArtifact } from "@/services/agents/types";

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  failOn: "",
  locked: vi.fn(),
  transaction: vi.fn(),
  params: {} as Record<string, unknown>,
  projectUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scene: {
      findMany: vi.fn(() => {
        throw new Error("outside transaction");
      }),
    },
    character: {
      findMany: vi.fn(() => {
        throw new Error("outside transaction");
      }),
    },
    $transaction: db.transaction,
  },
}));
import { saveScenesToProject } from "@/services/agents/workflow/scene-persistence";
import { rebuildProjectScenes } from "@/services/scene-rebuild";

beforeEach(() => {
  vi.clearAllMocks();
  db.failOn = "";
  db.params = {};
  db.rows = [
    { id: "s1", order: 1, description: "旧版本1", imageUrl: "/one.png" },
    { id: "s2", order: 2, description: "旧版本2", imageUrl: "/two.png" },
  ];
  db.transaction.mockImplementation(async (fn) => {
    const original = structuredClone(db.rows);
    try {
      return await fn({
        $executeRaw: db.locked,
        project: {
          findUnique: vi.fn(async () => ({ generationParams: db.params })),
          update: db.projectUpdate,
        },
        character: { findMany: vi.fn(async () => []) },
        scene: {
          findMany: vi.fn(async () => db.rows),
          update: vi.fn(async ({ where, data }) => {
            if (where.id === db.failOn) throw new Error("write interrupted");
            const row = db.rows.find((row) => row.id === where.id)!;
            Object.assign(row, data);
            return row;
          }),
          create: vi.fn(async ({ data }) => {
            const row = { id: "new", ...data };
            db.rows.push(row);
            return row;
          }),
          createMany: vi.fn(async ({ data }) => {
            if (db.failOn === "createMany")
              throw new Error("write interrupted");
            db.rows = data.map((row: object, i: number) => ({
              ...row,
              id: `new-${i}`,
            }));
          }),
          deleteMany: vi.fn(async () => {
            db.rows = [];
          }),
        },
      });
    } catch (error) {
      db.rows = original;
      throw error;
    }
  });
});

const script = {
  title: "旧宅",
  characters: [],
  scenes: [1, 2].map((id) => ({
    id,
    shotType: "近景",
    description: `新版本${id}的镜头描述`,
    dialogue: null,
    narration: null,
    emotion: "neutral",
    characters: [],
    duration: 3,
  })),
} as ScriptArtifact;

describe("整批分镜事务", () => {
  it("定稿中间一镜失败，前面已更新的正文也必须回滚", async () => {
    db.failOn = "s2";
    await expect(saveScenesToProject("p1", script)).rejects.toThrow(
      "write interrupted"
    );
    expect(db.rows.map((row) => row.description)).toEqual([
      "旧版本1",
      "旧版本2",
    ]);
    expect(db.locked).toHaveBeenCalled();
  });
  it("成功更新整批定稿保留原ID与素材", async () => {
    await saveScenesToProject("p1", script);
    expect(
      db.rows.map((row) => [row.id, row.description, row.imageUrl])
    ).toEqual([
      ["s1", "新版本1的镜头描述", "/one.png"],
      ["s2", "新版本2的镜头描述", "/two.png"],
    ]);
  });
  it("手动零起始镜序进入工作流时按实际镜序保留素材，不错移或删除首镜", async () => {
    db.rows[0].order = 0;
    db.rows[1].order = 1;
    await saveScenesToProject("p1", script);
    expect(
      db.rows.map((row) => [row.id, row.order, row.description, row.imageUrl])
    ).toEqual([
      ["s1", 1, "新版本1的镜头描述", "/one.png"],
      ["s2", 2, "新版本2的镜头描述", "/two.png"],
    ]);
  });
  it("重建新镜失败会保留旧分镜，读取也处于同一事务锁内", async () => {
    db.failOn = "createMany";
    await expect(
      rebuildProjectScenes("p1", { generationParams: {} }, script.scenes)
    ).rejects.toThrow("write interrupted");
    expect(db.rows.map((row) => row.id)).toEqual(["s1", "s2"]);
    expect(db.locked).toHaveBeenCalled();
  });
  it("重建同样镜数也要把锁内最新配置桥接到新ID，不能仅长度变化才保存", async () => {
    db.rows = [
      { id: "s1", order: 0 },
      { id: "s2", order: 1 },
    ];
    db.params = {
      subtitlePositions: [{ sceneId: "s1", position: "top" }],
      emphasis: ["s2"],
      genre: "suspense",
    };
    await rebuildProjectScenes(
      "p1",
      { generationParams: { genre: "outdated" } },
      script.scenes
    );
    expect(db.projectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          generationParams: expect.objectContaining({
            subtitlePositions: [{ sceneId: "new-0", position: "top" }],
            emphasis: ["new-1"],
            genre: "suspense",
          }),
        },
      })
    );
  });
});
