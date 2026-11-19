import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invariant } from "@/lib/short-video/errors";
import { PublicationPayloadZ } from "@/lib/short-video/contracts";
import { ownedPublication } from "./publications";
import { materializeArtifact, probeMedia } from "./artifacts";
export async function publicationExport(userId: string, id: string) {
  const row = await ownedPublication(userId, id);
  invariant(row.mode === "MANUAL", 409, "MANUAL_ONLY", "此入口用于人工发布包");
  const payload = PublicationPayloadZ.parse(row.payload);
  const dir = await mkdtemp(path.join(tmpdir(), "ai-comic-sv-export-"));
  try {
    const video = path.join(dir, "video.mp4");
    const artifact = await materializeArtifact(userId, row.artifactId, video);
    invariant(
      (await probeMedia(video, "VIDEO")).sha256 === artifact.sha256,
      409,
      "MEDIA_CHANGED",
      "存储素材摘要不一致"
    );
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const output = new PassThrough();
    archive.on("error", () => output.destroy(new Error("发布包生成失败")));
    output.on("close", () => {
      archive.abort();
      void rm(dir, { recursive: true, force: true });
    });
    archive.pipe(output);
    archive.file(video, { name: "video.mp4" });
    if (payload.coverArtifactId) {
      const file = path.join(dir, "cover");
      const cover = await materializeArtifact(
        userId,
        payload.coverArtifactId,
        file
      );
      archive.file(file, { name: `cover.${cover.mimeType.split("/")[1]}` });
    }
    archive.append(
      JSON.stringify(
        {
          publicationId: id,
          platform: row.account.platform,
          account: row.account.displayName,
          payload,
          sha256: artifact.sha256,
          scheduledAt: row.scheduledAt,
          displayTimeZone: row.displayTimeZone,
          verification: "MANUAL_PACKAGE",
        },
        null,
        2
      ),
      { name: "publication.json" }
    );
    archive.append(
      `${payload.title}\n\n${payload.text}\n\n${payload.hashtags.map((t) => `#${t}`).join(" ")}\nAI生成声明：${payload.aiGenerated ? "是" : "否"}\n商业内容：${payload.commercial ? "是" : "否"}\n`,
      { name: "caption.txt" }
    );
    archive.append(
      "人工发布任务清单\n1. 核对目标平台和账号、视频、封面、文案及必要声明。\n2. 在平台官方创作入口手动上传并检查预览。\n3. 等待平台审核，确认作品公开后复制真实作品链接与发布时间。\n4. 回到发布中心登记结果（用户回填，不等于平台核验）。\n计划时间为计划提交时间，不保证精确公开时间。此包不含账号凭据。\n",
      { name: "README.txt" }
    );
    void archive
      .finalize()
      .catch(() => output.destroy(new Error("发布包生成失败")));
    return Readable.toWeb(output) as ReadableStream<Uint8Array>;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
