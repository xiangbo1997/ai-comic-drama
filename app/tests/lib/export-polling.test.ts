import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExport } from "@/app/(dashboard)/editor/[id]/hooks/use-export";

const runtime = vi.hoisted(() => ({
  state: undefined as unknown,
  ref: { current: null as ReturnType<typeof setTimeout> | null },
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    runtime.state ??= initial;
    return [
      runtime.state,
      (next: unknown) => {
        runtime.state = typeof next === "function" ? next(runtime.state) : next;
      },
    ];
  },
  useRef: () => runtime.ref,
  useEffect: vi.fn(),
}));

const fetchMock = vi.fn();
const response = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
  runtime.state = undefined;
  runtime.ref.current = null;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockReset()
    .mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? response({ taskId: "existing-export", status: "processing" })
        : response({ status: "processing", progress: 50 })
    );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("导出轮询与恢复", () => {
  const options = {
    format: "mp4",
    quality: "1080p",
    includeSubtitles: false,
    includeAudio: false,
  };

  it("同步完成时直接展示下载地址", async () => {
    fetchMock.mockResolvedValue(
      response({ status: "completed", videoUrl: "/uploads/sync.mp4" })
    );
    await useExport("project").handleExport(options);
    expect(useExport("project").exportStatus.videoUrl).toBe(
      "/uploads/sync.mp4"
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("发起失败时展示服务端错误", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "素材不足" }),
    });
    await useExport("project").handleExport(options);
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      error: "素材不足",
    });
  });

  it("后台明确失败后允许重新配置导出", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ taskId: "existing-export", status: "processing" })
      )
      .mockResolvedValue(response({ status: "failed", error: "合成失败" }));
    await useExport("project").handleExport(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      taskId: null,
      error: "合成失败",
    });
    useExport("project").resetExport();
    expect(useExport("project").exportStatus).toMatchObject({
      error: null,
      taskId: null,
      videoUrl: null,
    });
  });

  it("轮询短暂 503 后继续查询并得到视频", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ taskId: "existing-export", status: "processing" })
      )
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue(
        response({ status: "completed", videoUrl: "/uploads/recovered.mp4" })
      );
    await useExport("project").handleExport(options);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useExport("project").exportStatus.videoUrl).toBe(
      "/uploads/recovered.mp4"
    );
  });

  it("连续网络失败保留任务 ID，仍可查询原结果", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ taskId: "existing-export", status: "processing" })
      )
      .mockRejectedValue(new Error("offline"));
    await useExport("project").handleExport(options);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      taskId: "existing-export",
    });
    expect(useExport("project").exportStatus.error).toContain("网络异常");
  });

  it("任务查询 404 时停止重试并显示服务端提示", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ taskId: "existing-export", status: "processing" })
      )
      .mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Task not found" }),
      });
    await useExport("project").handleExport(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(useExport("project").exportStatus.error).toBe("Task not found");
  });

  it("恢复已失败任务时只显示失败原因", async () => {
    fetchMock.mockResolvedValue(
      response({ status: "failed", error: "原任务已中断" })
    );
    await useExport("project").recoverExport();
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      error: "原任务已中断",
    });
  });

  it("停止查询后不会继续定时请求", async () => {
    await useExport("project").handleExport(options);
    await vi.advanceTimersByTimeAsync(0);
    useExport("project").stopExportPoll();
    const count = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it("刷新后从服务器恢复已完成视频，只发 GET", async () => {
    fetchMock.mockResolvedValue(
      response({
        taskId: "previous-export",
        status: "completed",
        videoUrl: "/uploads/previous.mp4",
      })
    );
    await useExport("project").recoverExport();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project/export?latest=1"
    );
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      progress: 100,
      videoUrl: "/uploads/previous.mp4",
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBe(false);
  });

  it("恢复仍在处理的任务时继续查询，直到完成", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          taskId: "previous-export",
          status: "processing",
          progress: 60,
        })
      )
      .mockResolvedValue(
        response({ status: "completed", videoUrl: "/uploads/previous.mp4" })
      );
    await useExport("project").recoverExport();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/project/export?taskId=previous-export"
    );
    expect(useExport("project").exportStatus.videoUrl).toBe(
      "/uploads/previous.mp4"
    );
  });

  it("无历史导出时展示服务端提示", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "暂无导出记录" }),
    });
    await useExport("project").recoverExport();
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      error: "暂无导出记录",
    });
  });
  it("后台处理十三分钟时仍继续查询", async () => {
    await useExport("project").handleExport({
      format: "mp4",
      quality: "1080p",
      includeSubtitles: false,
      includeAudio: false,
    });
    await vi.advanceTimersByTimeAsync(13 * 60_000);
    expect(useExport("project").exportStatus.isExporting).toBe(true);
  });

  it("等待上限后保留原任务，重试查询完成结果而不重复 POST", async () => {
    await useExport("project").handleExport({
      format: "mp4",
      quality: "1080p",
      includeSubtitles: false,
      includeAudio: false,
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 2000);
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      taskId: "existing-export",
      progress: 50,
    });
    fetchMock.mockResolvedValue(
      response({ status: "completed", videoUrl: "/uploads/result.mp4" })
    );
    useExport("project").resetExport();
    await vi.advanceTimersByTimeAsync(0);
    expect(useExport("project").exportStatus).toMatchObject({
      isExporting: false,
      progress: 100,
      error: null,
      videoUrl: "/uploads/result.mp4",
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(1);
  });
});
