import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@/lib/prisma";
import { configureAssistantBgm } from "@/services/assistant-bgm";
import { resolveAssistantIntent } from "@/lib/assistant-intent";
import { BGM_TRACKS } from "@/lib/bgm-library";
import { createAssistantTools } from "@/services/assistant-tools";
import { runAssistantAgent } from "@/services/assistant-agent";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: mocks.fetch }));
vi.mock("@/lib/observability/langfuse", () => ({
  observeLLM: async (_: unknown, action: () => Promise<unknown>) => action(),
}));

let userId: string, otherId: string, projectId: string;
const intent = resolveAssistantIntent("帮我给本集加背景音乐");
const scope = () => ({ userId, projectId, seriesId: null });
beforeEach(async () => {
  vi.clearAllMocks();
  userId = (
    await prisma.user.create({
      data: { email: `bgm-${randomUUID()}@example.test`, credits: 100 },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: { email: `bgm-other-${randomUUID()}@example.test` },
    })
  ).id;
  projectId = (
    await prisma.project.create({
      data: {
        title: "隔离配乐测试",
        userId,
        generationParams: { resolution: "1080p", unknownKept: true },
      },
    })
  ).id;
  await prisma.scene.create({
    data: { projectId, order: 0, description: "危机逼近", emotion: "fear" },
  });
});
afterEach(async () => {
  await prisma.generationTask.deleteMany({ where: { projectId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});
afterAll(() => prisma.$disconnect());

describe("助手真实数据库配乐链路", () => {
  it("模型工具调用真实保存配乐后立即结束，不生成图/视频或扣积分", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "reply",
          object: "chat.completion",
          created: 1,
          model: "mock",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "bgm",
                    type: "function",
                    function: {
                      name: "configure_bgm",
                      arguments: '{"mode":"auto"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const result = await runAssistantAgent({
      ...scope(),
      requestId: randomUUID(),
      config: {
        protocol: "openai",
        model: "mock",
        apiKey: "test-only",
        baseUrl: "https://mock.example/v1",
      },
      messages: [{ role: "user", content: "帮我给本集加背景音乐" }],
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(result.content).toContain("已保存当前集背景音乐");
    expect(result.content).toContain("需要重新导出");
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(project.generationParams).toMatchObject({
      resolution: "1080p",
      unknownKept: true,
      backgroundMusic: {
        enabled: true,
        trackId: "suspense-obscure-tech",
        ducking: true,
      },
    });
    expect(await prisma.generationTask.count({ where: { projectId } })).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits
    ).toBe(100);
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(0);
  });
  it("并发添加只保存一次，后到请求不能覆盖已有配乐", async () => {
    const results = await Promise.allSettled([
      configureAssistantBgm(scope(), { mode: "auto" }, intent),
      configureAssistantBgm(
        scope(),
        { mode: "track", trackId: BGM_TRACKS[0].id },
        intent
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
  });
  it("配乐与编辑器并发保存沿用同一锁，双方独立字段均保留", async () => {
    await Promise.all([
      configureAssistantBgm(scope(), { mode: "auto" }, intent),
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-scenes:${projectId}`}, 0))`;
        const current = await tx.project.findUniqueOrThrow({
          where: { id: projectId },
        });
        await tx.project.update({
          where: { id: projectId },
          data: {
            generationParams: {
              ...(current.generationParams as Record<string, string | boolean>),
              subtitleTest: "keep-new",
            },
          },
        });
      }),
    ]);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .generationParams
    ).toMatchObject({
      subtitleTest: "keep-new",
      backgroundMusic: { enabled: true },
    });
  });
  it("跨用户和错误系列范围均不能读取/配置他人作品", async () => {
    await expect(
      configureAssistantBgm(
        { ...scope(), userId: otherId },
        { mode: "auto" },
        intent
      )
    ).rejects.toThrow();
    await expect(
      configureAssistantBgm(
        { ...scope(), seriesId: "other-series" },
        { mode: "auto" },
        intent
      )
    ).rejects.toThrow();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .generationParams
    ).not.toHaveProperty("backgroundMusic");
  });
  it("配乐预算追问即使误调制作工具也不会创建视觉任务", async () => {
    const context = {
      ...scope(),
      requestId: randomUUID(),
      intent: resolveAssistantIntent("1000", [
        { role: "user", content: "帮我加BGM" },
      ]),
    };
    const { tools } = createAssistantTools(context);
    await expect(
      tools.plan_production.execute!(
        { maxCredits: 1000, maxRepairRounds: 1, generateVideos: true },
        { toolCallId: "wrong", messages: [] }
      )
    ).rejects.toThrow(/配乐|音乐/);
    expect(await prisma.generationTask.count({ where: { projectId } })).toBe(0);
  });
});
