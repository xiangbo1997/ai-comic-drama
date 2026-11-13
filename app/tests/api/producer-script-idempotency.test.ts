import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/projects/[id]/drama-script/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    shortDramaScript: { findFirst: vi.fn() },
    generationTask: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/lib/ai-config", () => ({
  getUserLLMConfig: vi.fn(async () => ({ model: "mock" })),
}));
vi.mock("@/services/drama-script", () => ({
  generateDramaScript: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/services/drama-script-context", () => ({
  derivePreviousEpisodeRecap: vi.fn(async () => undefined),
  readStoredGenre: vi.fn(() => undefined),
}));
vi.mock("@/services/series/chronicler", () => ({ chronicleEpisode: vi.fn() }));

const body = {
  worldview: "失踪的哥哥突然带着一份陌生合同回到家中",
  durationSec: 90,
  reuseProducerTask: true,
};
const post = (data = body) =>
  POST(
    new NextRequest("http://localhost/api/projects/p1/drama-script", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ id: "p1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "p1",
    seriesId: null,
    episodeNumber: null,
  } as never);
  vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.shortDramaScript.findFirst).mockResolvedValue({
    id: "script1",
  } as never);
  vi.mocked(prisma.generationTask.create).mockResolvedValue({
    id: "new-task",
    status: "PROCESSING",
  } as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    async (run) => (run as (tx: unknown) => unknown)(prisma) as never
  );
});

describe("制片人脚本任务幂等", () => {
  it("重复请求复用进行中任务，不再次启动生成", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue({
      id: "running-task",
      status: "PROCESSING",
    } as never);
    expect(await (await post()).json()).toMatchObject({
      taskId: "running-task",
      reused: true,
    });
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it("已完成任务仍可取回，避免轮询网络失败后重生成", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue({
      id: "done-task",
      status: "COMPLETED",
      output: { scriptId: "script1" },
    } as never);
    expect(await (await post()).json()).toMatchObject({
      taskId: "done-task",
      status: "COMPLETED",
      reused: true,
    });
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("完成任务的脚本已删除或不属于当前项目时不得复用过期结果", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue({
      id: "old-task",
      status: "COMPLETED",
      output: { scriptId: "deleted-script" },
    } as never);
    vi.mocked(prisma.shortDramaScript.findFirst).mockResolvedValue(null);
    expect(await (await post()).json()).toMatchObject({ taskId: "new-task" });
    expect(prisma.shortDramaScript.findFirst).toHaveBeenCalledWith({
      where: { id: "deleted-script", projectId: "p1" },
      select: { id: true },
    });
    expect(prisma.generationTask.create).toHaveBeenCalledTimes(1);
  });
  it("查询包含项目、用户、任务类型、输入指纹及可复用状态", async () => {
    await post();
    expect(prisma.generationTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "p1",
          type: "SCRIPT_PARSE",
          status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
          AND: expect.arrayContaining([
            { input: { path: ["kind"], equals: "drama_script" } },
            { input: { path: ["userId"], equals: "owner" } },
            {
              input: {
                path: ["producerRequestHash"],
                equals: expect.stringMatching(/^[a-f0-9]{64}$/),
              },
            },
          ]),
        }),
      })
    );
  });
  it("不同输入产生不同指纹，不能复用另一个故事的任务", async () => {
    await post();
    await post({ ...body, worldview: "失踪的妹妹带着一把血染的钥匙回到家中" });
    const inputs = vi
      .mocked(prisma.generationTask.create)
      .mock.calls.map(
        ([arg]) => arg.data.input as { producerRequestHash: string }
      );
    expect(inputs[0].producerRequestHash).not.toBe(
      inputs[1].producerRequestHash
    );
  });
  it("普通手动生成保持新建任务，不隐式复用旧稿", async () => {
    const { reuseProducerTask: _, ...manual } = body;
    await post(manual as typeof body);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.generationTask.create).toHaveBeenCalledTimes(1);
  });
  it("未登录不得读取或创建任务", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await post()).status).toBe(401);
    expect(prisma.generationTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("他人的项目不得读取或创建任务", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(prisma.generationTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
  it("非法恢复开关拒绝请求，而非默认为新建", async () => {
    expect(
      (await post({ ...body, reuseProducerTask: "true" } as never)).status
    ).toBe(400);
    expect(prisma.generationTask.create).not.toHaveBeenCalled();
  });
});
