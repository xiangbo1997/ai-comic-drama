import { open } from "node:fs/promises";

/** 检查体积与真实MPEG帧，避免把下载错误页或仅有ID3的文件当音乐。 */
export async function isUsableBgmFile(path) {
  let file;
  try {
    file = await open(path, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size < 50_000 || info.size > 64 * 1024 * 1024)
      return false;
    const header = Buffer.alloc(10);
    await file.read(header, 0, 10, 0);
    let offset = 0;
    if (header.toString("ascii", 0, 3) === "ID3") {
      if (
        header[3] < 2 ||
        header[3] > 4 ||
        header.subarray(6).some((n) => n > 127)
      )
        return false;
      offset = 10 + header.subarray(6).reduce((size, n) => size * 128 + n, 0);
      if (header[3] === 4 && header[5] & 0x10) offset += 10;
    }
    const sample = Buffer.alloc(4096);
    const { bytesRead } = await file.read(sample, 0, sample.length, offset);
    for (let i = 0; i < bytesRead - 3; i++) {
      const [, flags, rate] = sample.subarray(i, i + 3);
      if (
        sample[i] === 0xff &&
        (flags & 0xe0) === 0xe0 &&
        (flags & 0x18) !== 0x08 &&
        (flags & 6) !== 0 &&
        rate >> 4 > 0 &&
        rate >> 4 < 15 &&
        (rate & 12) !== 12
      )
        return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await file?.close();
  }
}
