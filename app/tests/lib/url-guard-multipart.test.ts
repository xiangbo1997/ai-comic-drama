import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { FormData as UndiciFormData } from "undici";
import { safeFetch } from "@/lib/url-guard";
import { openaiCompatibleImage } from "@/services/ai/providers/openai-compatible";

const originalAllowlist = process.env.INTERNAL_API_ALLOWLIST;
let lastReceived: { fields: Record<string, unknown>[] } | undefined;
const server = createServer(async (request, response) => {
  try {
    const buffers: Buffer[] = [];
    for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = Buffer.concat(buffers);
    const contentType = request.headers["content-type"] ?? "";
    const received = new Request("http://fixture.test", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    const fields = [];
    if (contentType.startsWith("multipart/form-data")) {
      for (const [name, value] of await received.formData()) {
        fields.push(
          typeof value === "string"
            ? { name, value }
            : {
                name,
                filename: value.name,
                type: value.type,
                bytes: [...new Uint8Array(await value.arrayBuffer())],
              }
        );
      }
    }
    lastReceived = { fields };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        data: [{ url: "https://fixture.test/result.png" }],
        contentType,
        fields,
        raw: contentType.startsWith("multipart") ? undefined : body.toString(),
        header: request.headers["x-probe"],
      })
    );
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
let origin: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  process.env.INTERNAL_API_ALLOWLIST = origin;
  lastReceived = undefined;
});
afterEach(() => {
  if (originalAllowlist === undefined)
    delete process.env.INTERNAL_API_ALLOWLIST;
  else process.env.INTERNAL_API_ALLOWLIST = originalAllowlist;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe("safeFetch真实HTTP表单传输", () => {
  it("真实图像Provider经安全出口发送提示词、seed和单份参考图", async () => {
    const result = await openaiCompatibleImage.generateImage(
      {
        prompt: "三视图正面",
        referenceImage: "data:image/png;base64,AQID",
        seed: 129,
      },
      {
        apiKey: "fixture-key",
        baseUrl: origin + "/v1",
        model: "gpt-image-2",
        protocol: "openai",
      }
    );
    expect(result).toBe("https://fixture.test/result.png");
    expect(lastReceived?.fields).toEqual(
      expect.arrayContaining([
        { name: "model", value: "gpt-image-2" },
        { name: "prompt", value: expect.stringContaining("三视图正面") },
        { name: "seed", value: "129" },
        {
          name: "image",
          filename: "0_ref.png",
          type: "image/png",
          bytes: [1, 2, 3],
        },
      ])
    );
    expect(
      lastReceived?.fields.filter((field) => "filename" in field)
    ).toHaveLength(1);
  });
  it("原生FormData的提示词和文件完整到达服务端", async () => {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", "正面角色，保持相同服装");
    form.append(
      "image",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      "portrait.png"
    );
    const result = await safeFetch(origin + "/edits", {
      method: "POST",
      body: form,
      headers: { "x-probe": "preserved" },
    });
    const data = await result.json();
    expect(data.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(data.fields).toEqual([
      { name: "model", value: "gpt-image-2" },
      { name: "prompt", value: "正面角色，保持相同服装" },
      {
        name: "image",
        filename: "portrait.png",
        type: "image/png",
        bytes: [1, 2, 3],
      },
    ]);
    expect(data.header).toBe("preserved");
  });

  it("多图保持重复字段、文件名和二进制内容，每张只传一次", async () => {
    const form = new FormData();
    for (const [index, byte] of [11, 22].entries()) {
      form.append(
        "image[]",
        new Blob([new Uint8Array([byte])], { type: "image/webp" }),
        `${index}.webp`
      );
    }
    const result = await safeFetch(origin, { method: "POST", body: form });
    const data = await result.json();
    expect(data.fields).toEqual([
      { name: "image[]", filename: "0.webp", type: "image/webp", bytes: [11] },
      { name: "image[]", filename: "1.webp", type: "image/webp", bytes: [22] },
    ]);
  });

  it("Undici原生表单仍按multipart发送", async () => {
    const form = new UndiciFormData();
    form.append("prompt", "side view");
    const result = await safeFetch(origin, {
      method: "POST",
      body: form as unknown as BodyInit,
    });
    expect((await result.json()).fields).toEqual([
      { name: "prompt", value: "side view" },
    ]);
  });

  it("JSON请求体和显式Content-Type保持不变", async () => {
    const result = await safeFetch(origin, {
      method: "POST",
      body: '{"prompt":"back view"}',
      headers: { "content-type": "application/json" },
    });
    const data = await result.json();
    expect(data.contentType).toBe("application/json");
    expect(data.raw).toBe('{"prompt":"back view"}');
  });
});
