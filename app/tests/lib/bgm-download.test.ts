import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRACKS, fetchBgmTrack } from "../../scripts/fetch-bgm.mjs";
import { BGM_TRACKS } from "@/lib/bgm-library";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "bgm-download-test-"));
  directories.push(path);
  return path;
}
const validMp3 = () => {
  const bytes = Buffer.alloc(60_000);
  bytes.set([0xff, 0xfb, 0x90, 0x64]);
  return bytes;
};
describe("曲库下载", () => {
  it("下载清单与应用曲目URL完全对齐", () => {
    expect(
      TRACKS.map(([category, , name]) => `/bgm/${category}/${name}`).sort()
    ).toEqual(BGM_TRACKS.map((t) => t.url).sort());
  });
  it("原子保存可用音乐，再次执行或仅检查时不联网", async () => {
    const root = await directory();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(validMp3()));
    expect(await fetchBgmTrack(TRACKS[0], root, { fetchImpl })).toBe("OK");
    expect(await readFile(join(root, TRACKS[0][0], TRACKS[0][2]))).toEqual(
      validMp3()
    );
    expect(await fetchBgmTrack(TRACKS[0], root, { fetchImpl })).toBe("EXISTS");
    expect(
      await fetchBgmTrack(TRACKS[0], root, { fetchImpl, checkOnly: true })
    ).toBe("EXISTS");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("仅检查缺失曲目时不下载", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchBgmTrack(TRACKS[0], await directory(), {
        fetchImpl,
        checkOnly: true,
      })
    ).rejects.toThrow(/missing/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("拒绝错误页，不以半成品覆盖已有坏文件，清理临时下载", async () => {
    const root = await directory();
    const target = join(root, TRACKS[0][0]);
    await mkdir(target);
    await writeFile(join(target, TRACKS[0][2]), "previous-invalid");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("<html>".repeat(10_000)));
    await expect(fetchBgmTrack(TRACKS[0], root, { fetchImpl })).rejects.toThrow(
      /invalid/
    );
    expect(await readFile(join(target, TRACKS[0][2]), "utf8")).toBe(
      "previous-invalid"
    );
    expect(await readdir(target)).toEqual([TRACKS[0][2]]);
  });
  it("HTTP失败及超时不能报告下载成功", async () => {
    const root = await directory();
    await expect(
      fetchBgmTrack(TRACKS[0], root, {
        fetchImpl: async () => new Response("bad", { status: 503 }),
      })
    ).rejects.toThrow(/503/);
    const fetchImpl = vi.fn(async (_url, { signal }) => {
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      );
      return new Response(validMp3());
    });
    await expect(
      fetchBgmTrack(TRACKS[0], root, { fetchImpl, timeoutMs: 20 })
    ).rejects.toThrow();
  });
});
