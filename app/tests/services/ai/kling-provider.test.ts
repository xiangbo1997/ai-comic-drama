import { webcrypto } from "node:crypto";
import type { AIServiceConfig } from "@/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: safeFetchMock }));
import {
  createKlingJwt,
  klingVideo,
  resolveKlingCredentials,
} from "@/services/ai/providers/kling";

const config: AIServiceConfig = {
  apiKey: "access-key",
  baseUrl: "https://api.example.com",
  model: "kling-v1",
  protocol: "kling",
  extraConfig: { secretKey: "secret-key" },
};
const options = {
  imageUrl: "https://cdn.example/frame.jpg",
  prompt: "slow camera movement",
  duration: 7,
};
const submitted = () => Response.json({ code: 0, data: { task_id: "task/1" } });
const completed = () =>
  Response.json({
    code: 0,
    data: {
      task_status: "succeed",
      task_result: { videos: [{ url: "https://cdn.example/video.mp4" }] },
    },
  });

beforeEach(() => {
  safeFetchMock.mockReset().mockRejectedValue(new Error("Unmocked safeFetch"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unmocked global fetch"))
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Kling provider", () => {
  it("signs documented claims with a verifiable HS256 signature", async () => {
    const token = createKlingJwt("access-key", "secret-key", 1_700_000_000);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: "access-key",
      exp: 1_700_001_800,
      nbf: 1_699_999_995,
    });
    const key = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from("secret-key"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    expect(
      await webcrypto.subtle.verify(
        "HMAC",
        key,
        Buffer.from(signature, "base64url"),
        Buffer.from(header + "." + payload)
      )
    ).toBe(true);
  });

  it("trims credentials and prefers the main key over legacy extraConfig", () => {
    expect(
      resolveKlingCredentials({
        apiKey: " primary ",
        extraConfig: { accessKey: "legacy", secretKey: " secret " },
      })
    ).toEqual({ accessKey: "primary", secretKey: "secret" });
    expect(
      resolveKlingCredentials({
        apiKey: " ",
        extraConfig: { accessKey: " legacy " },
      })
    ).toEqual({ accessKey: "legacy", secretKey: "" });
  });

  it("submits image-to-video once and returns the polled URL", async () => {
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(completed());
    const controller = new AbortController();
    expect(
      await klingVideo.generateVideo(
        { ...options, identityPrompt: "same character" },
        config,
        { signal: controller.signal }
      )
    ).toBe("https://cdn.example/video.mp4");
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/videos/image2video");
    expect(init.headers.Authorization).toMatch(
      /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/
    );
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body)).toEqual({
      model_name: "kling-v1",
      image: options.imageUrl,
      prompt: "same character\nslow camera movement",
      duration: "5",
      mode: "std",
    });
    expect(safeFetchMock.mock.calls[1][0]).toBe(
      "https://api.example.com/v1/videos/image2video/task%2F1"
    );
  });

  it("supports API Key authentication, pro mode and a base ending in v1", async () => {
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(completed());
    await klingVideo.generateVideo(
      { ...options, duration: 15 },
      {
        ...config,
        baseUrl: "https://proxy.example/v1/",
        extraConfig: { mode: "pro" },
      }
    );
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://proxy.example/v1/videos/image2video");
    expect(init.headers.Authorization).toBe("Bearer access-key");
    expect(JSON.parse(init.body)).toMatchObject({
      mode: "pro",
      duration: "10",
    });
  });

  it("uses documented default host, model, prompt and duration", async () => {
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(completed());
    await klingVideo.generateVideo(
      { imageUrl: options.imageUrl },
      { apiKey: "api-key", baseUrl: "", model: "", protocol: "kling" }
    );
    expect(safeFetchMock.mock.calls[0][0]).toBe(
      "https://api-beijing.klingai.com/v1/videos/image2video"
    );
    expect(JSON.parse(safeFetchMock.mock.calls[0][1].body)).toMatchObject({
      model_name: "kling-v2-6",
      prompt: "gentle camera movement",
      duration: "5",
    });
  });

  it.each([
    null,
    { code: 1002, message: "invalid access key" },
    { code: 0 },
    { code: 0, data: [] },
    { code: 0, data: {} },
  ])("rejects malformed/failed submissions %#", async (data) => {
    safeFetchMock.mockResolvedValueOnce(Response.json(data));
    await expect(klingVideo.generateVideo(options, config)).rejects.toThrow(
      /Kling/
    );
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { task_status: "failed", task_status_msg: "content rejected" },
    { task_status: "succeed", task_result: {} },
    {
      task_status: "succeed",
      task_result: { videos: [{ url: "file:///etc/passwd" }] },
    },
    {},
  ])("rejects failed or malformed task results %#", async (data) => {
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(Response.json({ code: 0, data }));
    await expect(klingVideo.generateVideo(options, config)).rejects.toThrow(
      /Kling/
    );
  });

  it("polls pending tasks without resubmitting", async () => {
    vi.useFakeTimers();
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { task_status: "processing" } })
      )
      .mockResolvedValueOnce(completed());
    const pending = klingVideo.generateVideo(options, config);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toContain("video.mp4");
    expect(
      safeFetchMock.mock.calls.filter(([, init]) => init.method === "POST")
    ).toHaveLength(1);
  });

  it("cancels an already aborted request before submission", async () => {
    await expect(
      klingVideo.generateVideo(options, config, { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("cancels pending polling promptly", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    safeFetchMock
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { task_status: "submitted" } })
      );
    const pending = klingVideo.generateVideo(options, config, {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await assertion;
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not repeat paid submissions after an ambiguous gateway error", async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response("gateway error", { status: 502 })
    );
    await expect(klingVideo.generateVideo(options, config)).rejects.toThrow(
      "502"
    );
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });

  it("rejects missing key and unsupported mode locally", async () => {
    await expect(
      klingVideo.generateVideo(options, { ...config, apiKey: "" })
    ).rejects.toThrow("未配置");
    await expect(
      klingVideo.generateVideo(options, {
        ...config,
        extraConfig: { mode: "invalid" },
      })
    ).rejects.toThrow("std 或 pro");
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
