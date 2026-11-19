import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, statfs, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invariant, SvError } from "@/lib/short-video/errors";
import { shortVideoConfig } from "@/lib/short-video/config";
import {
  uploadFileFromPath,
  storageIdentityFromUrl,
  storageAccess,
  copyStorageToPath,
  type StorageIdentity,
} from "@/services/storage";
import {
  userLock,
  ownedVideo,
  assertIdle,
  json,
  receipt,
  dto,
  type Tx,
} from "./store";
const execute = promisify(execFile);
export async function withMediaTemp<T>(
  fn: (dir: string) => Promise<T>,
  minimumFreeBytes = 256 * 1024 * 1024
) {
  const disk = await statfs(tmpdir());
  invariant(
    disk.bavail * disk.bsize >= minimumFreeBytes,
    409,
    "DISK_LOW",
    "临时磁盘空间不足，已暂停；请释放空间后继续"
  );
  const dir = await mkdtemp(path.join(tmpdir(), "ai-comic-sv-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function probeMedia(file: string, kind: string) {
  const bytes = (await stat(file)).size;
  const max =
    kind === "COVER" || kind === "IMAGE"
      ? 10 * 1024 * 1024
      : shortVideoConfig().uploadMaxBytes;
  invariant(
    bytes > 0 && bytes <= max,
    422,
    "MEDIA_SIZE",
    "素材为空或超过大小限制"
  );
  const f = await open(file, "r");
  const header = Buffer.alloc(16);
  try {
    await f.read(header, 0, 16, 0);
  } finally {
    await f.close();
  }
  const mp4 = header.toString("ascii", 4, 8) === "ftyp";
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = header
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP";
  const audio =
    header.toString("ascii", 0, 3) === "ID3" ||
    (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) ||
    (header.toString("ascii", 0, 4) === "RIFF" &&
      header.toString("ascii", 8, 12) === "WAVE") ||
    mp4;
  invariant(
    kind === "VIDEO" ? mp4 : kind === "AUDIO" ? audio : jpeg || png || webp,
    422,
    "MEDIA_MAGIC",
    "素材实际格式不受支持"
  );
  let result: unknown;
  try {
    result = JSON.parse(
      (
        await execute(
          "ffprobe",
          ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
          { timeout: 15000, maxBuffer: 1024 * 1024 }
        )
      ).stdout
    );
  } catch {
    throw new SvError(422, "INVALID_MEDIA", "媒体损坏或无法读取");
  }
  const parsed = z
    .object({
      format: z.object({ duration: z.string().optional() }),
      streams: z.array(
        z.object({
          codec_type: z.string(),
          codec_name: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          duration: z.string().optional(),
        })
      ),
    })
    .parse(result);
  const stream = parsed.streams.find(
    (s) => s.codec_type === (kind === "AUDIO" ? "audio" : "video")
  );
  invariant(stream, 422, "INVALID_MEDIA", "素材缺少有效媒体流");
  if (kind === "VIDEO")
    invariant(
      ["h264", "hevc", "av1", "mpeg4"].includes(stream.codec_name ?? ""),
      422,
      "INVALID_CODEC",
      "视频编码不受支持"
    );
  const durationMs = Math.round(
    Number(parsed.format.duration || stream.duration || 0) * 1000
  );
  if (["VIDEO", "AUDIO"].includes(kind))
    invariant(
      Number.isFinite(durationMs) && durationMs > 0,
      422,
      "INVALID_DURATION",
      "素材时长无效"
    );
  if (kind !== "AUDIO")
    invariant(
      stream.width &&
        stream.height &&
        stream.width <= 8192 &&
        stream.height <= 8192,
      422,
      "INVALID_DIMENSIONS",
      "素材尺寸无效"
    );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {
    bytes: BigInt(bytes),
    sha256: hash.digest("hex"),
    durationMs: durationMs || null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    mimeType:
      kind === "VIDEO"
        ? "video/mp4"
        : kind === "AUDIO"
          ? mp4
            ? "audio/mp4"
            : header.toString("ascii", 8, 12) === "WAVE"
              ? "audio/wav"
              : "audio/mpeg"
          : jpeg
            ? "image/jpeg"
            : png
              ? "image/png"
              : "image/webp",
  };
}
export async function registerArtifact(
  tx: Tx,
  userId: string,
  videoId: string,
  data: Awaited<ReturnType<typeof probeMedia>> &
    StorageIdentity & { kind: string; runId?: string; operationKey?: string },
  current = false
) {
  if (data.operationKey) {
    const old = await tx.svArtifact.findUnique({
      where: { operationKey: data.operationKey },
    });
    if (old) {
      invariant(
        old.userId === userId &&
          old.videoId === videoId &&
          old.runId === (data.runId ?? null),
        409,
        "ARTIFACT_SCOPE",
        "素材凭证不属于当前任务"
      );
      return old;
    }
  }
  const video = await tx.svVideo.update({
    where: { id: videoId },
    data: { artifactCounter: { increment: 1 } },
  });
  const artifact = await tx.svArtifact.create({
    data: {
      ...data,
      userId,
      videoId,
      version: video.artifactCounter,
      verifiedAt: new Date(),
    },
  });
  if (current)
    await tx.svVideo.update({
      where: { id: videoId },
      data: { currentArtifactId: artifact.id, version: { increment: 1 } },
    });
  return artifact;
}
export async function persistArtifact(
  userId: string,
  videoId: string,
  file: string,
  kind: string,
  extra: { runId?: string; operationKey?: string } = {},
  txCallback?: (tx: Tx, artifactId: string) => Promise<void>
) {
  const media = await probeMedia(file, kind);
  const ext = media.mimeType.split("/")[1].replace("jpeg", "jpg");
  const stored = await uploadFileFromPath(file, {
    fileName: `${extra.operationKey?.replace(/[^a-z0-9]/gi, "_") || "upload"}.${ext}`,
    contentType: media.mimeType,
    fileType: kind === "VIDEO" ? "video" : kind === "AUDIO" ? "audio" : "image",
    userId,
  });
  const identity = storageIdentityFromUrl(stored.url);
  return prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    await ownedVideo(userId, videoId, tx);
    const artifact = await registerArtifact(tx, userId, videoId, {
      ...media,
      ...identity,
      kind,
      ...extra,
    });
    await txCallback?.(tx, artifact.id);
    return artifact;
  });
}
export async function ownedArtifact(userId: string, id: string) {
  const row = await prisma.svArtifact.findFirst({
    where: { id, userId, archivedAt: null, verifiedAt: { not: null } },
  });
  invariant(row, 404, "NOT_FOUND", "素材不存在");
  return row;
}
export function artifactIdentity(artifact: {
  storageBackend: string;
  storageKey: string;
}): StorageIdentity {
  invariant(
    artifact.storageBackend === "LOCAL" || artifact.storageBackend === "R2",
    409,
    "STORAGE_UNAVAILABLE",
    "素材存储不可用"
  );
  return {
    storageBackend: artifact.storageBackend,
    storageKey: artifact.storageKey,
  };
}
export async function artifactAccess(userId: string, id: string) {
  const artifact = await ownedArtifact(userId, id);
  try {
    return {
      ...dto(artifact),
      url: await storageAccess(artifactIdentity(artifact)),
      expiresInSec: artifact.storageBackend === "R2" ? 900 : null,
    };
  } catch {
    throw new SvError(409, "ARTIFACT_MISSING", "素材文件不可用，请检查存储");
  }
}
export async function acceptUpload(
  userId: string,
  videoId: string,
  requestId: string,
  file: string,
  kind: string,
  rightsNote: string
) {
  z.uuid().parse(requestId);
  invariant(
    rightsNote.trim().length > 0 && rightsNote.length <= 1000,
    422,
    "RIGHTS_REQUIRED",
    "请确认并说明素材使用权限"
  );
  const media = await probeMedia(file, kind);
  // 内容摘要参与幂等；上传到存储允许留下孤立对象，业务素材与收据始终同事务。
  const ref = await receipt(
    userId,
    `upload:${videoId}`,
    { requestId, hash: media.sha256, kind, rightsNote } as {
      requestId: string;
    },
    async (tx) => {
      await ownedVideo(userId, videoId, tx);
      await assertIdle(tx, videoId);
      const stored = await uploadFileFromPath(file, {
        fileName: `${requestId}.${kind === "VIDEO" ? "mp4" : media.mimeType.split("/")[1]}`,
        contentType: media.mimeType,
        fileType: kind === "VIDEO" ? "video" : "image",
        userId,
      });
      const artifact = await registerArtifact(
        tx,
        userId,
        videoId,
        { ...media, ...storageIdentityFromUrl(stored.url), kind },
        kind === "VIDEO"
      );
      await tx.svArtifact.update({
        where: { id: artifact.id },
        data: { metadata: json({ rightsNote, source: "MANUAL_UPLOAD" }) },
      });
      return { id: artifact.id };
    }
  );
  return dto(await ownedArtifact(userId, ref.id));
}
export async function materializeArtifact(
  userId: string,
  id: string,
  dest: string
) {
  const artifact = await ownedArtifact(userId, id);
  await copyStorageToPath(artifactIdentity(artifact), dest);
  return artifact;
}
