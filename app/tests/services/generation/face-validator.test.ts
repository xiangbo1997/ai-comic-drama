import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateFaceConsistency,
  clearFaceValidationMemo,
  parseAttributeFindings,
} from "@/services/generation/face-validator";
import type { SceneCharacterInfo } from "@/services/generation/types";
import type { AIServiceConfig } from "@/types";

const llmConfig: AIServiceConfig = {
  apiKey: "test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o",
  protocol: "openai",
};

/** 6 维全 match 的 VLM 回复 */
const ALL_MATCH = JSON.stringify({
  attributes: [
    { attribute: "face", judgement: "match" },
    { attribute: "bodyType", judgement: "match" },
    { attribute: "hairstyle", judgement: "match" },
    { attribute: "hairColor", judgement: "match" },
    { attribute: "outfit", judgement: "match" },
    { attribute: "accessories", judgement: "match" },
  ],
});

/** 明显换人（face mismatch） */
const FACE_MISMATCH = JSON.stringify({
  attributes: [
    { attribute: "face", judgement: "mismatch", note: "五官完全不同" },
    { attribute: "bodyType", judgement: "match" },
    { attribute: "hairstyle", judgement: "match" },
    { attribute: "hairColor", judgement: "match" },
    { attribute: "outfit", judgement: "match" },
    { attribute: "accessories", judgement: "match" },
  ],
});

function mockVlm(content: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** 有「真」定妆锚的主角色 —— 校验会真正执行 */
const primaryChar: SceneCharacterInfo = {
  id: "c1",
  name: "林萧",
  gender: "female",
  age: "24",
  description: "24岁女性",
  referenceImages: ["https://cdn/ref.png"],
  role: "primary",
  canonicalImageUrl: "https://cdn/ref.png",
  trueCanonicalImageUrl: "https://cdn/canonical.png",
  appearance: null,
};

describe("validateFaceConsistency()", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearFaceValidationMemo();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ===== 四重 passthrough 现在都必须带 status/reason，不再静默 =====

  it("远景跳过校验，且显式标记 status=skipped", async () => {
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "远景",
      { llmConfig }
    );
    expect(r.passed).toBe(true);
    expect(r.shouldRetry).toBe(false);
    expect(r.status).toBe("skipped");
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("validation_skipped_for_shot_type");
  });

  it("缺 llmConfig 时标记为跳过而非通过", async () => {
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写"
    );
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("llm_config_missing");
  });

  it("无主角色（纯环境镜）标记为跳过", async () => {
    const r = await validateFaceConsistency("https://img/gen.png", [], "特写", {
      llmConfig,
    });
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("no_primary_character");
  });

  // D1-1 核心回归：没有「真」定妆锚就不能校验，绝不能拿参考图自证
  it("无 trueCanonicalImageUrl 时报 no_true_canonical_anchor（不拿参考图自证）", async () => {
    const fetchMock = mockVlm(ALL_MATCH);
    const withoutAnchor: SceneCharacterInfo = {
      ...primaryChar,
      trueCanonicalImageUrl: undefined,
    };

    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [withoutAnchor],
      "特写",
      { llmConfig }
    );

    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("no_true_canonical_anchor");
    // 关键：一次 VLM 都没发 —— 没有可信基准就不该假装校验过
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("纯文本模型（deepseek）显式记为 model_without_vision", async () => {
    const fetchMock = mockVlm(ALL_MATCH);
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig: { ...llmConfig, model: "deepseek-chat" } }
    );
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("model_without_vision");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("VLM 回复无法解析时报 vlm_unparseable_response，不伪装成通过", async () => {
    mockVlm("模型今天不想输出 JSON");
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("vlm_unparseable_response");
  });

  it("异常降级放行但 status=error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.passed).toBe(true);
    expect(r.status).toBe("error");
    expect(r.reason).toBe("identity_validation_error");
  });

  // ===== 真校验路径 =====

  it("6 维全 match → PASS / accept / 不重试", async () => {
    mockVlm(ALL_MATCH);
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.status).toBe("checked");
    expect(r.grade).toBe("PASS");
    expect(r.passed).toBe(true);
    expect(r.shouldRetry).toBe(false);
    expect(r.scores["林萧"]).toBe(1);
  });

  it("face mismatch（明显换人）→ FAIL 且要求重试", async () => {
    mockVlm(FACE_MISMATCH);
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig, retriesRemaining: 2 }
    );
    expect(r.grade).toBe("FAIL");
    expect(r.passed).toBe(false);
    expect(r.shouldRetry).toBe(true);
    expect(r.violations?.map((v) => v.attribute)).toContain("face");
  });

  // 重试上界：用尽余量后不再要求重试，否则无限烧积分
  it("retriesRemaining=0 时 FAIL 也 accept（重试有上界）", async () => {
    mockVlm(FACE_MISMATCH);
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig, retriesRemaining: 0 }
    );
    expect(r.grade).toBe("FAIL");
    expect(r.passed).toBe(true);
    expect(r.shouldRetry).toBe(false);
  });

  // 剧情意图：有换装标注时服装差异不算错误（防过度纠正）
  it("带换装标注时 outfit mismatch 被豁免 → 仍 PASS", async () => {
    mockVlm(
      JSON.stringify({
        attributes: [
          { attribute: "face", judgement: "match" },
          { attribute: "bodyType", judgement: "match" },
          { attribute: "hairstyle", judgement: "match" },
          { attribute: "hairColor", judgement: "match" },
          { attribute: "outfit", judgement: "mismatch", note: "换成婚纱" },
          { attribute: "accessories", judgement: "match" },
        ],
      })
    );

    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig, outfitNote: "白色婚纱" }
    );

    expect(r.grade).toBe("PASS");
    expect(r.exempted).toContain("outfit");
  });

  // 对照组：同样的 outfit mismatch，无换装标注时不豁免 —— 记为违规且扣分。
  // 单个外观维度不致命（非对称判据），但违规必须被记录下来，供反思/日志消费。
  it("无换装标注时同样的 outfit mismatch 计入违规并扣分", async () => {
    mockVlm(
      JSON.stringify({
        attributes: [
          { attribute: "face", judgement: "match" },
          { attribute: "bodyType", judgement: "match" },
          { attribute: "hairstyle", judgement: "match" },
          { attribute: "hairColor", judgement: "match" },
          { attribute: "outfit", judgement: "mismatch" },
          { attribute: "accessories", judgement: "match" },
        ],
      })
    );
    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );
    expect(r.violations?.map((v) => v.attribute)).toContain("outfit");
    expect(r.exempted).toHaveLength(0);
    expect(r.scores["林萧"]).toBeCloseTo(0.88, 3);
  });

  // BORDERLINE 二次投票：单次判定一致率仅约 71%
  it("BORDERLINE 触发二次投票（两次 VLM 调用）", async () => {
    const borderline = JSON.stringify({
      attributes: [
        { attribute: "face", judgement: "match" },
        { attribute: "bodyType", judgement: "match" },
        { attribute: "hairstyle", judgement: "mismatch" },
        { attribute: "hairColor", judgement: "mismatch" },
        { attribute: "outfit", judgement: "mismatch" },
        { attribute: "accessories", judgement: "match" },
      ],
    });
    const fetchMock = mockVlm(borderline);

    const r = await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      { llmConfig }
    );

    expect(r.grade).toBe("BORDERLINE");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("PASS 不触发二次投票（省 token）", async () => {
    const fetchMock = mockVlm(ALL_MATCH);
    await validateFaceConsistency(
      "https://img/gen.png",
      [primaryChar],
      "特写",
      {
        llmConfig,
      }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 成本护栏：编排器在缓存命中路径与每次重试都会调本校验器
  it("记忆表命中：同图同角色只调一次 VLM", async () => {
    const fetchMock = mockVlm(ALL_MATCH);
    const url = "https://img/memo.png";

    const first = await validateFaceConsistency(url, [primaryChar], "特写", {
      llmConfig,
    });
    const second = await validateFaceConsistency(url, [primaryChar], "特写", {
      llmConfig,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.scores["林萧"]).toBeCloseTo(first.scores["林萧"], 5);
  });

  it("不同图片各自评分（新图必然 miss）", async () => {
    const fetchMock = mockVlm(ALL_MATCH);
    await validateFaceConsistency("https://img/a.png", [primaryChar], "特写", {
      llmConfig,
    });
    await validateFaceConsistency("https://img/b.png", [primaryChar], "特写", {
      llmConfig,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 多协议（D1-3 回归）：claude / gemini 此前被入口直接抛错 → 用户配 Claude 时
  // 校验在所有路径上 100% 空转。现在必须真正发出各自协议的请求。
  //
  // 用 data URL 作图片：Claude/Gemini 需要 base64 内联，http(s) 图会走
  // assertSafeUrl 的真实 DNS 解析（SSRF 闸门，符合预期），测试环境解析不了假域名。
  const dataUrlChar: SceneCharacterInfo = {
    ...primaryChar,
    trueCanonicalImageUrl: "data:image/png;base64,aaaa",
  };

  it("claude 协议走真实视觉请求（不再直接降级）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: ALL_MATCH }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await validateFaceConsistency(
      "data:image/png;base64,bbbb",
      [dataUrlChar],
      "特写",
      {
        llmConfig: {
          apiKey: "k",
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-sonnet-5",
          protocol: "claude",
        },
      }
    );

    expect(r.status).toBe("checked");
    expect(r.grade).toBe("PASS");
    // 打到 Claude 的 /messages 而非 OpenAI 的 /chat/completions
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/messages");
  });

  it("gemini 协议走真实视觉请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: ALL_MATCH }] } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await validateFaceConsistency(
      "data:image/png;base64,bbbb",
      [dataUrlChar],
      "特写",
      {
        llmConfig: {
          apiKey: "k",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          protocol: "gemini",
        },
      }
    );

    expect(r.status).toBe("checked");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("generateContent");
  });
});

describe("parseAttributeFindings()", () => {
  it("解析裸 JSON", () => {
    const r = parseAttributeFindings(ALL_MATCH);
    expect(r).toHaveLength(6);
  });

  it("解析 markdown 代码块包裹的 JSON", () => {
    const r = parseAttributeFindings("```json\n" + ALL_MATCH + "\n```");
    expect(r).toHaveLength(6);
  });

  it("无 JSON → null", () => {
    expect(parseAttributeFindings("没有 JSON")).toBeNull();
  });

  it("attributes 非数组 → null", () => {
    expect(parseAttributeFindings('{"attributes":"nope"}')).toBeNull();
  });

  it("丢弃非法维度/判定，保留合法条目", () => {
    const r = parseAttributeFindings(
      JSON.stringify({
        attributes: [
          { attribute: "face", judgement: "match" },
          { attribute: "蜜汁维度", judgement: "match" },
          { attribute: "outfit", judgement: "怎么说呢" },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r?.[0].attribute).toBe("face");
  });

  it("全部条目非法 → null（不静默当成通过）", () => {
    const r = parseAttributeFindings(
      JSON.stringify({ attributes: [{ attribute: "x", judgement: "y" }] })
    );
    expect(r).toBeNull();
  });

  it("note 截断到 40 字", () => {
    const r = parseAttributeFindings(
      JSON.stringify({
        attributes: [
          { attribute: "face", judgement: "match", note: "字".repeat(80) },
        ],
      })
    );
    expect(r?.[0].note?.length).toBe(40);
  });
});
