import { join } from "node:path";
import { BGM_TRACKS } from "@/lib/bgm-library";
import { isUsableBgmFile } from "@/lib/bgm-files.mjs";

/** 路径仅来自固定曲库，不能由模型或用户指定；不缓存缺失结果。 */
export async function getAvailableBgmTracks() {
  const available = await Promise.all(
    BGM_TRACKS.map(async (track) =>
      (await isUsableBgmFile(join(process.cwd(), "public", track.url)))
        ? track
        : null
    )
  );
  return available.filter((track) => track !== null);
}
