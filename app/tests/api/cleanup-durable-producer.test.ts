import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = {
  id: string;
  kind?: string | null;
  status: string;
  updatedAt: Date;
};
const m = vi.hoisted(() => ({
  rows: [] as Row[],
  raw: vi.fn(),
  remove: vi.fn(),
  admin: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin" } })),
}));
vi.mock("@/lib/admin", () => ({ resolveAdmin: m.admin }));
vi.mock("@/lib/admin-audit", () => ({
  writeAuditLog: vi.fn(),
  requestIp: vi.fn(),
}));
vi.mock("@/lib/cleanup/attempt-retention", () => ({
  pruneSceneAttempts: vi.fn(async () => ({
    deletedAttempts: 0,
    deletedFiles: 0,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: m.raw,
    $transaction: m.transaction,
    generationTask: { deleteMany: m.remove, findMany: vi.fn(async () => []) },
    workflowRun: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    order: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));
import { POST } from "@/app/api/admin/cleanup/route";

const old = new Date("2020-01-01");
const run = () =>
  POST(new NextRequest("http://local/api/admin/cleanup", { method: "POST" }));
beforeEach(() => {
  vi.clearAllMocks();
  m.admin.mockResolvedValue({ id: "admin" });
  m.rows = [];
  m.transaction.mockImplementation(async (queries: Promise<unknown>[]) =>
    Promise.all(queries)
  );
  m.remove.mockImplementation(async ({ where }) => {
    const before = m.rows.length;
    m.rows = m.rows.filter(
      (row) =>
        !(
          where.status.in.includes(row.status) &&
          row.updatedAt < where.updatedAt.lt
        )
    );
    return { count: before - m.rows.length };
  });
  m.raw.mockImplementation(
    async (query: TemplateStringsArray, cutoff: Date, ...kinds: string[]) => {
      // SQL快照只验证查询形状；真实PostgreSQL三值语义由独立集成验收覆盖。
      expect(query.join("?")).toContain("COALESCE(input->>'kind', '') NOT IN");
      const before = m.rows.length;
      m.rows = m.rows.filter(
        (row) =>
          !(
            ["COMPLETED", "FAILED"].includes(row.status) &&
            row.updatedAt < cutoff &&
            !kinds.includes(row.kind ?? "")
          )
      );
      return before - m.rows.length;
    }
  );
});

describe("历史清理保留持久制作证据", () => {
  it("旧checkpoint和分镜应用凭证必须保留", async () => {
    m.rows = [
      {
        id: "run",
        kind: "producer_checkpoint",
        status: "COMPLETED",
        updatedAt: old,
      },
      {
        id: "receipt",
        kind: "producer_scene_apply",
        status: "COMPLETED",
        updatedAt: old,
      },
    ];
    const response = await run();
    expect(response.status).toBe(200);
    expect(m.rows.map((row) => row.id)).toEqual(["run", "receipt"]);
    expect((await response.json()).deletedTasks).toBe(0);
  });
  it("普通缺kind、null或其他kind的过期任务继续清理", async () => {
    m.rows = [
      { id: "missing", status: "COMPLETED", updatedAt: old },
      { id: "null", kind: null, status: "FAILED", updatedAt: old },
      {
        id: "normal",
        kind: "drama_script",
        status: "COMPLETED",
        updatedAt: old,
      },
    ];
    const response = await run();
    expect(m.rows).toEqual([]);
    expect((await response.json()).deletedTasks).toBe(3);
    expect(m.raw).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Date),
      "producer_checkpoint",
      "producer_scene_apply"
    );
  });
  it("近期或尚未终结的普通任务不因kind缺省而提前删除", async () => {
    m.rows = [
      { id: "recent", status: "COMPLETED", updatedAt: new Date() },
      { id: "pending", status: "PENDING", updatedAt: old },
    ];
    expect((await run()).status).toBe(200);
    expect(m.rows.map((row) => row.id)).toEqual(["recent", "pending"]);
  });
  it("无管理员授权不触发任何清理", async () => {
    m.admin.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    expect(m.raw).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });
});
