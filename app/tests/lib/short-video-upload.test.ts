import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, vi } from "vitest";
import { streamMediaUpload } from "@/lib/short-video/upload";
let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function multipart(text: string, chunk = 1) {
  const data = Buffer.from(text);
  let offset = 0;
  return new Request("https://example.test/upload", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=sv-test" },
    body: new ReadableStream({
      pull(controller) {
        if (offset === data.length) return controller.close();
        controller.enqueue(data.subarray(offset, offset + chunk));
        offset = Math.min(data.length, offset + chunk);
      },
    }),
    duplex: "half",
  } as RequestInit);
}
describe("streamed bounded media upload", () => {
  it("handles boundaries split across bytes, preserving binary file and fields", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sv-upload-"));
    const request = multipart(
      '--sv-test\r\nContent-Disposition: form-data; name="requestId"\r\n\r\nabc\r\n--sv-test\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\nbinary-data\r\n--sv-test--\r\n'
    );
    const parsed = await streamMediaUpload(request, path.join(dir, "file"));
    expect(parsed.requestId).toBe("abc");
    expect(parsed.bytes).toBe(11);
    expect(await readFile(path.join(dir, "file"), "utf8")).toBe("binary-data");
  });
  it("rejects duplicated fields and incomplete multipart", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sv-upload-"));
    await expect(
      streamMediaUpload(
        multipart(
          '--sv-test\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\ntruncated'
        ),
        path.join(dir, "file")
      )
    ).rejects.toMatchObject({ code: "INVALID_MULTIPART" });
  });
  it("rejects uploads over the configured streaming byte limit", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sv-upload-"));
    vi.stubEnv("SHORT_VIDEO_UPLOAD_MAX_BYTES", "1024");
    await expect(
      streamMediaUpload(
        multipart(
          `--sv-test\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\n${"a".repeat(1025)}\r\n--sv-test--`,
          128
        ),
        path.join(dir, "file")
      )
    ).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
  });
});
