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
const authMocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: authMocks.auth }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: async () => ({ success: true }) },
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/services/short-video/hot-discovery/sources", async (original) => {
  const actual =
    await original<
      typeof import("@/services/short-video/hot-discovery/sources")
    >();
  return { ...actual, fetchHotBoard: vi.fn() };
});
vi.mock("@/services/ai/web-search", () => ({ searchWebWithModel: vi.fn() }));
vi.mock("@/lib/ai-config", async (original) => ({
  ...(await original<typeof import("@/lib/ai-config")>()),
  getUserLLMConfig: vi.fn(async () => ({
    apiKey: "test-only",
    baseUrl: "https://search.example/v1",
    model: "test-search",
    protocol: "openai",
    extraConfig: { webSearchTransport: "responses" },
  })),
}));
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/short-videos/[...path]/route";
import { prisma } from "@/lib/prisma";
import {
  createHotBrief,
  readHotBrief,
  latestHotBrief,
  saveHotIdea,
  sweepHotBriefs,
  saveAiHotBrief,
} from "@/services/short-video/hot-discovery/store";
import {
  fetchHotBoard,
  parseDouyinBoard,
} from "@/services/short-video/hot-discovery/sources";
import { sweepDiscovery } from "@/services/short-video/discovery";
import { HotReportZ } from "@/lib/short-video/hot-discovery";
import { searchWebWithModel } from "@/services/ai/web-search";
const searchProviders: string[] = [];
async function modelConfig(owner = userId) {
  const provider = await prisma.aIProvider.create({
    data: {
      name: "isolated search",
      slug: `sv-search-${randomUUID()}`,
      category: "LLM",
      models: [{ id: "test-search", name: "test" }],
      baseUrl: "https://search.example/v1",
      apiProtocol: "openai",
    },
  });
  searchProviders.push(provider.id);
  return prisma.userAIConfig.create({
    data: {
      userId: owner,
      providerId: provider.id,
      apiKey: "isolated-encrypted",
      apiKeyIv: "isolated-iv",
      selectedModel: "test-search",
      testStatus: "SUCCESS",
      extraConfig: { webSearchTransport: "responses" },
    },
  });
}
const aiResult = () => ({
  answer: "原创选题：仙尊来渡劫，村口保安让他先登记。",
  responseId: "resp-isolated",
  model: "test-search",
  retrievedAt: new Date().toISOString(),
  toolCalls: 2,
  sources: [
    { title: "第三方热点快照", url: "https://data.example/hot/snapshot" },
  ],
  usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
});
let userId: string;
let otherId: string;
const users: string[] = [];
const input = () => ({
  requestId: randomUUID(),
  query: "有啥最新的梗可以做成抽象视频吗",
  platforms: ["DOUYIN"] as const,
  style: "XIANXIA",
  windowDays: 3,
});
const board = () => {
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  return parseDouyinBoard(
    {
      status_code: 0,
      data: {
        active_time: time,
        word_list: [
          { word: "慌啥子嘛要好好吃饭呀", position: 17, hot_value: 1000 },
        ],
      },
    },
    new Date()
  );
};
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
  vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "false");
  userId = (
    await prisma.user.create({
      data: { email: `${randomUUID()}@hot.test`, role: "ADMIN" },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: { email: `${randomUUID()}@hot.test`, role: "ADMIN" },
    })
  ).id;
  users.push(userId, otherId);
  vi.mocked(fetchHotBoard).mockImplementation(async () => board());
});
afterEach(async () => {
  await prisma.svDiscoveryJob.updateMany({
    where: { userId: { in: users } },
    data: { status: "COMPLETED" },
  });
});
afterAll(async () => {
  await prisma.svVideo.updateMany({
    where: { userId: { in: users } },
    data: { currentScriptVersionId: null, currentArtifactId: null },
  });
  await prisma.svScriptVersion.deleteMany({ where: { userId: { in: users } } });
  await prisma.svVideoSource.deleteMany({ where: { userId: { in: users } } });
  await prisma.svVideo.deleteMany({ where: { userId: { in: users } } });
  await prisma.svSource.deleteMany({ where: { userId: { in: users } } });
  await prisma.svDiscoveryJob.deleteMany({ where: { userId: { in: users } } });
  await prisma.svRequestReceipt.deleteMany({
    where: { userId: { in: users } },
  });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.aIProvider.deleteMany({
    where: { id: { in: searchProviders } },
  });
  await prisma.$disconnect();
  vi.unstubAllEnvs();
});
describe("persistent free hot-topic discovery", () => {
  it("processes at most one model brief per sweep so other worker stages can run", async () => {
    const first = await modelConfig();
    const second = await modelConfig(otherId);
    vi.mocked(searchWebWithModel).mockResolvedValue(aiResult());
    await createHotBrief(userId, { ...input(), searchConfigId: first.id });
    const waiting = await createHotBrief(otherId, {
      ...input(),
      searchConfigId: second.id,
    });
    await sweepHotBriefs();
    expect(searchWebWithModel).toHaveBeenCalledTimes(1);
    expect((await readHotBrief(otherId, waiting.id)).status).toBe("PENDING");
  });
  it("graceful shutdown before model submission leaves a pending job and makes no paid call", async () => {
    const config = await modelConfig();
    const job = await createHotBrief(userId, {
      ...input(),
      searchConfigId: config.id,
    });
    let stopping = false;
    await sweepHotBriefs(
      async () => {
        stopping = true;
        return board();
      },
      () => stopping
    );
    expect((await readHotBrief(userId, job.id)).status).toBe("PENDING");
    expect(searchWebWithModel).not.toHaveBeenCalled();
  });
  it("uses an owned shared search config once, preserves citations/usage and atomically saves an AI brief", async () => {
    const config = await modelConfig();
    vi.mocked(searchWebWithModel).mockResolvedValue(aiResult());
    const request = { ...input(), searchConfigId: config.id };
    const job = await createHotBrief(userId, request);
    await sweepHotBriefs();
    await sweepHotBriefs();
    expect(searchWebWithModel).toHaveBeenCalledTimes(1);
    expect((await readHotBrief(userId, job.id)).report?.ai).toMatchObject({
      responseId: "resp-isolated",
      usage: { totalTokens: 300 },
    });
    expect((await createHotBrief(userId, request)).id).toBe(job.id);
    const save = { requestId: randomUUID(), title: "村口渡劫先登记" };
    const [a, b] = await Promise.all([
      saveAiHotBrief(userId, job.id, save),
      saveAiHotBrief(userId, job.id, save),
    ]);
    expect(a).toEqual(b);
    const video = await prisma.svVideo.findUniqueOrThrow({
      where: { id: a.videoId },
      include: { sources: { include: { source: true } } },
    });
    expect(video.sources[0].source.rawMetadata).toMatchObject({
      evidenceKind: "MODEL_WEB_CITATION",
      model: "test-search",
    });
    expect(video.brief).toContain(aiResult().answer);
    expect(await prisma.svRun.count({ where: { userId } })).toBe(0);
    await expect(
      saveAiHotBrief(otherId, job.id, { ...save, requestId: randomUUID() })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("does not replay an expired model submission or hide possible supplier usage", async () => {
    const config = await modelConfig();
    const request = { ...input(), searchConfigId: config.id };
    const job = await createHotBrief(userId, request);
    await prisma.svDiscoveryJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        leaseToken: "old",
        leaseUntil: new Date(0),
        resultSourceIds: { aiOperation: { status: "SUBMITTING" } },
      },
    });
    await sweepHotBriefs();
    await sweepHotBriefs();
    expect(searchWebWithModel).not.toHaveBeenCalled();
    expect(await readHotBrief(userId, job.id)).toMatchObject({
      status: "FAILED",
      errorCode: "HOT_AI_UNKNOWN",
    });
    expect((await createHotBrief(userId, request)).id).toBe(job.id);
  });
  it("rejects another user's config, untested capability and changed pending configuration", async () => {
    const config = await modelConfig();
    await expect(
      createHotBrief(otherId, { ...input(), searchConfigId: config.id })
    ).rejects.toMatchObject({ code: "SEARCH_CONFIG_UNAVAILABLE" });
    await prisma.userAIConfig.update({
      where: { id: config.id },
      data: { testStatus: null },
    });
    await expect(
      createHotBrief(userId, { ...input(), searchConfigId: config.id })
    ).rejects.toMatchObject({ code: "SEARCH_CONFIG_UNAVAILABLE" });
    await prisma.userAIConfig.update({
      where: { id: config.id },
      data: { testStatus: "SUCCESS" },
    });
    const job = await createHotBrief(userId, {
      ...input(),
      searchConfigId: config.id,
    });
    await prisma.userAIConfig.update({
      where: { id: config.id },
      data: { selectedModel: "changed" },
    });
    await sweepHotBriefs();
    expect((await readHotBrief(userId, job.id)).status).toBe("FAILED");
    expect(searchWebWithModel).not.toHaveBeenCalled();
  });
  it("does not retry failed paid calls and reports possible usage rather than claiming no paid calls", async () => {
    const config = await modelConfig();
    vi.mocked(searchWebWithModel).mockRejectedValue(new Error("timeout"));
    const job = await createHotBrief(userId, {
      ...input(),
      searchConfigId: config.id,
    });
    await sweepHotBriefs();
    await sweepHotBriefs();
    expect(searchWebWithModel).toHaveBeenCalledTimes(1);
    const failed = await readHotBrief(userId, job.id);
    expect(failed.errorSummary).toContain("可能已产生");
    expect(failed.errorSummary).not.toContain("未产生付费");
  });
  it("concurrent request retries create one operation, changed parameters conflict, no model submission", async () => {
    const request = input();
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () => createHotBrief(userId, request))
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    expect(fetchHotBoard).not.toHaveBeenCalled();
    await expect(
      createHotBrief(userId, { ...request, query: "changed" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(readHotBrief(otherId, jobs[0].id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(createHotBrief(userId, input())).rejects.toMatchObject({
      code: "DISCOVERY_ACTIVE",
    });
    await sweepDiscovery();
    expect((await readHotBrief(userId, jobs[0].id)).status).toBe("PENDING");
  });
  it("recovers read-only discovery after lease expiry, persists report and restores latest on refresh", async () => {
    const job = await createHotBrief(userId, input());
    await prisma.svDiscoveryJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", leaseToken: "old", leaseUntil: new Date(0) },
    });
    await Promise.all([sweepHotBriefs(), sweepHotBriefs()]);
    const done = await readHotBrief(userId, job.id);
    expect(done.status).toBe("COMPLETED");
    expect(HotReportZ.safeParse(done.report).success).toBe(true);
    expect(done.report?.ideas).toHaveLength(1);
    expect(fetchHotBoard).toHaveBeenCalledOnce();
    expect((await latestHotBrief(userId)).item?.id).toBe(job.id);
    expect((await latestHotBrief(otherId)).item).toBeNull();
    expect(
      await prisma.generationTask.count({
        where: { input: { path: ["userId"], equals: userId } },
      })
    ).toBe(0);
  });
  it("atomically saves reviewed script and evidence once, never executes models or downloads source video", async () => {
    const job = await createHotBrief(userId, input());
    await sweepHotBriefs();
    const done = await readHotBrief(userId, job.id);
    const idea = done.report!.ideas[0];
    const content = { ...idea.script, title: "用户改过的原创标题" };
    const request = { requestId: randomUUID(), ideaId: idea.id, content };
    const result = await Promise.all([
      saveHotIdea(userId, job.id, request),
      saveHotIdea(userId, job.id, request),
    ]);
    expect(result[0].videoId).toBe(result[1].videoId);
    const video = await prisma.svVideo.findUniqueOrThrow({
      where: { id: result[0].videoId },
      include: { scripts: true, sources: { include: { source: true } } },
    });
    expect(video.title).toBe(content.title);
    expect(video.scripts).toHaveLength(1);
    expect(video.scripts[0].content).toMatchObject({ title: content.title });
    expect(video.sources[0].source.rawMetadata).toMatchObject({
      evidenceKind: "PUBLIC_BOARD",
    });
    expect(video.projectId).toBeNull();
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(0);
    await expect(
      saveHotIdea(otherId, job.id, { ...request, requestId: randomUUID() })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveHotIdea(userId, job.id, {
        ...request,
        content: { ...content, title: "changed" },
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("feature gate prevents worker reads and unavailable platforms remain empty facts", async () => {
    const job = await createHotBrief(userId, input());
    vi.stubEnv("SHORT_VIDEO_ENABLED", "false");
    await sweepHotBriefs();
    expect(fetchHotBoard).not.toHaveBeenCalled();
    vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
    vi.mocked(fetchHotBoard).mockResolvedValue({
      platform: "DOUYIN",
      status: "UNAVAILABLE",
      items: [],
      reason: "限流",
      sourceUrl: null,
      fetchedAt: new Date().toISOString(),
    });
    await sweepHotBriefs();
    const done = await readHotBrief(userId, job.id);
    expect(done.report?.ideas).toHaveLength(0);
    expect(done.report?.recommendation).toBeNull();
  });
  it("routes start/read/save with existing authentication and cross-user protection", async () => {
    authMocks.auth.mockResolvedValue({ user: { id: userId } });
    const call = (path: string[], value?: unknown) => {
      const request = new NextRequest(
        `https://hot.test/api/short-videos/${path.join("/")}`,
        {
          method: value ? "POST" : "GET",
          headers: {
            Origin: "https://hot.test",
            ...(value ? { "Content-Type": "application/json" } : {}),
          },
          ...(value ? { body: JSON.stringify(value) } : {}),
        }
      );
      return (value ? POST : GET)(request, {
        params: Promise.resolve({ path }),
      });
    };
    const created = await call(["hot-briefs"], input());
    expect(created.status).toBe(202);
    const job = await created.json();
    await sweepHotBriefs();
    const read = await call(["hot-briefs", job.id]);
    expect(read.status).toBe(200);
    const done = await read.json();
    expect(done.report.ideas).toHaveLength(1);
    const saved = await call(["hot-briefs", job.id, "save-idea"], {
      requestId: randomUUID(),
      ideaId: done.report.ideas[0].id,
    });
    expect(saved.status).toBe(200);
    authMocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await call(["hot-briefs", job.id])).status).toBe(404);
  });
  it("a late worker token cannot overwrite a newer report", async () => {
    const job = await createHotBrief(userId, input());
    let finish!: (value: ReturnType<typeof board>) => void;
    const wait = new Promise<ReturnType<typeof board>>((r) => {
      finish = r;
    });
    vi.mocked(fetchHotBoard).mockReturnValue(wait);
    const sweep = sweepHotBriefs();
    for (let i = 0; i < 30; i++) {
      const row = await prisma.svDiscoveryJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (row.status === "RUNNING") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await prisma.svDiscoveryJob.update({
      where: { id: job.id },
      data: {
        leaseToken: "new-owner",
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
    finish(board());
    await sweep;
    expect(
      (await prisma.svDiscoveryJob.findUniqueOrThrow({ where: { id: job.id } }))
        .leaseToken
    ).toBe("new-owner");
    expect((await readHotBrief(userId, job.id)).status).toBe("RUNNING");
  });
});
