import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  project: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: m.project },
    character: { create: m.create },
    $transaction: m.transaction,
  },
}));
import { POST } from "@/app/api/characters/route";
const request = (body: unknown) =>
  POST(
    new NextRequest("http://local/api/characters", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.project.mockResolvedValue({ id: "p1" });
  m.existing.mockResolvedValue(null);
  m.create.mockResolvedValue({ id: "c1", name: "阿宁" });
  m.link.mockResolvedValue({});
  m.transaction.mockImplementation(async (fn) =>
    fn({
      $executeRaw: m.lock,
      project: { findFirst: m.project },
      character: { findFirst: m.existing, create: m.create },
      projectCharacter: { upsert: m.link },
    })
  );
});
describe("制片人并发建角色", () => {
  it("已有关联或角色库同名时复用并补关联", async () => {
    m.existing.mockResolvedValue({ id: "existing", name: "阿宁" });
    const response = await request({ name: " 阿宁 ", producerProjectId: "p1" });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("existing");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.lock).toHaveBeenCalled();
    expect(m.link).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { projectId: "p1", characterId: "existing" },
      })
    );
  });
  it("新角色和关联一起提交，查询限制当前用户", async () => {
    expect(
      (await request({ name: "阿宁", producerProjectId: "p1" })).status
    ).toBe(201);
    expect(m.existing).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u1" }),
      })
    );
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.link).toHaveBeenCalledTimes(1);
  });
  it("普通建角色仍允许同名，不套制片人查重锁", async () => {
    expect((await request({ name: "阿宁" })).status).toBe(201);
    expect(m.create).toHaveBeenCalled();
    expect(m.lock).not.toHaveBeenCalled();
  });
  it("其他用户项目不能借幂等接口建档", async () => {
    m.project.mockResolvedValue(null);
    expect(
      (await request({ name: "阿宁", producerProjectId: "foreign" })).status
    ).toBe(404);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["", 2, "p".repeat(129)])(
    "拒绝非法制片人项目 %j",
    async (producerProjectId) => {
      expect((await request({ name: "阿宁", producerProjectId })).status).toBe(
        400
      );
      expect(m.create).not.toHaveBeenCalled();
    }
  );
  it("角色关联失败不返回成功", async () => {
    m.link.mockRejectedValue(new Error("link failed"));
    expect(
      (await request({ name: "阿宁", producerProjectId: "p1" })).status
    ).toBe(500);
  });
});
