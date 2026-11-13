import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  project: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  scenes: vi.fn(),
  rebuild: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: m.project },
    $transaction: m.transaction,
  },
}));
vi.mock("@/services/scene-rebuild", () => ({
  rebuildProjectScenes: m.rebuild,
}));
import { POST } from "@/app/api/projects/[id]/scenes/route";
const scenes = [{ description: "门外响起敲门声", characters: [], duration: 3 }];
const hash = createHash("sha256").update(JSON.stringify(scenes)).digest("hex");
const request = (body: unknown) =>
  POST(
    new NextRequest("http://local/api/projects/p1/scenes", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "p1" }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.project.mockResolvedValue({ id: "p1", generationParams: {} });
  m.find.mockResolvedValue(null);
  m.create.mockResolvedValue({ id: "receipt" });
  m.scenes.mockResolvedValue([{ id: "s1", order: 0 }]);
  m.rebuild.mockResolvedValue([{ id: "s1", order: 0 }]);
  m.transaction.mockImplementation(async (fn) =>
    fn({
      $executeRaw: m.lock,
      generationTask: { findFirst: m.find, create: m.create },
      scene: { findMany: m.scenes },
    })
  );
});
describe("制片人分镜响应丢失重试", () => {
  it("同operationId成功应用后重试返回原分镜，不再重建", async () => {
    m.find.mockResolvedValue({
      input: { inputHash: hash },
      output: { sceneIds: ["s1"] },
    });
    const response = await request({
      scenes,
      operationId: "producer-scenes:run1",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "s1", order: 0 }]);
    expect(m.rebuild).not.toHaveBeenCalled();
    expect(m.lock).toHaveBeenCalled();
  });
  it("首次应用和成功凭证在同一事务提交", async () => {
    const response = await request({
      scenes,
      operationId: "producer-scenes:run1",
    });
    expect(response.status).toBe(201);
    expect(m.rebuild).toHaveBeenCalledTimes(1);
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          projectId: "p1",
          input: expect.objectContaining({
            userId: "u1",
            operationId: "producer-scenes:run1",
            inputHash: hash,
          }),
          output: { sceneIds: ["s1"] },
        }),
      })
    );
  });
  it("相同key输入改变拒绝覆盖", async () => {
    m.find.mockResolvedValue({
      input: { inputHash: "different" },
      output: { sceneIds: ["s1"] },
    });
    expect((await request({ scenes, operationId: "run1" })).status).toBe(409);
    expect(m.rebuild).not.toHaveBeenCalled();
  });
  it("用户已替换分镜后不以旧凭证重建覆盖", async () => {
    m.find.mockResolvedValue({
      input: { inputHash: hash },
      output: { sceneIds: ["deleted"] },
    });
    expect((await request({ scenes, operationId: "run1" })).status).toBe(409);
    expect(m.rebuild).not.toHaveBeenCalled();
  });
  it("无operationId保持手动重新生成行为", async () => {
    expect((await request({ scenes })).status).toBe(201);
    expect(m.rebuild).toHaveBeenCalledTimes(1);
    expect(m.find).not.toHaveBeenCalled();
  });
  it.each(["", "bad/key", 23, "a".repeat(129)])(
    "拒绝非法operationId %j",
    async (operationId) => {
      expect((await request({ scenes, operationId })).status).toBe(400);
      expect(m.rebuild).not.toHaveBeenCalled();
    }
  );
  it("未登录不接触数据库", async () => {
    m.auth.mockResolvedValue(null);
    expect((await request({ scenes, operationId: "run1" })).status).toBe(401);
    expect(m.project).not.toHaveBeenCalled();
  });
  it("不属于用户的项目不得读取历史或写入", async () => {
    m.project.mockResolvedValue(null);
    expect((await request({ scenes, operationId: "run1" })).status).toBe(404);
    expect(m.find).not.toHaveBeenCalled();
    expect(m.rebuild).not.toHaveBeenCalled();
  });
});
