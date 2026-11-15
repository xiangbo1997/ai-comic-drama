import { beforeEach, describe, expect, it, vi } from "vitest";
import { BGM_TRACKS } from "@/lib/bgm-library";
import { resolveAssistantIntent } from "@/lib/assistant-intent";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  available: vi.fn(),
}));
vi.mock("@/services/bgm-assets", () => ({
  getAvailableBgmTracks: mocks.available,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.find },
    $transaction: vi.fn(async (fn) =>
      fn({
        $executeRaw: mocks.lock,
        project: { findFirst: mocks.find, updateMany: mocks.update },
      })
    ),
  },
}));
import {
  configureAssistantBgm,
  readAssistantBgm,
} from "@/services/assistant-bgm";

const scope = { userId: "u", projectId: "p", seriesId: null };
const intent = resolveAssistantIntent("帮我加背景音乐");
const project = (generationParams: object = {}) => ({
  id: "p",
  updatedAt: new Date(1),
  generationParams,
  scenes: [{ emotion: "fear" }, { emotion: "fear" }],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(
    project({ subtitleStyle: { fontSize: 38 }, customFlag: true })
  );
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.available.mockResolvedValue(BGM_TRACKS);
});
describe("助手免费配乐", () => {
  it("曲库缺失时只读明确报告不可用，添加时不伪报成功", async () => {
    mocks.available.mockResolvedValue([]);
    expect(await readAssistantBgm(scope)).toMatchObject({
      tracks: [],
      available: false,
    });
    await expect(
      configureAssistantBgm(scope, { mode: "auto" }, intent)
    ).rejects.toThrow(/曲库|文件|可用/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("自动选曲只选可用文件，指定缺失曲目时不替换为其他曲目", async () => {
    mocks.available.mockResolvedValue([BGM_TRACKS[0]]);
    const result = await configureAssistantBgm(scope, { mode: "auto" }, intent);
    expect(result.backgroundMusic.trackId).toBe(BGM_TRACKS[0].id);
    await expect(
      configureAssistantBgm(
        scope,
        { mode: "track", trackId: BGM_TRACKS[1].id },
        intent
      )
    ).rejects.toThrow(/文件|可用/);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("不能恢复文件已缺失的内置配乐，但可以关闭并保留设置", async () => {
    mocks.available.mockResolvedValue([]);
    mocks.find.mockResolvedValue(
      project({
        backgroundMusic: {
          enabled: false,
          url: BGM_TRACKS[0].url,
          trackId: BGM_TRACKS[0].id,
        },
      })
    );
    await expect(
      configureAssistantBgm(
        scope,
        { mode: "on" },
        resolveAssistantIntent("打开配乐")
      )
    ).rejects.toThrow(/文件|可用/);
    await configureAssistantBgm(
      scope,
      { mode: "off" },
      resolveAssistantIntent("关闭配乐")
    );
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("按分镜情绪选真实曲库音乐，保存预览/导出共用配置并保留其他设置", async () => {
    const result = await configureAssistantBgm(scope, { mode: "auto" }, intent);
    expect(result).toMatchObject({ success: true, cost: 0, needsExport: true });
    const { where, data } = mocks.update.mock.calls[0][0];
    expect(where).toMatchObject({
      id: "p",
      userId: "u",
      seriesId: null,
      updatedAt: new Date(1),
    });
    expect(data.generationParams).toMatchObject({
      subtitleStyle: { fontSize: 38 },
      customFlag: true,
      autoBgmSegments: false,
      backgroundMusic: {
        enabled: true,
        ducking: true,
        loop: true,
        volume: 0.25,
      },
    });
    const chosen = BGM_TRACKS.find(
      (t) => t.id === data.generationParams.backgroundMusic.trackId
    );
    expect(chosen?.category).toBe("suspense");
    expect(chosen?.url).toBe(data.generationParams.backgroundMusic.url);
  });
  it("不接受模型传入任意URL、作品ID或非法数值", async () => {
    for (const value of [
      { mode: "track", trackId: "unknown" },
      { mode: "auto", url: "file:///etc/passwd" },
      { mode: "auto", projectId: "other" },
      { mode: "auto", volume: 2 },
      { mode: "auto", autoSegments: true },
    ])
      await expect(
        configureAssistantBgm(scope, value, intent)
      ).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("未授权咨询和系列总览不写入", async () => {
    await expect(
      configureAssistantBgm(
        scope,
        { mode: "auto" },
        resolveAssistantIntent("BGM怎么添加")
      )
    ).rejects.toThrow();
    await expect(
      configureAssistantBgm(
        { ...scope, projectId: undefined },
        { mode: "auto" },
        intent
      )
    ).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("已有手动配乐不被普通添加覆盖，明确换曲才允许替换", async () => {
    mocks.find.mockResolvedValue(
      project({
        backgroundMusic: {
          enabled: true,
          url: "/uploads/manual.mp3",
          volume: 0.4,
        },
      })
    );
    await expect(
      configureAssistantBgm(scope, { mode: "auto" }, intent)
    ).rejects.toThrow(/已有|替换/);
    expect(mocks.update).not.toHaveBeenCalled();
    await configureAssistantBgm(
      scope,
      { mode: "track", trackId: BGM_TRACKS[0].id },
      resolveAssistantIntent("换一首BGM")
    );
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("调整只修改音量/闪避，保留手动音乐URL和分段设置", async () => {
    mocks.find.mockResolvedValue(
      project({
        autoBgmSegments: true,
        backgroundMusic: {
          enabled: true,
          url: "/uploads/manual.mp3",
          volume: 0.4,
          ducking: false,
        },
      })
    );
    await configureAssistantBgm(
      scope,
      { mode: "adjust", volume: 0.15, ducking: true },
      resolveAssistantIntent("把BGM音量调小并打开对白闪避")
    );
    expect(mocks.update.mock.calls[0][0].data.generationParams).toMatchObject({
      autoBgmSegments: true,
      backgroundMusic: {
        url: "/uploads/manual.mp3",
        volume: 0.15,
        ducking: true,
      },
    });
  });
  it("关闭需明确请求，关闭后保留原配乐便于恢复", async () => {
    mocks.find.mockResolvedValue(
      project({
        backgroundMusic: { enabled: true, url: "/uploads/manual.mp3" },
      })
    );
    await expect(
      configureAssistantBgm(scope, { mode: "off" }, intent)
    ).rejects.toThrow();
    await configureAssistantBgm(
      scope,
      { mode: "off" },
      resolveAssistantIntent("关闭背景音乐")
    );
    expect(
      mocks.update.mock.calls[0][0].data.generationParams.backgroundMusic
    ).toMatchObject({ enabled: false, url: "/uploads/manual.mp3" });
  });
  it("恢复已关闭的用户音乐，无需重选或覆盖原曲", async () => {
    mocks.find.mockResolvedValue(
      project({
        backgroundMusic: { enabled: false, url: "/uploads/manual.mp3" },
      })
    );
    await expect(
      configureAssistantBgm(scope, { mode: "auto" }, intent)
    ).rejects.toThrow(/已有|替换/);
    await configureAssistantBgm(
      scope,
      { mode: "on" },
      resolveAssistantIntent("打开背景音乐")
    );
    expect(
      mocks.update.mock.calls[0][0].data.generationParams.backgroundMusic
    ).toMatchObject({ enabled: true, url: "/uploads/manual.mp3" });
  });
  it("请求取消后不提交数据库写入", async () => {
    await expect(
      configureAssistantBgm(
        scope,
        { mode: "auto" },
        intent,
        AbortSignal.abort()
      )
    ).rejects.toThrow();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("归属变化/并发写入失败不能报告保存成功", async () => {
    mocks.find.mockResolvedValueOnce(null);
    await expect(readAssistantBgm(scope)).rejects.toThrow();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(
      configureAssistantBgm(scope, { mode: "auto" }, intent)
    ).rejects.toThrow(/更新|变化|重试/);
  });
  it("只读曲库和现有配置不写入", async () => {
    expect(await readAssistantBgm(scope)).toMatchObject({
      tracks: BGM_TRACKS,
      cost: 0,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.find.mock.calls[0][0].where).toEqual({
      id: "p",
      userId: "u",
      seriesId: null,
    });
  });
});
