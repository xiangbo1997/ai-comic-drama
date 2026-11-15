import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  project: vi.fn(),
  updateMany: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: m.project },
    scene: { update: m.update },
    $transaction: m.transaction,
  },
}));
import { PATCH } from "@/app/api/projects/[id]/scenes/[sceneId]/route";
const request = (mediaEdit: unknown) =>
  PATCH(
    new NextRequest("http://local/api/projects/p1/scenes/s1", {
      method: "PATCH",
      body: JSON.stringify({ mediaEdit }),
    }),
    { params: Promise.resolve({ id: "p1", sceneId: "s1" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.project.mockResolvedValue({ id: "p1" });
  m.updateMany.mockResolvedValue({ count: 1 });
  m.find.mockResolvedValue({ id: "s1", imageUrl: null });
  m.transaction.mockImplementation(async (fn) =>
    fn({ scene: { updateMany: m.updateMany, findUnique: m.find } })
  );
});
describe("时间轴素材移除与撤销", () => {
  it("撤销成功恢复地址和完成态，不修改其他轨道", async () => {
    expect(
      (
        await request({
          kind: "audio",
          expectedUrl: null,
          url: "/uploads/voice.mp3",
        })
      ).status
    ).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { audioUrl: "/uploads/voice.mp3", audioStatus: "COMPLETED" },
      })
    );
  });
  it.each(["image", "video", "audio"])(
    "%s 移除只解绑当前素材，按URL和生成状态原子比对",
    async (kind) => {
      expect(
        (await request({ kind, expectedUrl: "/uploads/old.png", url: null }))
          .status
      ).toBe(200);
      expect(m.updateMany).toHaveBeenCalledWith({
        where: {
          id: "s1",
          projectId: "p1",
          [`${kind}Url`]: "/uploads/old.png",
          [`${kind}Status`]: { not: "PROCESSING" },
        },
        data: { [`${kind}Url`]: null, [`${kind}Status`]: "PENDING" },
      });
      expect(m.update).not.toHaveBeenCalled();
    }
  );
  it("撤销也比对当前URL，不覆盖新生成或手动替换的素材", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    const response = await request({
      kind: "audio",
      expectedUrl: null,
      url: "/uploads/voice.mp3",
    });
    expect(response.status).toBe(409);
    expect(m.find).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "bad", expectedUrl: null, url: null },
    { kind: "image", url: null },
    { kind: "image", expectedUrl: null, url: "http://127.0.0.1/private" },
  ])("拒绝非法输入 %j", async (body) => {
    expect((await request(body)).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("未登录/非本人项目不可移除素材", async () => {
    m.auth.mockResolvedValue(null);
    expect(
      (await request({ kind: "image", expectedUrl: null, url: null })).status
    ).toBe(401);
    m.auth.mockResolvedValue({ user: { id: "other" } });
    m.project.mockResolvedValue(null);
    expect(
      (await request({ kind: "image", expectedUrl: null, url: null })).status
    ).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
