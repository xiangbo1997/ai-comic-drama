import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { rateLimiters } from "@/lib/rate-limit";
import { GET, POST } from "@/app/api/producer-runs/route";
import { PATCH } from "@/app/api/producer-runs/[id]/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: vi.fn(async () => ({ success: true })) },
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generationTask: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    project: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    shortDramaScript: { findFirst: vi.fn() },
    projectCharacter: { findMany: vi.fn() },
    scene: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

const settings = {
  idea: "失踪多年的兄长带着陌生合同归来",
  style: "anime",
  aspectRatio: "9:16",
  durationSec: 90,
  genre: "悬疑",
};
const state = () => ({
  version: 1,
  status: "paused",
  completedSteps: ["worldview"],
  worldviewDraft: {
    filmTitle: "归来",
    worldview: "全城的记忆每晚重置",
    protagonist: "调查员",
    genre: "悬疑",
  },
  createdCharNames: [],
  lease: null,
  error: null,
});
const run = () => ({
  id: "run1",
  type: "SCRIPT_PARSE",
  status: "COMPLETED",
  projectId: null,
  input: {
    kind: "producer_checkpoint",
    userId: "owner",
    operationId: "op1",
    settings,
  },
  output: state(),
  createdAt: new Date(),
  updatedAt: new Date(),
});
const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/producer-runs/run1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "run1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    async (fn) => (fn as (tx: unknown) => unknown)(prisma) as never
  );
  vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(run() as never);
  vi.mocked(prisma.generationTask.findMany).mockResolvedValue([run()] as never);
  vi.mocked(prisma.generationTask.update).mockImplementation(
    (arg) => Promise.resolve({ ...run(), ...arg.data }) as never
  );
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "p1",
    generationParams: { subtitleStyle: { fontSize: 36 } },
  } as never);
  vi.mocked(prisma.project.create).mockResolvedValue({ id: "p1" } as never);
  vi.mocked(prisma.projectCharacter.findMany).mockResolvedValue([]);
  vi.mocked(prisma.scene.count).mockResolvedValue(2);
  vi.mocked(prisma.scene.findMany).mockResolvedValue([
    { id: "scene1" },
    { id: "scene2" },
  ] as never);
});

describe("制片人持久 checkpoint", () => {
  it("创建草稿限流不写checkpoint", async () => {
    vi.mocked(rateLimiters.default).mockResolvedValueOnce({
      success: false,
      retryAfter: 20,
    } as never);
    const response = await POST(
      new NextRequest("http://localhost/api/producer-runs", {
        method: "POST",
        body: JSON.stringify({ operationId: "op1", settings }),
      })
    );
    expect(response.status).toBe(429);
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("创建响应丢失后的同key重试取回原run，不创建第二份", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/producer-runs", {
        method: "POST",
        body: JSON.stringify({ operationId: "op1", settings }),
      })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("run1");
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("同key不同输入冲突，不复用别的故事", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/producer-runs", {
        method: "POST",
        body: JSON.stringify({
          operationId: "op1",
          settings: { ...settings, idea: "另一个完全不同的故事" },
        }),
      })
    );
    expect(response.status).toBe(409);
  });
  it("未登录不能列出任何checkpoint", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
    expect(prisma.generationTask.findMany).not.toHaveBeenCalled();
  });
  it("列表只查询当前用户的checkpoint，不误取普通生成任务", async () => {
    await GET();
    expect(prisma.generationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { input: { path: ["kind"], equals: "producer_checkpoint" } },
            { input: { path: ["userId"], equals: "owner" } },
          ]),
        }),
      })
    );
  });
  it("他人run返回404", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(null);
    expect(
      (await patch({ action: "claim", token: "owner-token" })).status
    ).toBe(404);
  });
  it("活跃租约防跨标签页重复推进", async () => {
    const existing = run();
    existing.output.lease = {
      token: "other",
      expiresAt: Date.now() + 60000,
    } as never;
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    expect((await patch({ action: "claim", token: "my-token" })).status).toBe(
      409
    );
    expect(prisma.project.create).not.toHaveBeenCalled();
  });
  it("过期租约可接续，旧持有者不能提交checkpoint", async () => {
    const existing = run();
    existing.output.lease = { token: "expired", expiresAt: 0 } as never;
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    expect((await patch({ action: "project", token: "expired" })).status).toBe(
      409
    );
    expect((await patch({ action: "claim", token: "new-owner" })).status).toBe(
      200
    );
  });
  it("项目创建与checkpoint在同事务，重试不重复创建", async () => {
    const existing = run();
    existing.output.lease = {
      token: "mine",
      expiresAt: Date.now() + 60000,
    } as never;
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    expect((await patch({ action: "project", token: "mine" })).status).toBe(
      200
    );
    expect(prisma.project.create).toHaveBeenCalledTimes(1);
    expect(prisma.generationTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "p1" }),
      })
    );
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue({
      ...existing,
      projectId: "p1",
      output: { ...existing.output, completedSteps: ["worldview", "project"] },
    } as never);
    expect((await patch({ action: "project", token: "mine" })).status).toBe(
      200
    );
    expect(prisma.project.create).toHaveBeenCalledTimes(1);
  });
  it("禁止跳过世界观创建项目", async () => {
    const existing = run();
    existing.output.completedSteps = [];
    existing.output.lease = {
      token: "mine",
      expiresAt: Date.now() + 60000,
    } as never;
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    expect((await patch({ action: "project", token: "mine" })).status).toBe(
      409
    );
  });
  it("脚本checkpoint必须指向当前项目的已存脚本", async () => {
    const existing = {
      ...run(),
      projectId: "p1",
      output: {
        ...state(),
        completedSteps: ["worldview", "project"],
        lease: { token: "mine", expiresAt: Date.now() + 60000 },
      },
    };
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    vi.mocked(prisma.shortDramaScript.findFirst).mockResolvedValue(null);
    expect(
      (
        await patch({
          action: "script",
          token: "mine",
          scriptId: "foreign-script",
        })
      ).status
    ).toBe(409);
    expect(prisma.generationTask.update).not.toHaveBeenCalled();
  });
  it("最终收尾按服务器当前配置合并并保留已有确认", async () => {
    const artifact = {
      filmTitle: "归来",
      scenes: [],
      worldview: "城市每晚重置",
      protagonist: "调查员",
      genre: "悬疑",
      style: "anime",
      aspectRatio: "9:16",
      durationSec: 90,
      logline: "记忆之外的秘密",
    };
    const existing = {
      ...run(),
      projectId: "p1",
      output: {
        ...state(),
        scriptId: "s1",
        artifact,
        completedSteps: ["worldview", "project", "script", "characters"],
        lease: { token: "mine", expiresAt: Date.now() + 60000 },
      },
    };
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(
      existing as never
    );
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1",
      generationParams: {
        subtitleStyle: { fontSize: 36 },
        producerReview: {
          createdByProducer: true,
          confirmed: {
            worldview: true,
            script: false,
            characters: [],
            scenes: [],
          },
        },
      },
    } as never);
    vi.mocked(prisma.generationTask.findFirst)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce({
        output: { sceneIds: ["scene1", "scene2"] },
      } as never);
    expect((await patch({ action: "finalize", token: "mine" })).status).toBe(
      200
    );
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generationParams: expect.objectContaining({
            subtitleStyle: { fontSize: 36 },
            genre: "悬疑",
            producerReview: expect.objectContaining({
              confirmed: expect.objectContaining({ worldview: true }),
            }),
          }),
        }),
      })
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
