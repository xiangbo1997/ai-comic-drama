import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAndLinkCharacter,
  runDramaScript,
  pollDramaScriptTask,
  createProducerDraftFinalizer,
  createProducerProject,
} from "@/lib/producer-client";
import { draftAppearance } from "@/lib/assist-client";

vi.mock("@/lib/assist-client", () => ({
  draftAppearance: vi.fn(async () => ({})),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("制片人客户端失败恢复", () => {
  it.each([401, 404, 500])("角色查重返回 %s 时不得继续创建", async (status) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "暂时不可用" }), { status })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAndLinkCharacter("p1", "林烬")).rejects.toThrow();
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => (call as unknown[])[1])).toBe(
      false
    );
  });
  it("角色库查重失败时不得当作无角色创建", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ error: "失败" }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAndLinkCharacter("p1", "林烬")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("损坏的查重响应不得当作空列表", async () => {
    const fetchMock = vi.fn(async () => Response.json({ unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAndLinkCharacter("p1", "林烬")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("向导脚本请求显式启用服务端幂等恢复", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ taskId: "task1" }))
      .mockResolvedValueOnce(
        Response.json({
          status: "COMPLETED",
          result: { scriptId: "s1", scenes: [] },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const running = runDramaScript("p1", { worldview: "故事" });
    await vi.runAllTimersAsync();
    expect((await running).scriptId).toBe("s1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      reuseProducerTask: true,
    });
  });
  it("已知后台任务可直接恢复轮询，不重复POST", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "COMPLETED",
        result: { scriptId: "s1", scenes: [] },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = pollDramaScriptTask("existing-task");
    await vi.runAllTimersAsync();
    expect((await result).scriptId).toBe("s1");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/script/parse/existing-task"
    );
  });
  it("最终保存失败必须报错，重试收尾保留已应用的分镜和项目配置", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          generationParams: { genre: "悬疑", subtitleStyle: { fontSize: 36 } },
        })
      )
      .mockResolvedValueOnce(
        Response.json({ error: "保存失败" }, { status: 500 })
      )
      .mockResolvedValueOnce(
        Response.json({
          generationParams: { genre: "悬疑", subtitleStyle: { fontSize: 36 } },
        })
      )
      .mockResolvedValueOnce(Response.json({ id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);
    const finish = createProducerDraftFinalizer();
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await expect(finish("p1", artifact, [], null)).rejects.toThrow("保存失败");
    await finish("p1", artifact, [], null);
    const mutations = fetchMock.mock.calls.filter((args) => args[1]);
    expect(mutations.filter((args) => args[1].method === "POST")).toHaveLength(
      1
    );
    const finalBody = JSON.parse(mutations.at(-1)![1].body);
    expect(finalBody.generationParams).toMatchObject({
      genre: "悬疑",
      subtitleStyle: { fontSize: 36 },
      producerReview: { createdByProducer: true },
    });
  });
  it("收尾请求并发重复点击共用执行，不重复重建分镜", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ generationParams: null }))
      .mockResolvedValueOnce(Response.json({ id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);
    const finish = createProducerDraftFinalizer();
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await Promise.all([
      finish("p1", artifact, [], "悬疑"),
      finish("p1", artifact, [], "悬疑"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("已关联角色直接复用，不重新起草外貌或创建角色", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([{ id: "c1", name: "林烬" }])
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await createAndLinkCharacter("p1", "林烬")).toMatchObject({
      id: "c1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("孤立角色只补关联，关联成功=%s", async (ok) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ id: "c1", name: "林烬" }]))
      .mockResolvedValueOnce(
        Response.json(ok ? { id: "c1" } : { error: "关联失败" }, {
          status: ok ? 201 : 500,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = createAndLinkCharacter("p1", "林烬");
    if (ok) expect(await result).toMatchObject({ id: "c1" });
    else await expect(result).rejects.toThrow("关联失败");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/projects/p1/characters");
  });
  it.each([true, false])(
    "全新角色创建，外貌起草成功=%s",
    async (appearanceOk) => {
      if (!appearanceOk)
        vi.mocked(draftAppearance).mockRejectedValueOnce(
          new Error("模型不可用")
        );
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json([]))
        .mockResolvedValueOnce(Response.json([]))
        .mockResolvedValueOnce(Response.json({ id: "new-char", name: "林烬" }))
        .mockResolvedValueOnce(Response.json({ id: "new-char" }));
      vi.stubGlobal("fetch", fetchMock);
      expect(
        await createAndLinkCharacter("p1", "林烬", {
          gender: "男",
          age: "25",
          description: "调查员",
        })
      ).toMatchObject({ id: "new-char" });
      expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
        name: "林烬",
        gender: "男",
        age: "25",
        description: "调查员",
      });
    }
  );
  it("新建角色失败不继续关联", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ error: "创建失败" }, { status: 500 })
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAndLinkCharacter("p1", "林烬")).rejects.toThrow(
      "创建失败"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([true, false])("项目创建结果明确，成功=%s", async (ok) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(ok ? { id: "p1" } : { error: "项目创建失败" }, {
          status: ok ? 201 : 500,
        })
      )
    );
    const result = createProducerProject({
      title: "测试",
      style: "anime",
      aspectRatio: "9:16",
    });
    if (ok) expect(await result).toEqual({ id: "p1" });
    else await expect(result).rejects.toThrow("项目创建失败");
  });
  it("脚本提交失败明确报错，不开始轮询", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "任务创建失败" }, { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(runDramaScript("p1", { worldview: "故事" })).rejects.toThrow(
      "任务创建失败"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("非法任务编号不能变成任意状态请求路径", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(pollDramaScriptTask("../someone-else")).rejects.toThrow(
      "任务编号无效"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("轮询容忍瞬时5xx并继续读取同一任务", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "PROCESSING" }))
      .mockResolvedValueOnce(
        Response.json({ status: "COMPLETED", result: { scriptId: "s1" } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = pollDramaScriptTask("task1");
    await vi.runAllTimersAsync();
    expect((await result).scriptId).toBe("s1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each(["FAILED", "forbidden"])(
    "轮询终态/权限失败 %s 明确停止",
    async (kind) => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { status: kind, error: "停止轮询" },
            { status: kind === "forbidden" ? 403 : 200 }
          )
        )
      );
      const assertion = expect(pollDramaScriptTask("task1")).rejects.toThrow(
        "停止轮询"
      );
      await vi.runAllTimersAsync();
      await assertion;
    }
  );
  it("收尾读取失败后重试仍保留已应用分镜", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          generationParams: {
            producerReview: {
              createdByProducer: true,
              confirmed: {
                worldview: true,
                script: true,
                characters: ["c1"],
                scenes: ["s1"],
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);
    const finish = createProducerDraftFinalizer();
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await expect(finish("p1", artifact, [], null)).rejects.toThrow(
      "读取项目保存状态失败"
    );
    await finish("p1", artifact, [], null);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      JSON.parse(fetchMock.mock.calls[3][1].body).generationParams
        .producerReview.confirmed.worldview
    ).toBe(true);
  });
  it("分镜创建失败不能标记已应用，重试重新提交", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "分镜失败" }, { status: 500 })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ generationParams: null }))
      .mockResolvedValueOnce(Response.json({ id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);
    const finish = createProducerDraftFinalizer();
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await expect(finish("p1", artifact, [], null)).rejects.toThrow("分镜失败");
    await finish("p1", artifact, [], null);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });
  it("损坏的项目配置不能被收尾静默覆盖", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ generationParams: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const finish = createProducerDraftFinalizer();
    const artifact = {
      scenes: [],
    } as unknown as import("@/types").DramaScriptArtifact;
    await expect(finish("p1", artifact, [], null)).rejects.toThrow(
      "项目生成配置无效"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
