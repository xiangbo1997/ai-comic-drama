import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock safeFetch（fetchWithError 的唯一网络出口），用假响应驱动 grok provider 的两条路径。
const safeFetchMock = vi.fn();
vi.mock("@/lib/url-guard", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import {
  grokImage,
  resolveGrokEditModel,
  buildGrokEditBody,
  isGatewayUnreachableUrl,
} from "@/services/ai/providers/grok";
import {
  getImageProviderCapability,
  describeImageCapabilityOverride,
} from "@/services/ai/provider-factory";
import type { AIServiceConfig } from "@/types";

const CONFIG: AIServiceConfig = {
  apiKey: "k",
  baseUrl: "https://grok2api.example.com/v1",
  model: "grok-imagine-image",
  protocol: "grok",
};

/** 构造 OpenAI 形态的成功图像响应 */
function imageResponse(url = "https://out/img.png"): Response {
  return new Response(JSON.stringify({ data: [{ url }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 取出本次 fetch 的 URL 与已解析的 JSON body */
function lastCall(): { url: string; body: Record<string, unknown> } {
  const [url, init] = safeFetchMock.mock.calls[
    safeFetchMock.mock.calls.length - 1
  ] as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) };
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("resolveGrokEditModel（编辑模型自动映射）", () => {
  it("生成模型映射到上游唯一的编辑模型", () => {
    expect(resolveGrokEditModel("grok-imagine-image")).toBe(
      "grok-imagine-image-edit"
    );
    expect(resolveGrokEditModel("grok-imagine-image-2.0")).toBe(
      "grok-imagine-image-edit"
    );
    expect(resolveGrokEditModel("grok-imagine-image-quality")).toBe(
      "grok-imagine-image-edit"
    );
    expect(resolveGrokEditModel("grok-imagine-image-lite")).toBe(
      "grok-imagine-image-edit"
    );
  });

  it("已是编辑模型时原样返回，不二次改写", () => {
    expect(resolveGrokEditModel("grok-imagine-image-edit")).toBe(
      "grok-imagine-image-edit"
    );
  });

  it("未登记的新版本号兜底到编辑模型（防清单滞后致参考图静默失效）", () => {
    expect(resolveGrokEditModel("grok-imagine-image-3.0")).toBe(
      "grok-imagine-image-edit"
    );
    expect(resolveGrokEditModel("xai/grok-imagine-image:latest")).toBe(
      "grok-imagine-image-edit"
    );
  });

  it("大小写不敏感", () => {
    expect(resolveGrokEditModel("GROK-IMAGINE-IMAGE")).toBe(
      "grok-imagine-image-edit"
    );
  });

  it("旧 grok-2 图像系列无对应编辑模型 → null（不得静默换模型）", () => {
    expect(resolveGrokEditModel("grok-2-image")).toBeNull();
    expect(resolveGrokEditModel("grok-2-image-1212")).toBeNull();
    expect(resolveGrokEditModel("grok-image")).toBeNull();
    expect(resolveGrokEditModel("")).toBeNull();
  });
});

describe("buildGrokEditBody（实测契约：JSON + images:[{url}]）", () => {
  it("参考图包成 images 对象数组（复数字段名 + url 键）", () => {
    expect(
      buildGrokEditBody("grok-imagine-image-edit", "draw", [
        "https://a/1.png",
        "https://a/2.png",
      ])
    ).toEqual({
      model: "grok-imagine-image-edit",
      prompt: "draw",
      images: [{ url: "https://a/1.png" }, { url: "https://a/2.png" }],
    });
  });

  it("超过 8 张按网关上限截断", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://a/${i}.png`);
    const body = buildGrokEditBody("m", "p", urls);
    expect(body.images).toHaveLength(8);
    expect(body.images[7]).toEqual({ url: "https://a/7.png" });
  });
});

describe("isGatewayUnreachableUrl（本地盘降级检测）", () => {
  it("公网 URL 可达", () => {
    expect(isGatewayUnreachableUrl("https://pub-x.r2.dev/a.webp")).toBe(false);
  });

  it("本地盘降级的相对路径与 localhost 不可达", () => {
    expect(isGatewayUnreachableUrl("/uploads/u1/p1/images/a.webp")).toBe(true);
    expect(
      isGatewayUnreachableUrl("http://localhost:3000/uploads/a.webp")
    ).toBe(true);
    expect(
      isGatewayUnreachableUrl("http://127.0.0.1:3100/uploads/a.webp")
    ).toBe(true);
  });

  it("内网段与非 http 协议不可达", () => {
    expect(isGatewayUnreachableUrl("http://192.168.1.10/a.webp")).toBe(true);
    expect(isGatewayUnreachableUrl("http://10.0.0.5/a.webp")).toBe(true);
    expect(isGatewayUnreachableUrl("http://172.16.0.3/a.webp")).toBe(true);
    expect(isGatewayUnreachableUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isGatewayUnreachableUrl("")).toBe(true);
  });
});

describe("grokImage.generateImage — 无参考图路径（零回归）", () => {
  it("仍打 /images/generations，body 逐字保持 {model, prompt, n:1}", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    const out = await grokImage.generateImage(
      { prompt: "a girl" },
      CONFIG,
      undefined
    );
    expect(out).toBe("https://out/img.png");
    const { url, body } = lastCall();
    expect(url).toBe("https://grok2api.example.com/v1/images/generations");
    expect(body).toEqual({
      model: "grok-imagine-image",
      prompt: "a girl",
      n: 1,
    });
  });

  it("未配 model（空串）时沿用历史默认 grok-2-image", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      { prompt: "p" },
      { ...CONFIG, model: "" },
      undefined
    );
    expect(lastCall().body.model).toBe("grok-2-image");
  });

  it("空 referenceImages 数组不触发编辑路径", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      { prompt: "p", referenceImages: [] },
      CONFIG,
      undefined
    );
    expect(lastCall().url).toContain("/images/generations");
  });
});

describe("grokImage.generateImage — 有参考图路径", () => {
  it("切到 /images/edits，JSON 契约 + 模型自动映射到 -edit", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse("https://out/edit.png"));
    const out = await grokImage.generateImage(
      { prompt: "keep identity", referenceImages: ["https://r2/a.png"] },
      CONFIG,
      undefined
    );
    expect(out).toBe("https://out/edit.png");

    const [url, init] = safeFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://grok2api.example.com/v1/images/edits");
    // 必须是 JSON：multipart 会被 grok2api 以 HTTP 415 拒收
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "grok-imagine-image-edit",
      prompt: "keep identity",
      images: [{ url: "https://r2/a.png" }],
    });
  });

  it("单张 referenceImage（向后兼容入参）同样走编辑路径", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      { prompt: "p", referenceImage: "https://r2/solo.png" },
      CONFIG,
      undefined
    );
    const { url, body } = lastCall();
    expect(url).toContain("/images/edits");
    expect(body.images).toEqual([{ url: "https://r2/solo.png" }]);
  });

  it("referenceImages 优先于单张 referenceImage", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      {
        prompt: "p",
        referenceImage: "https://r2/ignored.png",
        referenceImages: ["https://r2/used.png"],
      },
      CONFIG,
      undefined
    );
    expect(lastCall().body.images).toEqual([{ url: "https://r2/used.png" }]);
  });

  it("超过 8 张截断到网关上限", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      {
        prompt: "p",
        referenceImages: Array.from(
          { length: 11 },
          (_, i) => `https://r2/${i}.png`
        ),
      },
      CONFIG,
      undefined
    );
    expect(lastCall().body.images).toHaveLength(8);
  });

  it("无法映射编辑模型（grok-2-image）时退回文生图，不静默当编辑发", async () => {
    safeFetchMock.mockResolvedValueOnce(imageResponse());
    await grokImage.generateImage(
      { prompt: "p", referenceImages: ["https://r2/a.png"] },
      { ...CONFIG, model: "grok-2-image" },
      undefined
    );
    const { url, body } = lastCall();
    expect(url).toContain("/images/generations");
    expect(body.model).toBe("grok-2-image");
    expect(body.images).toBeUndefined();
  });

  it("上游返回空 data 时报可读中文错误，不崩在裸下标", async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(
      grokImage.generateImage(
        { prompt: "p", referenceImages: ["https://r2/a.png"] },
        CONFIG,
        undefined
      )
    ).rejects.toThrow(/Grok 图片编辑响应/);
  });
});

describe("能力表：protocol × model 组合判定", () => {
  it("protocol=grok + imagine 系 → 支持参考图（最多 8 张）", () => {
    const cap = getImageProviderCapability("grok", "grok-imagine-image");
    expect(cap.supportsReferenceImage).toBe(true);
    expect(cap.supportsMultipleReferences).toBe(true);
    expect(cap.maxReferenceImages).toBe(8);
    expect(
      describeImageCapabilityOverride("grok", "grok-imagine-image")
    ).toBeNull();
  });

  it("protocol=grok + 显式 -edit 模型同样支持", () => {
    expect(
      getImageProviderCapability("grok", "grok-imagine-image-edit")
        .supportsReferenceImage
    ).toBe(true);
  });

  it("protocol=grok + 旧 grok-2 系 → 仍判不支持，且给出换模型建议（批 1 防呆不失效）", () => {
    const cap = getImageProviderCapability("grok", "grok-2-image");
    expect(cap.supportsReferenceImage).toBe(false);
    expect(cap.maxReferenceImages).toBe(0);
    expect(describeImageCapabilityOverride("grok", "grok-2-image")).toContain(
      "grok-imagine"
    );
  });

  it("protocol=openai 代理 grok 模型 → 仍判不支持，并提示改用 grok 协议", () => {
    const cap = getImageProviderCapability("openai", "grok-imagine-image");
    expect(cap.supportsReferenceImage).toBe(false);
    const reason = describeImageCapabilityOverride(
      "openai",
      "grok-imagine-image"
    );
    expect(reason).toContain("grok");
    expect(reason).toContain("协议");
  });
});
