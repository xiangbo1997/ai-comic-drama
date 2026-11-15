import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isUsableBgmFile } from "../../src/lib/bgm-files.mjs";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});
async function fixture(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "bgm-file-test-"));
  directories.push(directory);
  const path = join(directory, "track.mp3");
  await writeFile(path, bytes);
  return path;
}
describe("内置配乐文件校验", () => {
  it("接受含MPEG音频帧的文件", async () => {
    const bytes = Buffer.alloc(60_000);
    bytes.set([0xff, 0xfb, 0x90, 0x64]);
    expect(await isUsableBgmFile(await fixture(bytes))).toBe(true);
  });
  it("跳过较大的ID3元数据后检查音频帧", async () => {
    const bytes = Buffer.alloc(60_000);
    bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x46, 0x28]);
    bytes.set([0xff, 0xfb, 0x90, 0x64], 9010);
    expect(await isUsableBgmFile(await fixture(bytes))).toBe(true);
  });
  it("拒绝缺失、目录、截断文件和伪装为mp3的HTML", async () => {
    expect(await isUsableBgmFile("/nonexistent/bgm-test.mp3")).toBe(false);
    expect(await isUsableBgmFile(tmpdir())).toBe(false);
    expect(
      await isUsableBgmFile(
        await fixture(Buffer.from([0xff, 0xfb, 0x90, 0x64]))
      )
    ).toBe(false);
    expect(
      await isUsableBgmFile(await fixture(Buffer.from("<html>".repeat(10_000))))
    ).toBe(false);
  });
  it("拒绝只有ID3标签或非法帧头的文件", async () => {
    for (const header of [
      [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0],
      [0xff, 0xff, 0xff, 0xff],
    ]) {
      const bytes = Buffer.alloc(60_000);
      bytes.set(header);
      expect(await isUsableBgmFile(await fixture(bytes))).toBe(false);
    }
  });
});
