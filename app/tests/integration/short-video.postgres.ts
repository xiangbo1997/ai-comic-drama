import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const apiMocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: apiMocks.auth }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: async () => ({ success: true }) },
  rateLimitHeaders: () => ({}),
}));
vi.hoisted(() => {
  process.env.LOG_LEVEL = "error";
  process.env.LOCAL_STORAGE_DIR = `/tmp/ai-comic-sv-tests-${process.pid}`;
  process.env.LOCAL_STORAGE_URL_PREFIX = "/uploads";
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_ENDPOINT;
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});
vi.mock("@/services/ai", () => ({
  chatCompletion: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));
vi.mock("@/services/generation/jobs/image", () => ({
  submitImageJob: vi.fn(),
}));
vi.mock("@/services/generation/jobs/video", () => ({
  submitVideoJob: vi.fn(),
}));
import { POST as cleanup } from "@/app/api/admin/cleanup/route";
import { NextRequest } from "next/server";
import { GET, POST, PATCH } from "@/app/api/short-videos/[...path]/route";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { chargeCredits } from "@/lib/credits";
import { chatCompletion, synthesizeSpeech } from "@/services/ai";
import {
  createGenerationJob,
  claimGenerationJob,
} from "@/services/generation/jobs/operation";
import { submitImageJob } from "@/services/generation/jobs/image";
import { submitVideoJob } from "@/services/generation/jobs/video";
import { uploadFileFromPath } from "@/services/storage";
import {
  importSource,
  createVideo,
  listTemplates,
  videoDetail,
  patchVideo,
  json,
  saveTemplate,
  listSources,
  listVideos,
} from "@/services/short-video/store";
import { saveScript } from "@/services/short-video/scripts";
import {
  createRenderPlan,
  createScriptPlan,
} from "@/services/short-video/plans";
import { controlRun, readRun } from "@/services/short-video/runs";
import {
  createAccount,
  disconnectAccount,
} from "@/services/short-video/accounts";
import {
  createPublication,
  controlPublication,
  patchPublication,
  sweepPublications,
  readPublication,
} from "@/services/short-video/publications";
import {
  acceptUpload,
  artifactAccess,
  probeMedia,
} from "@/services/short-video/artifacts";
import { addMetric, listMetrics } from "@/services/short-video/metrics";
import {
  createDiscovery,
  sweepDiscovery,
} from "@/services/short-video/discovery";
import {
  acquireRunLease,
  acquireWorkerLease,
  renewWorker,
  fenced,
} from "@/services/short-video/leases";
import { driveRun, sweepShortVideo } from "@/services/short-video/worker";
import { publicationExport } from "@/services/short-video/export";
import { script } from "../fixtures/short-video";
import type { InternalGenerationOptions } from "@/services/generation/jobs/types";
import type { ShortVideoConnector } from "@/services/short-video/connectors/contracts";
const root = `/tmp/ai-comic-sv-tests-${process.pid}`;
const users: string[] = [];
const providerIds: string[] = [];
let userId: string;
let otherId: string;
let videoId: string;
let templateId: string;
let configs: Record<string, string>;
let videoFile: string;
let imageFile: string;
let audioFile: string;
let acceptedUnknown = false;
const req = () => randomUUID();
const payload = {
  title: "午休会议",
  text: "原创短片",
  hashtags: ["原创"],
  aiGenerated: true,
  commercial: false,
};
async function seedUser() {
  const row = await prisma.user.create({
    data: { email: `${req()}@sv.example.test`, role: "ADMIN", credits: 1000 },
  });
  users.push(row.id);
  return row.id;
}
async function planRender(withTts = false) {
  const v = await videoDetail(userId, videoId);
  const saved = await saveScript(userId, videoId, {
    requestId: req(),
    expectedVideoVersion: v.version,
    content: withTts
      ? { ...script, shots: [{ ...script.shots[0], dialogue: "会议先休息" }] }
      : script,
  });
  return (
    await createRenderPlan(userId, videoId, {
      requestId: req(),
      scriptVersionId: saved.id,
      modelConfigIds: {
        image: configs.IMAGE,
        video: configs.VIDEO,
        ...(withTts ? { tts: configs.TTS } : {}),
      },
      maxCredits: 200,
      ttsEnabled: withTts,
    })
  ).id;
}
async function confirm(id: string) {
  const run = await readRun(userId, id);
  return controlRun(userId, id, {
    requestId: req(),
    action: "confirm",
    expectedVersion: run.version,
    planHash: run.planHash,
  });
}
async function createManual() {
  const artifact = await acceptUpload(
    userId,
    videoId,
    req(),
    videoFile,
    "VIDEO",
    "自制测试色块，具备使用权限"
  );
  const account = await createAccount(userId, {
    requestId: req(),
    platform: "DOUYIN",
    displayName: "隔离测试人工账号",
    mode: "MANUAL",
  });
  return createPublication(userId, {
    requestId: req(),
    videoId,
    accountId: account.id,
    artifactId: artifact.id,
    payload,
    mode: "MANUAL",
  });
}
async function approve(id: string) {
  const p = await readPublication(userId, id);
  return controlPublication(userId, id, {
    requestId: req(),
    action: "approve",
    expectedVersion: p.version,
    approvedHash: p.reviewHash,
  });
}
async function schedule(id: string) {
  const p = await approve(id);
  return controlPublication(userId, id, {
    requestId: req(),
    action: "schedule",
    expectedVersion: p.version,
    approvedHash: p.reviewHash,
    scheduledAt: new Date(Date.now() + 120000).toISOString(),
    timeZone: "Asia/Shanghai",
  });
}
beforeAll(async () => {
  await mkdir(root, { recursive: true });
  imageFile = path.join(root, "input.png");
  videoFile = path.join(root, "input.mp4");
  await sharp({
    create: { width: 160, height: 288, channels: 3, background: "#336699" },
  })
    .png()
    .toFile(imageFile);
  await promisify(execFile)("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x288:r=24:d=1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    videoFile,
  ]);
});
beforeAll(async () => {
  audioFile = path.join(root, "speech.wav");
  await promisify(execFile)("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=1",
    "-ac",
    "2",
    "-acodec",
    "pcm_s16le",
    audioFile,
  ]);
});
beforeEach(async () => {
  vi.clearAllMocks();
  acceptedUnknown = false;
  vi.stubEnv("SHORT_VIDEO_ENABLED", "true");
  vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "true");
  userId = await seedUser();
  apiMocks.auth.mockResolvedValue({ user: { id: userId } });
  otherId = await seedUser();
  configs = {};
  templateId = (await listTemplates(userId)).items[0].id;
  videoId = (
    await createVideo(userId, {
      requestId: req(),
      title: "隔离短视频",
      brief: "原创",
      sourceIds: [],
      templateId,
    })
  ).id;
  for (const category of ["LLM", "IMAGE", "VIDEO", "TTS"] as const) {
    const provider = await prisma.aIProvider.create({
      data: {
        name: "测试模型",
        slug: `sv-test-${req()}`,
        category,
        models: [{ id: "isolated-test-model", name: "测试" }],
        apiProtocol: "openai",
      },
    });
    providerIds.push(provider.id);
    const key = encrypt("isolated-test-key");
    configs[category] = (
      await prisma.userAIConfig.create({
        data: {
          userId,
          providerId: provider.id,
          selectedModel: "isolated-test-model",
          apiKey: key.encrypted,
          apiKeyIv: key.iv,
        },
      })
    ).id;
  }
  const perform = async (
    kind: "IMAGE" | "VIDEO",
    user: string,
    body: Record<string, unknown>,
    options: InternalGenerationOptions = {}
  ) => {
    const task = await createGenerationJob(
      {
        data: {
          type: kind === "IMAGE" ? "IMAGE_GENERATE" : "VIDEO_GENERATE",
          projectId: String(body.projectId),
          sceneId: String(body.sceneId),
          input: json({ userId: user, ...body }),
          cost: options.maxCost,
        },
      },
      user,
      options
    );
    if (
      !(await claimGenerationJob(
        task.id,
        true,
        undefined,
        options.shortVideoParent
      ))
    )
      return { taskId: task.id, cost: task.cost };
    if (acceptedUnknown) return { taskId: task.id, cost: task.cost };
    const stored = await uploadFileFromPath(
      kind === "IMAGE" ? imageFile : videoFile,
      {
        userId: user,
        fileType: kind === "IMAGE" ? "image" : "video",
        fileName: kind === "IMAGE" ? "mock.png" : "mock.mp4",
        contentType: kind === "IMAGE" ? "image/png" : "video/mp4",
      }
    );
    await prisma.$transaction(async (tx) => {
      await tx.scene.update({
        where: { id: String(body.sceneId) },
        data:
          kind === "IMAGE"
            ? { imageUrl: stored.url, imageStatus: "COMPLETED" }
            : { videoUrl: stored.url, videoStatus: "COMPLETED" },
      });
      await tx.generationTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          output:
            kind === "IMAGE"
              ? { imageUrl: stored.url }
              : { videoUrl: stored.url },
          completedAt: new Date(),
        },
      });
      if (task.cost)
        await chargeCredits(tx, {
          userId: user,
          amount: task.cost,
          type: kind === "IMAGE" ? "GENERATE_IMAGE" : "GENERATE_VIDEO",
          source: "isolated-test",
          sourceId: task.id,
        });
    });
    return { taskId: task.id, cost: task.cost };
  };
  vi.mocked(submitImageJob).mockImplementation((user, body, options) =>
    perform("IMAGE", user, body as Record<string, unknown>, options)
  );
  vi.mocked(submitVideoJob).mockImplementation((user, body, options) =>
    perform("VIDEO", user, body as Record<string, unknown>, options)
  );
});
afterEach(async () => {
  await prisma.svRunStep.updateMany({
    where: { userId, status: { not: "COMPLETED" } },
    data: { status: "FAILED" },
  });
  await prisma.svRun.updateMany({
    where: { userId, status: { not: "COMPLETED" } },
    data: { status: "STOPPED", reservedCredits: 0 },
  });
});
afterAll(async () => {
  // 只删除本文件创建的测试用户；先清除可空引用，再按外键依赖清理业务证据。
  await prisma.svVideo.updateMany({
    where: { userId: { in: users } },
    data: { currentArtifactId: null, currentScriptVersionId: null },
  });
  for (const model of [
    prisma.svMetricSnapshot,
    prisma.svPublicationEvent,
    prisma.svPublication,
    prisma.svAccount,
    prisma.svArtifact,
    prisma.svRunStep,
    prisma.svRun,
    prisma.svScriptVersion,
    prisma.svVideoSource,
    prisma.svVideo,
    prisma.svSource,
    prisma.svTemplate,
    prisma.svDiscoveryJob,
    prisma.svRequestReceipt,
  ])
    await (
      model.deleteMany as unknown as (args: {
        where: { userId: { in: string[] } };
      }) => Promise<unknown>
    )({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.aIProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.svWorker.deleteMany();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("short video isolated PostgreSQL", () => {
  it("attaches an owned template to a template-free brief and unlocks an unconfirmed script plan", async () => {
    const draft = await createVideo(userId, {
      requestId: req(),
      title: "AI热点收藏",
      brief: "联网搜索得到的原创点子",
      sourceIds: [],
    });
    expect(draft.template).toBeNull();
    const input = {
      requestId: req(),
      expectedVersion: draft.version,
      templateId,
    };
    const updated = await patchVideo(userId, draft.id, input);
    expect(updated.templateId).toBe(templateId);
    expect(updated.template?.id).toBe(templateId);
    expect(updated.version).toBe(draft.version + 1);
    expect((await patchVideo(userId, draft.id, input)).version).toBe(
      updated.version
    );
    const plan = await createScriptPlan(userId, draft.id, {
      requestId: req(),
      llmConfigId: configs.LLM,
      templateVersion: updated.template!.version,
      expectedVideoVersion: updated.version,
    });
    expect((await readRun(userId, plan.id)).status).toBe("PLANNED");
    expect(chatCompletion).not.toHaveBeenCalled();
  });
  it("guards template changes by ownership, enabled state, video version and active tasks", async () => {
    const before = await videoDetail(userId, videoId);
    const foreign = (await listTemplates(otherId)).items[0];
    await expect(
      patchVideo(userId, videoId, {
        requestId: req(),
        expectedVersion: before.version,
        templateId: foreign.id,
      })
    ).rejects.toMatchObject({ status: 404 });
    await prisma.svTemplate.update({
      where: { id: templateId },
      data: { enabled: false },
    });
    await expect(
      patchVideo(userId, videoId, {
        requestId: req(),
        expectedVersion: before.version,
        templateId,
      })
    ).rejects.toMatchObject({ status: 404 });
    await prisma.svTemplate.update({
      where: { id: templateId },
      data: { enabled: true },
    });
    const cleared = await patchVideo(userId, videoId, {
      requestId: req(),
      expectedVersion: before.version,
      templateId: null,
    });
    expect(cleared.templateId).toBeNull();
    expect(cleared.template).toBeNull();
    await expect(
      patchVideo(userId, videoId, {
        requestId: req(),
        expectedVersion: before.version,
        templateId,
      })
    ).rejects.toMatchObject({ status: 409 });
    const selected = await patchVideo(userId, videoId, {
      requestId: req(),
      expectedVersion: cleared.version,
      templateId,
    });
    const plan = await createScriptPlan(userId, videoId, {
      requestId: req(),
      llmConfigId: configs.LLM,
      templateVersion: selected.template!.version,
      expectedVideoVersion: selected.version,
    });
    await confirm(plan.id);
    await expect(
      patchVideo(userId, videoId, {
        requestId: req(),
        expectedVersion: selected.version,
        templateId: null,
      })
    ).rejects.toMatchObject({ code: "ACTIVE_RUN" });
    expect((await videoDetail(userId, videoId)).templateId).toBe(templateId);
  });
  it("deduplicates concurrent imports and refuses changed requestId input", async () => {
    const input = {
      requestId: req(),
      platform: "DOUYIN",
      url: "https://www.douyin.com/video/123?utm_source=a",
      summary: "原创资料",
    };
    const result = await Promise.all(
      Array.from({ length: 8 }, () => importSource(userId, input))
    );
    expect(new Set(result.map((s) => s.id)).size).toBe(1);
    expect(
      (await importSource(userId, { ...input, requestId: req() })).id
    ).toBe(result[0].id);
    await expect(
      importSource(userId, { ...input, summary: "changed" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      createVideo(otherId, {
        requestId: req(),
        title: "steal",
        brief: "",
        sourceIds: [result[0].id],
      })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("allocates immutable script versions atomically with optimistic concurrency", async () => {
    const v = await videoDetail(userId, videoId);
    const request = {
      requestId: req(),
      expectedVideoVersion: v.version,
      content: script,
    };
    const result = await Promise.all(
      Array.from({ length: 5 }, () => saveScript(userId, videoId, request))
    );
    expect(new Set(result.map((s) => s.id)).size).toBe(1);
    await expect(
      saveScript(userId, videoId, { ...request, requestId: req() })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveScript(otherId, videoId, { ...request, requestId: req() })
    ).rejects.toMatchObject({ status: 404 });
    expect((await videoDetail(userId, videoId)).scripts).toHaveLength(1);
  });
  it("keeps plans unexecuted, requires exact confirmation and blocks two active runs", async () => {
    const runId = await planRender();
    expect(submitImageJob).not.toHaveBeenCalled();
    const run = await readRun(userId, runId);
    await expect(
      controlRun(userId, runId, {
        requestId: req(),
        action: "confirm",
        expectedVersion: run.version,
        planHash: "0".repeat(64),
      })
    ).rejects.toMatchObject({ status: 409 });
    await confirm(runId);
    await expect(
      patchVideo(userId, videoId, {
        requestId: req(),
        expectedVersion: 2,
        title: "changed",
      })
    ).rejects.toMatchObject({ code: "ACTIVE_RUN" });
    await expect(readRun(otherId, runId)).rejects.toMatchObject({
      status: 404,
    });
    const second = await prisma.svRun.findUniqueOrThrow({
      where: { id: runId },
    });
    await expect(
      prisma.svRun.create({
        data: {
          ...second,
          plan: json(second.plan),
          id: req(),
          requestId: req(),
        },
      })
    ).rejects.toThrow();
  });
  it("stale configuration, price or emergency switch prevents new paid submissions", async () => {
    const id = await planRender();
    await prisma.userAIConfig.update({
      where: { id: configs.IMAGE },
      data: { selectedModel: "changed" },
    });
    await expect(confirm(id)).rejects.toMatchObject({ code: "PLAN_STALE" });
    vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "false");
    await expect(confirm(id)).rejects.toMatchObject({
      code: "SUBMISSION_DISABLED",
    });
    expect(submitImageJob).not.toHaveBeenCalled();
  });
  it("fences expired workers and preserves the assistant parent boundary", async () => {
    const id = await planRender();
    await confirm(id);
    const first = (await acquireRunLease(id, "first", "test"))!;
    await prisma.svRun.update({
      where: { id },
      data: { leaseUntil: new Date(0) },
    });
    const second = (await acquireRunLease(id, "second", "test"))!;
    await expect(fenced(first, async () => true)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    expect(await fenced(second, async () => true)).toBe(true);
    const task = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PENDING",
        input: { userId, shortVideoRunId: id },
      },
    });
    expect(
      await claimGenerationJob(task.id, true, undefined, {
        runId: id,
        leaseToken: "first",
      })
    ).toBe(false);
    expect(await claimGenerationJob(task.id, true, id)).toBe(false);
  });
  it("does not create a second paid order after accepted request becomes unknown", async () => {
    const id = await planRender();
    await confirm(id);
    acceptedUnknown = true;
    const lease = (await acquireRunLease(id, "unknown", "test"))!;
    await driveRun(lease);
    const first = await readRun(userId, id);
    expect(first.status).toBe("NEEDS_RECONCILIATION");
    expect(first.reservedCredits).toBeGreaterThan(0);
    await driveRun(lease);
    expect(submitImageJob).toHaveBeenCalledOnce();
    await expect(
      controlRun(userId, id, {
        requestId: req(),
        action: "resume",
        expectedVersion: first.version,
      })
    ).rejects.toMatchObject({ status: 409 });
    await prisma.svRunStep.updateMany({
      where: { runId: id, status: "UNKNOWN" },
      data: { status: "FAILED" },
    });
    await prisma.svRun.update({
      where: { id },
      data: { status: "FAILED", reservedCredits: 0 },
    });
  });
  it("runs mock paid boundaries with real storage and real ffmpeg composition, settles once", async () => {
    const id = await planRender();
    await confirm(id);
    const lease = (await acquireRunLease(id, req(), "test"))!;
    await driveRun(lease);
    const run = await readRun(userId, id);
    expect({
      status: run.status,
      steps: run.steps.map((s) => ({
        kind: s.kind,
        status: s.status,
        errorCode: s.errorCode,
      })),
    }).toMatchObject({ status: "COMPLETED" });
    expect(run.reservedCredits).toBe(0);
    expect(run.spentCredits).toBeGreaterThan(0);
    const ledger = await prisma.creditTransaction.findMany({
      where: { userId },
    });
    expect(ledger).toHaveLength(2);
    expect(-ledger.reduce((n, t) => n + t.delta, 0)).toBe(run.spentCredits);
    expect((await videoDetail(userId, videoId)).currentArtifactId).toBeTruthy();
    await driveRun(lease);
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(2);
  }, 60000);
  it("completes one source-to-publication journey with real composition, receipts, metrics and export SHA", async () => {
    const source = await importSource(userId, {
      requestId: req(),
      platform: "DOUYIN",
      url: "https://www.douyin.com/video/123456789",
      summary: "原创水豚把周会变成午休仪式",
      rightsNote: "只参考主题，不下载或复制原片",
    });
    videoId = (
      await createVideo(userId, {
        requestId: req(),
        title: "从灵感到发布的完整链路",
        brief: "原创水豚午休反转",
        sourceIds: [source.id],
        templateId,
      })
    ).id;
    const id = await planRender(true);
    const planned = await readRun(userId, id);
    expect(planned.status).toBe("PLANNED");
    expect(vi.mocked(submitImageJob)).not.toHaveBeenCalled();
    vi.mocked(synthesizeSpeech).mockResolvedValue(await readFile(audioFile));
    await confirm(id);
    const lease = (await acquireRunLease(id, req(), "journey-test"))!;
    await driveRun(lease);
    const completed = await readRun(userId, id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.reservedCredits).toBe(0);
    expect(completed.steps.map((s) => s.kind)).toEqual([
      "IMAGE",
      "VIDEO",
      "TTS",
      "COMPOSE",
    ]);
    const video = await videoDetail(userId, videoId);
    expect(video.sources.map((s) => s.sourceId)).toEqual([source.id]);
    expect(video.scripts).toHaveLength(1);
    const artifact = await artifactAccess(userId, video.currentArtifactId!);
    expect(artifact.kind).toBe("VIDEO");
    expect(artifact.verifiedAt).toBeTruthy();
    const ledger = await prisma.creditTransaction.findMany({
      where: { userId },
    });
    expect(ledger).toHaveLength(3);
    expect(-ledger.reduce((n, t) => n + t.delta, 0)).toBe(
      completed.spentCredits
    );
    const account = await createAccount(userId, {
      requestId: req(),
      platform: "DOUYIN",
      displayName: "完整链路人工账号",
      mode: "MANUAL",
    });
    const publication = await createPublication(userId, {
      requestId: req(),
      videoId,
      accountId: account.id,
      artifactId: artifact.id,
      payload,
      mode: "MANUAL",
    });
    const scheduled = await schedule(publication.id);
    expect(scheduled.approvedHash).toBe(scheduled.reviewHash);
    // 隔离库推进到排期到点，避免真实等待；不修改生产数据或提交到外部平台。
    await prisma.svPublication.update({
      where: { id: publication.id },
      data: { scheduledAt: new Date() },
    });
    await sweepPublications("journey-test");
    const due = await readPublication(userId, publication.id);
    expect(due.status).toBe("AWAITING_MANUAL");
    const published = await controlPublication(userId, publication.id, {
      requestId: req(),
      expectedVersion: due.version,
      action: "mark_manual_published",
      externalUrl: "https://www.douyin.com/video/987654321",
      publishedAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.events.at(-1)?.detail).toMatchObject({
      verification: "USER_REPORTED",
    });
    await addMetric(userId, publication.id, {
      requestId: req(),
      observedAt: new Date().toISOString(),
      windowLabel: "CUSTOM",
      metrics: { likes: 12 },
    });
    const metric = (await listMetrics(userId, publication.id, {})).items[0];
    expect(metric.likes).toBe(12);
    expect(metric.views).toBeNull();
    const zip = Buffer.from(
      await new Response(
        await publicationExport(userId, publication.id)
      ).arrayBuffer()
    );
    const exportPath = path.join(root, "journey-export.zip");
    await writeFile(exportPath, zip);
    const videoBytes = await promisify(execFile)(
      "unzip",
      ["-p", exportPath, "video.mp4"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
    );
    expect(createHash("sha256").update(videoBytes.stdout).digest("hex")).toBe(
      artifact.sha256
    );
    const manifest = JSON.parse(
      (
        await promisify(execFile)("unzip", [
          "-p",
          exportPath,
          "publication.json",
        ])
      ).stdout
    );
    expect(manifest).toMatchObject({
      publicationId: publication.id,
      sha256: artifact.sha256,
      verification: "MANUAL_PACKAGE",
    });
    await driveRun(lease);
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(3);
    expect(vi.mocked(submitImageJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(submitVideoJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(synthesizeSpeech)).toHaveBeenCalledTimes(1);
  }, 60000);
  it("resumes only local composition after paid submissions are disabled", async () => {
    const id = await planRender();
    await confirm(id);
    const lease = await acquireRunLease(id, req(), "compose-recovery-test");
    expect(lease).not.toBeNull();
    await driveRun(
      lease!,
      () => vi.mocked(submitVideoJob).mock.calls.length > 0
    );
    const generated = await readRun(userId, id);
    expect(
      generated.steps
        .filter((s) => s.kind !== "COMPOSE")
        .every((s) => s.status === "COMPLETED")
    ).toBe(true);
    await prisma.svRun.update({
      where: { id },
      data: { status: "PAUSED", errorCode: "COMPOSE_FAILED" },
    });
    vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "false");
    const paused = await readRun(userId, id);
    await expect(
      controlRun(userId, id, {
        requestId: req(),
        action: "resume",
        expectedVersion: paused.version,
      })
    ).resolves.toMatchObject({ status: "QUEUED" });
    await driveRun(lease!);
    expect(await readRun(userId, id)).toMatchObject({
      status: "COMPLETED",
      reservedCredits: 0,
    });
    expect(vi.mocked(submitImageJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(submitVideoJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(synthesizeSpeech)).not.toHaveBeenCalled();
  });
  it("keeps pending model steps blocked when paid submissions are disabled", async () => {
    const id = await planRender();
    await confirm(id);
    await prisma.svRun.update({ where: { id }, data: { status: "PAUSED" } });
    vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "false");
    const paused = await readRun(userId, id);
    await expect(
      controlRun(userId, id, {
        requestId: req(),
        action: "resume",
        expectedVersion: paused.version,
      })
    ).rejects.toMatchObject({ code: "SUBMISSION_DISABLED" });
    expect(vi.mocked(submitImageJob)).not.toHaveBeenCalled();
    expect(vi.mocked(submitVideoJob)).not.toHaveBeenCalled();
  });
  it("rejects invalid model JSON without creating an executable script or auto repair", async () => {
    const v = await videoDetail(userId, videoId);
    const { id } = await createScriptPlan(userId, videoId, {
      requestId: req(),
      expectedVideoVersion: v.version,
      templateVersion: 1,
      llmConfigId: configs.LLM,
    });
    vi.mocked(chatCompletion).mockResolvedValue("not JSON");
    await confirm(id);
    const lease = (await acquireRunLease(id, req(), "test"))!;
    await driveRun(lease);
    expect((await readRun(userId, id)).status).toBe("FAILED");
    expect(chatCompletion).toHaveBeenCalledOnce();
    expect((await videoDetail(userId, videoId)).scripts).toHaveLength(0);
  });
  it("validates real media and only persists immutable verified uploads", async () => {
    const fake = path.join(root, "fake.mp4");
    await writeFile(fake, "not video");
    await expect(probeMedia(fake, "VIDEO")).rejects.toMatchObject({
      code: "MEDIA_MAGIC",
    });
    const requestId = req();
    const a = await acceptUpload(
      userId,
      videoId,
      requestId,
      videoFile,
      "VIDEO",
      "原创"
    );
    expect(
      (
        await acceptUpload(
          userId,
          videoId,
          requestId,
          videoFile,
          "VIDEO",
          "原创"
        )
      ).id
    ).toBe(a.id);
    expect(a.bytes).toMatch(/^\d+$/);
    expect(a.durationMs).toBe(1000);
    expect((await artifactAccess(userId, a.id)).url).toContain(userId);
    await expect(artifactAccess(otherId, a.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("never accepts a verified cover upload as the publication video", async () => {
    const publication = await createManual();
    const original = await videoDetail(userId, videoId);
    const cover = await acceptUpload(
      userId,
      videoId,
      req(),
      imageFile,
      "COVER",
      "原创封面"
    );
    expect((await videoDetail(userId, videoId)).currentArtifactId).toBe(
      original.currentArtifactId
    );
    await expect(
      createPublication(userId, {
        requestId: req(),
        videoId,
        accountId: publication.accountId,
        artifactId: cover.id,
        payload,
        mode: "MANUAL",
      })
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(
      patchPublication(userId, publication.id, {
        requestId: req(),
        expectedVersion: publication.version,
        artifactId: cover.id,
      })
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
  it("approves hash snapshots, rejects unauthorized edits and expires late schedules", async () => {
    const p = await createManual();
    await expect(
      controlPublication(userId, p.id, {
        requestId: req(),
        action: "schedule",
        expectedVersion: p.version,
        scheduledAt: new Date(Date.now() + 120000).toISOString(),
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      controlPublication(userId, p.id, {
        requestId: req(),
        action: "approve",
        expectedVersion: p.version,
        approvedHash: "0".repeat(64),
      })
    ).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    const scheduled = await schedule(p.id);
    await expect(
      patchPublication(userId, p.id, {
        requestId: req(),
        expectedVersion: scheduled.version,
        payload: { ...payload, title: "changed" },
      })
    ).rejects.toMatchObject({ status: 409 });
    await sweepPublications("test");
    expect((await readPublication(userId, p.id)).status).toBe("SCHEDULED");
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { scheduledAt: new Date(Date.now() - 700000) },
    });
    await sweepPublications("test");
    expect((await readPublication(userId, p.id)).status).toBe("EXPIRED");
  });
  it("supports manual export, truthful publication receipts and null metric snapshots", async () => {
    const p = await createManual();
    await schedule(p.id);
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { scheduledAt: new Date() },
    });
    await sweepPublications("test");
    const due = await readPublication(userId, p.id);
    expect(due.status).toBe("AWAITING_MANUAL");
    const zip = Buffer.from(
      await new Response(await publicationExport(userId, p.id)).arrayBuffer()
    );
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(zip.includes(Buffer.from("caption.txt"))).toBe(true);
    const published = await controlPublication(userId, p.id, {
      requestId: req(),
      action: "mark_manual_published",
      expectedVersion: due.version,
      externalUrl: "https://www.douyin.com/video/123",
      publishedAt: new Date(Date.now() - 10000).toISOString(),
    });
    expect(published.events.at(-1)?.detail).toMatchObject({
      verification: "USER_REPORTED",
    });
    await addMetric(userId, p.id, {
      requestId: req(),
      observedAt: new Date().toISOString(),
      windowLabel: "H24",
      metrics: { likes: 0 },
    });
    const metric = (await listMetrics(userId, p.id, {})).items[0];
    expect(metric.views).toBeNull();
    expect(metric.likes).toBe(0);
  });
  it("cancellation and duplicate publications cannot bypass snapshots", async () => {
    const p = await createManual();
    await expect(
      createPublication(userId, {
        requestId: req(),
        videoId,
        accountId: p.accountId,
        artifactId: p.artifactId,
        payload,
        mode: "MANUAL",
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_PUBLICATION" });
    const scheduled = await schedule(p.id);
    const input = {
      requestId: req(),
      action: "cancel",
      expectedVersion: scheduled.version,
    };
    await Promise.all([
      controlPublication(userId, p.id, input),
      controlPublication(userId, p.id, input),
    ]);
    await sweepPublications("test");
    expect((await readPublication(userId, p.id)).status).toBe("CANCELLED");
    await expect(readPublication(otherId, p.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createPublication(otherId, {
        requestId: req(),
        videoId,
        accountId: p.accountId,
        artifactId: p.artifactId,
        payload,
        mode: "MANUAL",
      })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("blocks real automatic discovery/publishing and disconnected accounts", async () => {
    const job = await createDiscovery(userId, {
      requestId: req(),
      platform: "DOUYIN",
      connectorId: "unverified",
      keywords: ["水豚"],
    });
    expect(job.status).toBe("BLOCKED");
    const p = await createManual();
    await expect(
      createPublication(userId, {
        requestId: req(),
        videoId,
        accountId: p.accountId,
        artifactId: p.artifactId,
        payload,
        mode: "AUTO",
      })
    ).rejects.toMatchObject({ code: "CONNECTOR_BLOCKED" });
    const account = await prisma.svAccount.findUniqueOrThrow({
      where: { id: p.accountId },
    });
    await disconnectAccount(userId, account.id, {
      requestId: req(),
      expectedVersion: account.version,
    });
    await expect(schedule(p.id)).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });
  it("keeps automatic acceptance separate from public success using test-only connector", async () => {
    const p = await createManual();
    await prisma.svAccount.update({
      where: { id: p.accountId },
      data: {
        mode: "OFFICIAL_API",
        status: "CONNECTED",
        connectorId: "test-only",
      },
    });
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { mode: "AUTO" },
    });
    await schedule(p.id);
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { scheduledAt: new Date() },
    });
    const submit = vi.fn(async () => ({
      status: "accepted" as const,
      submissionId: "test-submission",
    }));
    const connector: ShortVideoConnector = {
      capability: {
        platform: "DOUYIN",
        connectorId: "test-only",
        discovery: "UNAVAILABLE",
        publish: "VERIFIED",
        metrics: "UNAVAILABLE",
        mode: "OFFICIAL_API",
        supportsSubmissionLookup: true,
        supportsIdempotencyKey: true,
        verifiedAt: new Date().toISOString(),
        reason: "isolated mock only",
      },
      validate: async () => ({ valid: true, reason: null }),
      submit,
      reconcile: async () => ({
        status: "published",
        postId: "post",
        url: "https://www.douyin.com/video/123",
        publishedAt: new Date().toISOString(),
      }),
    };
    await sweepPublications("test", [connector]);
    expect((await readPublication(userId, p.id)).status).toBe("PROCESSING");
    vi.stubEnv("SHORT_VIDEO_AUTO_SUBMIT_ENABLED", "false");
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { nextCheckAt: new Date(0) },
    });
    await sweepPublications("test", [connector]);
    expect((await readPublication(userId, p.id)).status).toBe("PUBLISHED");
    expect(submit).toHaveBeenCalledOnce();
  });
  it("synthesizes speech with a durable step, atomic ledger and real audio composition", async () => {
    vi.mocked(synthesizeSpeech).mockResolvedValue(await readFile(audioFile));
    const id = await planRender(true);
    await confirm(id);
    const lease = (await acquireRunLease(id, req(), "test"))!;
    await driveRun(lease);
    const run = await readRun(userId, id);
    expect({
      status: run.status,
      steps: run.steps.map((s) => ({
        kind: s.kind,
        status: s.status,
        errorCode: s.errorCode,
      })),
    }).toMatchObject({ status: "COMPLETED" });
    expect(run.reservedCredits).toBe(0);
    expect(run.steps.find((s) => s.kind === "TTS")?.settledAt).toBeTruthy();
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(3);
    await driveRun(lease);
    expect(synthesizeSpeech).toHaveBeenCalledOnce();
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(3);
  }, 60000);
  it("returns a prior plan receipt after its configuration has been disabled", async () => {
    const video = await videoDetail(userId, videoId);
    const input = {
      requestId: req(),
      llmConfigId: configs.LLM,
      templateVersion: 1,
      expectedVideoVersion: video.version,
    };
    const first = await createScriptPlan(userId, videoId, input);
    await prisma.userAIConfig.update({
      where: { id: configs.LLM },
      data: { isEnabled: false },
    });
    expect((await createScriptPlan(userId, videoId, input)).id).toBe(first.id);
    await expect(
      createScriptPlan(userId, videoId, { ...input, templateVersion: 2 })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("finds an operation receipt after task linkage callback fails, without creating a second task", async () => {
    const id = await planRender();
    await confirm(id);
    const lease = (await acquireRunLease(id, req(), "test"))!;
    const run = await readRun(userId, id);
    const step = run.steps[0];
    const data = {
      type: "IMAGE_GENERATE" as const,
      projectId: run.video.projectId!,
      input: { userId },
      cost: step.estimatedCredits,
    };
    const options = {
      operationKey: step.operationKey,
      shortVideoParent: { runId: id, leaseToken: lease.token },
      maxCost: step.estimatedCredits,
    };
    await expect(
      createGenerationJob({ data }, userId, {
        ...options,
        onTaskCreated: async () => {
          throw new Error("simulated DB linkage failure");
        },
      })
    ).rejects.toThrow("linkage");
    const task = await createGenerationJob({ data }, userId, options);
    expect(
      await prisma.generationTask.count({
        where: { input: { path: ["operationKey"], equals: step.operationKey } },
      })
    ).toBe(1);
    expect(task.status).toBe("PENDING");
    expect(submitImageJob).not.toHaveBeenCalled();
  });
  it("cancel and submission race never reports cancellation after acceptance becomes unknown", async () => {
    const p = await createManual();
    await prisma.svAccount.update({
      where: { id: p.accountId },
      data: {
        mode: "OFFICIAL_API",
        status: "CONNECTED",
        connectorId: "test-unknown",
      },
    });
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { mode: "AUTO" },
    });
    await schedule(p.id);
    await prisma.svPublication.update({
      where: { id: p.id },
      data: { scheduledAt: new Date() },
    });
    let resolve!: () => void;
    const entered = new Promise<void>((r) => {
      resolve = r;
    });
    let finish!: () => void;
    const wait = new Promise<void>((r) => {
      finish = r;
    });
    const submit = vi.fn(async () => {
      resolve();
      await wait;
      return { status: "unknown" as const };
    });
    const connector: ShortVideoConnector = {
      capability: {
        platform: "DOUYIN",
        connectorId: "test-unknown",
        discovery: "UNAVAILABLE",
        publish: "VERIFIED",
        metrics: "UNAVAILABLE",
        mode: "OFFICIAL_API",
        supportsSubmissionLookup: false,
        supportsIdempotencyKey: false,
        verifiedAt: new Date().toISOString(),
        reason: "isolated test",
      },
      validate: async () => ({ valid: true, reason: null }),
      submit,
    };
    const sweep = sweepPublications("race", [connector]);
    await entered;
    const row = await readPublication(userId, p.id);
    await expect(
      controlPublication(userId, p.id, {
        requestId: req(),
        action: "cancel",
        expectedVersion: row.version,
      })
    ).rejects.toMatchObject({ status: 409 });
    finish();
    await sweep;
    await sweepPublications("race", [connector]);
    expect((await readPublication(userId, p.id)).status).toBe(
      "NEEDS_RECONCILIATION"
    );
    expect(submit).toHaveBeenCalledOnce();
  });
  it("uses stable cursor pagination and template edits preserve script snapshots", async () => {
    for (let i = 0; i < 4; i++)
      await importSource(userId, {
        requestId: req(),
        platform: "OTHER",
        summary: `原创-${i}`,
      });
    const a = await listSources(userId, { limit: 2 });
    const b = await listSources(userId, { limit: 2, cursor: a.nextCursor });
    expect(a.items).toHaveLength(2);
    expect(b.items).toHaveLength(2);
    expect(new Set([...a.items, ...b.items].map((s) => s.id)).size).toBe(4);
    expect((await listVideos(otherId, {})).items).toHaveLength(0);
    const video = await videoDetail(userId, videoId);
    const saved = await saveScript(userId, videoId, {
      requestId: req(),
      expectedVideoVersion: video.version,
      content: script,
    });
    const current = (await listTemplates(userId)).items.find(
      (t) => t.id === templateId
    )!;
    await saveTemplate(userId, templateId, {
      requestId: req(),
      expectedVersion: current.version,
      name: current.name,
      description: current.description,
      systemInstructions: "新模板指令",
    });
    expect(
      (
        await prisma.svScriptVersion.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).inputSnapshot
    ).toEqual(saved.inputSnapshot);
    await expect(
      saveTemplate(otherId, templateId, {
        requestId: req(),
        expectedVersion: 1,
        name: "x",
        description: "",
        systemInstructions: "x",
      })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("filters title and brief with workflow progress before applying cursor pagination", async () => {
    const draft = await createVideo(userId, {
      requestId: req(),
      title: "Coffee draft",
      brief: "a",
      sourceIds: [],
    });
    const scripted = await createVideo(userId, {
      requestId: req(),
      title: "Scripted",
      brief: "COFFEE idea",
      sourceIds: [],
    });
    await saveScript(userId, scripted.id, {
      requestId: req(),
      expectedVideoVersion: scripted.version,
      content: script,
    });
    const ready = await createVideo(userId, {
      requestId: req(),
      title: "Coffee ready",
      brief: "",
      sourceIds: [],
    });
    await acceptUpload(
      userId,
      ready.id,
      req(),
      videoFile,
      "VIDEO",
      "原创测试素材"
    );
    const corrupt = await createVideo(userId, {
      requestId: req(),
      title: "Coffee cover",
      brief: "",
      sourceIds: [],
    });
    const cover = await acceptUpload(
      userId,
      corrupt.id,
      req(),
      imageFile,
      "COVER",
      "原创封面"
    );
    await prisma.svVideo.update({
      where: { id: corrupt.id },
      data: { currentArtifactId: cover.id },
    });
    const archived = await createVideo(userId, {
      requestId: req(),
      title: "Coffee archived",
      brief: "",
      sourceIds: [],
    });
    await patchVideo(userId, archived.id, {
      requestId: req(),
      expectedVersion: archived.version,
      archived: true,
    });
    const first = await listVideos(userId, { q: " coffee ", limit: 2 });
    const second = await listVideos(userId, {
      q: " coffee ",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(new Set([...first.items, ...second.items].map((v) => v.id))).toEqual(
      new Set([draft.id, scripted.id, ready.id, corrupt.id])
    );
    expect(
      (await listVideos(userId, { q: "coffee", status: "DRAFT" })).items
        .map((v) => v.id)
        .sort()
    ).toEqual([draft.id, corrupt.id].sort());
    expect(
      (await listVideos(userId, { q: "coffee", status: "SCRIPTED" })).items.map(
        (v) => v.id
      )
    ).toEqual([scripted.id]);
    expect(
      (await listVideos(userId, { q: "coffee", status: "READY" })).items.map(
        (v) => v.id
      )
    ).toEqual([ready.id]);
    expect(
      (await listVideos(otherId, { q: "coffee", status: "READY" })).items
    ).toEqual([]);
    await expect(
      listVideos(userId, { status: "unknown" })
    ).rejects.toHaveProperty("name", "ZodError");
    await prisma.svArtifact.update({
      where: { id: (await videoDetail(userId, ready.id)).currentArtifactId! },
      data: { archivedAt: new Date() },
    });
    expect(
      (await listVideos(userId, { q: "coffee", status: "READY" })).items
    ).toEqual([]);
  });
  it("routes authenticated JSON and multipart through real services, rejects cross-user reads", async () => {
    const invoke = async (
      path: string[],
      body?: unknown,
      method = body ? "POST" : "GET"
    ) => {
      const request = new NextRequest(
        `https://sv.example.test/api/short-videos/${path.join("/")}`,
        {
          method,
          headers: {
            Origin: "https://sv.example.test",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      );
      return (method === "GET" ? GET : method === "PATCH" ? PATCH : POST)(
        request,
        { params: Promise.resolve({ path }) }
      );
    };
    expect((await invoke(["capabilities"])).status).toBe(200);
    for (const p of [
      "sources",
      "videos",
      "templates",
      "accounts",
      "publications",
      "models",
      "health",
    ])
      expect((await invoke([p])).status).toBe(200);
    const source = await invoke(["sources", "import"], {
      requestId: req(),
      platform: "DOUYIN",
      summary: "API原创资料",
    });
    expect(source.status).toBe(200);
    const form = new FormData();
    form.set("requestId", req());
    form.set("rightsNote", "测试原创");
    form.set(
      "file",
      new File([await readFile(videoFile)], "original.mp4", {
        type: "video/mp4",
      })
    );
    const uploaded = await POST(
      new NextRequest(
        `https://sv.example.test/api/short-videos/videos/${videoId}/artifacts/upload`,
        {
          method: "POST",
          headers: { Origin: "https://sv.example.test" },
          body: form,
        }
      ),
      {
        params: Promise.resolve({
          path: ["videos", videoId, "artifacts", "upload"],
        }),
      }
    );
    expect(uploaded.status).toBe(201);
    apiMocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await invoke(["videos", videoId])).status).toBe(404);
    apiMocks.auth.mockResolvedValue(null);
    expect((await invoke(["videos"])).status).toBe(401);
  });
  it("validates authorized discovery contracts, saves real source facts and never replays lost searches", async () => {
    const job = await createDiscovery(userId, {
      requestId: req(),
      platform: "DOUYIN",
      connectorId: "test-discovery",
      keywords: ["水豚"],
    });
    await prisma.svDiscoveryJob.update({
      where: { id: job.id },
      data: { status: "PENDING" },
    });
    const search = vi.fn(async () => ({
      items: [
        {
          externalId: "source-123",
          url: "https://www.douyin.com/video/123",
          title: "来源",
          summary: "已授权测试数据",
          observedAt: new Date().toISOString(),
          metrics: { likes: 12, views: null },
        },
      ],
    }));
    const connector: ShortVideoConnector = {
      capability: {
        platform: "DOUYIN",
        connectorId: "test-discovery",
        discovery: "VERIFIED",
        publish: "UNAVAILABLE",
        metrics: "UNAVAILABLE",
        mode: "OFFICIAL_API",
        supportsSubmissionLookup: false,
        supportsIdempotencyKey: false,
        verifiedAt: new Date().toISOString(),
        reason: "isolated mock only",
      },
      search,
    };
    await sweepDiscovery([connector]);
    const done = await prisma.svDiscoveryJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(done.status).toBe("COMPLETED");
    const source = await prisma.svSource.findFirstOrThrow({
      where: { userId, connectorId: "test-discovery" },
    });
    expect(source.metrics).toEqual({ likes: 12, views: null });
    expect(source.ingestionMode).toBe("CONNECTOR");
    await prisma.svDiscoveryJob.update({
      where: { id: job.id },
      data: { status: "RUNNING" },
    });
    await sweepDiscovery([connector]);
    expect(
      (await prisma.svDiscoveryJob.findUniqueOrThrow({ where: { id: job.id } }))
        .errorCode
    ).toBe("SEARCH_UNKNOWN");
    expect(search).toHaveBeenCalledOnce();
  });
  it("allows one global worker and rejects stale heartbeats", async () => {
    const token = await acquireWorkerLease("one");
    expect(token).toBeTruthy();
    expect(await acquireWorkerLease("two")).toBeNull();
    expect(await renewWorker(token!)).toBe(true);
    expect(await renewWorker("old-token")).toBe(false);
    await prisma.svWorker.update({
      where: { id: "global" },
      data: { leaseUntil: new Date(0) },
    });
    const second = await acquireWorkerLease("two");
    expect(second).toBeTruthy();
    expect(await renewWorker(token!)).toBe(false);
    await prisma.svWorker.deleteMany();
  });
  it("legacy cleanup retains short-video receipts and does not recycle unknown jobs", async () => {
    const old = new Date(Date.now() - 40 * 86400000);
    const durable = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "COMPLETED",
        updatedAt: old,
        input: { userId, shortVideoRunId: "durable-sv-run" },
      },
    });
    const unknown = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        updatedAt: old,
        input: { userId, shortVideoRunId: "unknown-sv-run" },
      },
    });
    const ordinary = await prisma.generationTask.create({
      data: {
        type: "IMAGE_GENERATE",
        status: "COMPLETED",
        updatedAt: old,
        input: { userId },
      },
    });
    const response = await cleanup(
      new NextRequest("https://sv.example.test/api/admin/cleanup", {
        method: "POST",
      })
    );
    expect(response.status).toBe(200);
    expect(
      (await prisma.generationTask.findUnique({ where: { id: durable.id } }))
        ?.status
    ).toBe("COMPLETED");
    expect(
      (await prisma.generationTask.findUnique({ where: { id: unknown.id } }))
        ?.status
    ).toBe("PROCESSING");
    expect(
      await prisma.generationTask.findUnique({ where: { id: ordinary.id } })
    ).toBeNull();
    await prisma.generationTask.deleteMany({
      where: { id: { in: [durable.id, unknown.id] } },
    });
  });
  it("worker ignores unconfirmed plans and respects feature gate", async () => {
    await planRender();
    await sweepShortVideo("test");
    expect(submitImageJob).not.toHaveBeenCalled();
    vi.stubEnv("SHORT_VIDEO_ENABLED", "false");
    await sweepShortVideo("test");
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
