#!/usr/bin/env node
/**
 * 下载内置 BGM 曲库 mp3 到 public/bgm/<category>/。
 *
 * 曲源：FreePD（CC0 公共域，商用免授权、无需署名）经 Internet Archive 镜像。
 * mp3 不入 git（见根 .gitignore），部署环境跑本脚本填充曲库。曲目清单与
 * src/lib/bgm-library.ts 一一对应。
 *
 * 用法（在 app/ 目录下）：node scripts/fetch-bgm.mjs
 * 注意：下载后需重新 `pnpm build`——Next 生产模式只服务 build 时刻的
 *       public 快照，build 后新增到空目录的文件需重 build 才能被服务。
 */
import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isUsableBgmFile } from "../src/lib/bgm-files.mjs";

const BASE = "https://ia801509.us.archive.org/18/items/freepd/";

// [category, archive 源文件名, 落地文件名]——落地名须与 bgm-library.ts 的 url 对齐
export const TRACKS = [
  ["calm", "Page2/Ambient E Singing Bells.mp3", "singing-bells.mp3"],
  ["calm", "Page2/Ambient L Delicate.mp3", "delicate.mp3"],
  ["calm", "Page2/Calm Sketch for Piano.mp3", "calm-piano.mp3"],
  ["tension", "Page2/Action Investigation.mp3", "action-investigation.mp3"],
  ["tension", "Page2/Ambiant Anxiety.mp3", "anxiety.mp3"],
  ["tension", "Page2/Chase Pulse Faster.mp3", "chase-pulse.mp3"],
  ["upbeat", "Page2/80s Smooth Rocker.mp3", "80s-rocker.mp3"],
  ["upbeat", "Page2/Ambient I Tibet Groove.mp3", "tibet-groove.mp3"],
  ["upbeat", "Page2/Cheerleader's Manual.mp3", "cheerleader.mp3"],
  ["suspense", "Page2/Ambiant Obscur Technology.mp3", "obscure-tech.mp3"],
  ["suspense", "Page2/Chill Dark.mp3", "chill-dark.mp3"],
  ["suspense", "Page2/Creepy Setting A.mp3", "creepy-setting.mp3"],
  ["epic", "Page2/120 Monster.mp3", "monster.mp3"],
  ["epic", "Page2/Action Introduction.mp3", "action-intro.mp3"],
  ["epic", "Page2/Ancient Power Of Serpents.mp3", "ancient-power.mp3"],
  ["sad", "Page2/Blue Day Creature.mp3", "blue-day.mp3"],
  ["sad", "Page2/Hollywood Tears.mp3", "hollywood-tears.mp3"],
  [
    "sad",
    "Page2/Monplaisir - Relaxing Ukulele - 01 Red Hair, Blue Sky.mp3",
    "red-hair-blue-sky.mp3",
  ],
  ["romance", "Page2/Alison.mp3", "alison.mp3"],
  ["romance", "Page2/Chill China Love.mp3", "china-love.mp3"],
  [
    "romance",
    "Page2/Monplaisir - Pretty and Invisible - 01 Loved and Respected.mp3",
    "loved-respected.mp3",
  ],
];

export async function fetchBgmTrack(
  track,
  root,
  { checkOnly = false, fetchImpl = fetch, timeoutMs = 90_000 } = {}
) {
  const [cat, src, fn] = track;
  const out = join(root, cat, fn);
  if (await isUsableBgmFile(out)) return "EXISTS";
  if (checkOnly) throw new Error("missing or invalid MP3");
  const url = BASE + encodeURIComponent(src).replace(/%2F/g, "/");
  const temporary = `${out}.${randomUUID()}.tmp`;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    let size = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        callback(
          size > 64 * 1024 * 1024 ? new Error("MP3 exceeds 64 MB") : null,
          chunk
        );
      },
    });
    await mkdir(dirname(out), { recursive: true });
    await pipeline(
      Readable.fromWeb(res.body),
      limit,
      createWriteStream(temporary, { flags: "wx" }),
      { signal }
    );
    if (!(await isUsableBgmFile(temporary)))
      throw new Error("invalid MP3 payload");
    await rename(temporary, out);
    return "OK";
  } finally {
    await rm(temporary, { force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../public/bgm/", import.meta.url));
  let ok = 0;
  const pending = [...TRACKS];
  // 限制并发与单曲超时，部署缺素材时失败退出，不进入构建或重启。
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (;;) {
        const track = pending.shift();
        if (!track) return;
        try {
          const result = await fetchBgmTrack(track, root, {
            checkOnly: process.argv.includes("--check"),
          });
          ok++;
          console.log(`${result} ${track[0]}/${track[2]}`);
        } catch (error) {
          console.error(`FAIL ${track[0]}/${track[2]} ${error.message}`);
        }
      }
    })
  );
  console.log(`DONE ${ok}/${TRACKS.length}`);
  if (ok < TRACKS.length) process.exitCode = 1;
}
