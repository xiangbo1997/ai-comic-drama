import { open } from "node:fs/promises";
import { shortVideoConfig } from "./config";
import { invariant, SvError } from "./errors";
/** 受限multipart流式解析器：仅一个file及短文本字段，不将200MiB视频装入内存。 */
export async function streamMediaUpload(request: Request, destination: string) {
  const match =
    /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i.exec(
      request.headers.get("content-type") || ""
    );
  const boundary = match?.[1] || match?.[2];
  invariant(
    boundary && boundary.length <= 100 && /^[\w'()+,./:=?-]+$/.test(boundary),
    422,
    "MULTIPART_REQUIRED",
    "请上传有效multipart表单"
  );
  invariant(request.body, 422, "EMPTY_UPLOAD", "上传内容为空");
  const max = shortVideoConfig().uploadMaxBytes;
  const headerMax = 8192;
  const start = Buffer.from(`--${boundary}\r\n`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const reader = request.body.getReader();
  const file = await open(destination, "wx");
  let buffer = Buffer.alloc(0);
  let total = 0;
  let bytes = 0;
  let sawFile = false;
  let state: "start" | "header" | "body" | "boundary" | "done" = "start";
  let field = "";
  let partFile = false;
  let fieldBuffer = Buffer.alloc(0);
  const fields: Record<string, string> = {};
  const write = async (data: Buffer) => {
    if (partFile) {
      bytes += data.length;
      invariant(bytes <= max, 413, "UPLOAD_TOO_LARGE", "上传文件超限");
      await file.writeFile(data);
    } else {
      invariant(
        fieldBuffer.length + data.length <= 2000,
        422,
        "FIELD_TOO_LARGE",
        "上传字段过长"
      );
      fieldBuffer = Buffer.concat([fieldBuffer, data]);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        total += value.length;
        invariant(
          total <= max + 32768,
          413,
          "UPLOAD_TOO_LARGE",
          "上传文件超限"
        );
        buffer = Buffer.concat([buffer, value]);
      }
      let progress = true;
      while (progress) {
        progress = false;
        if (state === "start" && buffer.length >= start.length) {
          invariant(
            buffer.subarray(0, start.length).equals(start),
            422,
            "INVALID_MULTIPART",
            "上传表单无效"
          );
          buffer = buffer.subarray(start.length);
          state = "header";
          progress = true;
        } else if (state === "header") {
          const end = buffer.indexOf("\r\n\r\n");
          if (end < 0)
            invariant(
              buffer.length <= headerMax,
              422,
              "INVALID_MULTIPART",
              "上传头过长"
            );
          else {
            invariant(end <= headerMax, 422, "INVALID_MULTIPART", "上传头过长");
            const header = buffer.subarray(0, end).toString("utf8");
            const name =
              /content-disposition:\s*form-data;\s*name="([^"]+)"/i.exec(
                header
              )?.[1];
            invariant(
              name &&
                ["file", "requestId", "kind", "rightsNote"].includes(name),
              422,
              "INVALID_MULTIPART",
              "上传字段不受支持"
            );
            partFile = name === "file";
            field = name;
            fieldBuffer = Buffer.alloc(0);
            if (partFile) {
              invariant(
                !sawFile && /filename="[^"]*"/i.test(header),
                422,
                "INVALID_MULTIPART",
                "只允许一个文件"
              );
              sawFile = true;
            } else
              invariant(
                fields[field] === undefined,
                422,
                "INVALID_MULTIPART",
                "上传字段重复"
              );
            buffer = buffer.subarray(end + 4);
            state = "body";
            progress = true;
          }
        } else if (state === "body") {
          const end = buffer.indexOf(delimiter);
          if (end >= 0) {
            await write(buffer.subarray(0, end));
            if (!partFile) fields[field] = fieldBuffer.toString("utf8");
            buffer = buffer.subarray(end + delimiter.length);
            state = "boundary";
            progress = true;
          } else if (buffer.length > delimiter.length + 4) {
            const length = buffer.length - delimiter.length - 4;
            await write(buffer.subarray(0, length));
            buffer = buffer.subarray(length);
          }
        } else if (state === "boundary" && buffer.length >= 2) {
          const marker = buffer.toString("ascii", 0, 2);
          invariant(
            marker === "--" || marker === "\r\n",
            422,
            "INVALID_MULTIPART",
            "上传分隔无效"
          );
          buffer = buffer.subarray(2);
          state = marker === "--" ? "done" : "header";
          progress = true;
        } else if (state === "done") {
          invariant(
            buffer.length <= 2 &&
              (buffer.length === 0 || buffer[0] === 13) &&
              (buffer.length < 2 || buffer[1] === 10),
            422,
            "INVALID_MULTIPART",
            "上传末尾无效"
          );
        }
      }
      if (done) break;
    }
    invariant(
      state === "done" && sawFile && bytes > 0,
      422,
      "INVALID_MULTIPART",
      "上传不完整或文件为空"
    );
    return {
      requestId: fields.requestId,
      kind: fields.kind || "VIDEO",
      rightsNote: fields.rightsNote || "",
      bytes,
    };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SvError) throw error;
    throw new SvError(422, "UPLOAD_FAILED", "上传未完成");
  } finally {
    reader.releaseLock();
    await file.close();
  }
}
