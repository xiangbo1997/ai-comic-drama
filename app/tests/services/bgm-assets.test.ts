import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { BGM_TRACKS } from "@/lib/bgm-library";
const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/bgm-files.mjs", () => ({ isUsableBgmFile: mocks.check }));
import { getAvailableBgmTracks } from "@/services/bgm-assets";
beforeEach(() => {
  vi.clearAllMocks();
});
describe("可用内置曲库", () => {
  it("仅返回实际存在且有效的固定曲目，不缓存缺失结果", async () => {
    mocks.check.mockImplementation(async (path: string) =>
      path.endsWith(BGM_TRACKS[0].url)
    );
    expect(await getAvailableBgmTracks()).toEqual([BGM_TRACKS[0]]);
    expect(mocks.check.mock.calls.map(([path]) => path)).toEqual(
      BGM_TRACKS.map((track) => join(process.cwd(), "public", track.url))
    );
    mocks.check.mockResolvedValue(true);
    expect(await getAvailableBgmTracks()).toEqual(BGM_TRACKS);
  });
});
