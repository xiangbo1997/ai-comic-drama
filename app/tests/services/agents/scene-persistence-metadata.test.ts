import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptArtifact } from "@/services/agents/types";
const db = vi.hoisted(() => ({
  scenes: vi.fn(),
  characters: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scene: {
      findMany: db.scenes,
      update: db.update,
      create: db.create,
      deleteMany: db.remove,
    },
    character: { findMany: db.characters },
    $transaction: db.transaction,
  },
}));
import { saveScenesToProject } from "@/services/agents/workflow/scene-persistence";

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (fn) =>
    fn({
      $executeRaw: vi.fn(),
      scene: {
        findMany: db.scenes,
        update: db.update,
        create: db.create,
        deleteMany: db.remove,
      },
      character: { findMany: db.characters },
    })
  );
});

describe("定稿分镜元数据与已有素材", () => {
  it("更新同一镜头保留媒体和ID，同时持久化高潮、节拍与站位", async () => {
    const row = {
      id: "scene-existing",
      order: 1,
      imageUrl: "/uploads/approved.png",
      videoUrl: "/uploads/take.mp4",
      audioUrl: "/uploads/voice.mp3",
    };
    db.scenes.mockResolvedValue([row]);
    db.characters.mockResolvedValue([{ id: "char-a", name: "阿宁" }]);
    db.update.mockImplementation(async ({ data }) => Object.assign(row, data));
    await saveScenesToProject("project-a", {
      title: "旧宅",
      characters: [],
      scenes: [
        {
          id: 1,
          shotType: "特写",
          description: "门锁被扭开，阿宁退后，握紧衣角。",
          characters: ["阿宁"],
          dialogue: "你到底是谁？",
          narration: null,
          emotion: "fear",
          duration: 4,
          beatType: "reveal",
          isClimax: true,
          screenSide: { 阿宁: "left" },
        },
      ],
    } as ScriptArtifact);
    expect(row).toEqual(
      expect.objectContaining({
        id: "scene-existing",
        imageUrl: "/uploads/approved.png",
        videoUrl: "/uploads/take.mp4",
        audioUrl: "/uploads/voice.mp3",
        beatType: "reveal",
        isClimax: true,
        screenSide: { 阿宁: "left" },
        selectedCharacterId: "char-a",
        selectedCharacterIds: ["char-a"],
      })
    );
    expect(db.create).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });
});
