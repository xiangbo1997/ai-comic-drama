import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProducerDraftFinalizer,
  createProducerRun,
  advanceProducerRun,
  listProducerRuns,
} from "@/lib/producer-client";
vi.mock("@/lib/assist-client", () => ({ draftAppearance: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
describe("持久向导客户端", () => {
  it("创建重试使用调用者的稳定operationId", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ id: "run1" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      idea: "门外出现另一个自己",
      style: "anime",
      aspectRatio: "9:16" as const,
      durationSec: 90,
      genre: "悬疑",
    };
    await createProducerRun("stable-op", settings);
    await createProducerRun("stable-op", settings);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string).operationId
    ).toBe("stable-op");
    expect(fetchMock.mock.calls[0][1]).toEqual(fetchMock.mock.calls[1][1]);
  });
  it("列表失败不能冒充没有可恢复草稿", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "读取失败" }, { status: 500 }))
    );
    await expect(listProducerRuns()).rejects.toThrow("读取失败");
  });
  it("checkpoint冲突必须暴露给用户，不能继续下一步", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "另一个窗口正在制作" }, { status: 409 })
      )
    );
    await expect(
      advanceProducerRun("run1", { action: "claim", token: "mine" })
    ).rejects.toThrow("另一个窗口");
  });
  it("跨实例收尾使用同一分镜幂等key与服务端合并，不读取旧项目快照", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ id: "run1", status: "completed" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await createProducerDraftFinalizer()("p1", artifact, [], null, {
      runId: "run1",
      token: "mine",
    });
    await createProducerDraftFinalizer()("p1", artifact, [], null, {
      runId: "run1",
      token: "mine",
    });
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string).operationId
    ).toBe("producer-scenes:run1");
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === "/api/projects/p1")
    ).toHaveLength(0);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/producer-runs/run1");
  });
});
