import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeFetchMock = vi.fn();
vi.mock("@/lib/url-guard", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  safeDownload: vi.fn(),
}));
import { openaiCompatibleImage } from "@/services/ai/providers/openai-compatible";
import { toFriendlyError } from "@/lib/error-copy";

const config = {
  apiKey: "test",
  baseUrl: "https://gateway.example/v1",
  model: "gpt-image-2",
  protocol: "openai" as const,
};
const ref = "data:image/png;base64,aW1hZ2U=";
const success = () =>
  new Response(
    JSON.stringify({ data: [{ url: "https://images.example/result.png" }] }),
    { headers: { "content-type": "application/json" } }
  );

beforeEach(() => {
  safeFetchMock.mockReset();
  vi.stubGlobal("fetch", safeFetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI 图像上传与限额", () => {
  it("自动执行不重试连接失败，也不从编辑端点另发文生图", async () => {
    safeFetchMock.mockRejectedValueOnce(
      Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" })
    );
    await expect(
      openaiCompatibleImage.generateImage(
        { prompt: "draw", referenceImage: ref, disableRetries: true },
        config
      )
    ).rejects.toThrow("connect failed");
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });

  it("自动执行的编辑请求404不降级另发付费任务", async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response("not found", { status: 404 })
    );
    await expect(
      openaiCompatibleImage.generateImage(
        { prompt: "draw", referenceImage: ref, disableRetries: true },
        config
      )
    ).rejects.toThrow("接口未实现");
    expect(safeFetchMock).toHaveBeenCalledOnce();
  });
  it("每张参考图只作为一个文件上传，不重复发送兼容字段", async () => {
    safeFetchMock.mockResolvedValueOnce(success());
    await openaiCompatibleImage.generateImage(
      { prompt: "draw", referenceImages: [ref, ref] },
      config
    );
    const form = safeFetchMock.mock.calls[0][1].body as FormData;
    const files = [...form.entries()].filter(
      ([, value]) => value instanceof Blob
    );
    expect(files).toHaveLength(2);
    expect(new Set(files.map(([field]) => field)).size).toBe(1);
  });

  it.each([true, false])(
    "上传限额429保留可行动的消息，不自动重试（参考图=%s）",
    async (withReference) => {
      safeFetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "参考图上传额度已达上限，请7小时后重试或切换图像配置",
              code: "upload_protection_limit_exceeded",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        )
      );
      let error: unknown;
      try {
        await openaiCompatibleImage.generateImage(
          { prompt: "draw", ...(withReference ? { referenceImage: ref } : {}) },
          config
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(toFriendlyError(error, "失败").message).toContain("7小时");
      expect((error as Error).message).not.toContain('error":');
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([true, false])(
    "网关502网页显示服务异常，不误报地址或附带HTML（参考图=%s）",
    async (withReference) => {
      safeFetchMock.mockResolvedValueOnce(
        new Response("<!DOCTYPE html><html>gateway failure</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        })
      );
      await expect(
        openaiCompatibleImage.generateImage(
          { prompt: "draw", ...(withReference ? { referenceImage: ref } : {}) },
          config
        )
      ).rejects.toThrow(/图像服务.*502/);
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    }
  );
});
