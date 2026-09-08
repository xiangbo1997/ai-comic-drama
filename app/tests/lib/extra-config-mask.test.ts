/**
 * extraConfig 敏感字段掩码 —— 纯函数单测
 *
 * 覆盖两条语义：读时掩码（maskExtraConfig）与写时保留（preserveMaskedExtraConfig）。
 * 两者必须互为逆向：GET 掩码后原样回传 PUT，库中真值不得被覆盖。
 */

import { describe, it, expect } from "vitest";
import { maskApiKey } from "@/lib/encryption";
import {
  isSensitiveExtraKey,
  maskExtraConfig,
  preserveMaskedExtraConfig,
} from "@/app/api/ai-models/configs/extra-config-mask";

describe("isSensitiveExtraKey", () => {
  it("识别显式名单中的凭据键", () => {
    for (const key of [
      "accessToken",
      "secretKey",
      "apiSecret",
      "token",
      "appSecret",
    ]) {
      expect(isSensitiveExtraKey(key)).toBe(true);
    }
  });

  it("识别含 secret / token 或以 key 结尾的键", () => {
    expect(isSensitiveExtraKey("clientSecret")).toBe(true);
    expect(isSensitiveExtraKey("refreshToken")).toBe(true);
    expect(isSensitiveExtraKey("privateKey")).toBe(true);
  });

  it("放行无害的配置键", () => {
    expect(isSensitiveExtraKey("appId")).toBe(false);
    expect(isSensitiveExtraKey("refAudioPath")).toBe(false);
    expect(isSensitiveExtraKey("region")).toBe(false);
  });
});

describe("maskExtraConfig", () => {
  it("掩码凭据值，保留无害字段原样", () => {
    const masked = maskExtraConfig({
      appId: "1234567890",
      accessToken: "volc-secret-token-value",
      refAudioPath: "/data/ref.wav",
    }) as Record<string, unknown>;

    expect(masked.appId).toBe("1234567890");
    expect(masked.refAudioPath).toBe("/data/ref.wav");
    expect(masked.accessToken).not.toBe("volc-secret-token-value");
    expect(masked.accessToken).toBe(maskApiKey("volc-secret-token-value"));
  });

  it("非字符串与空串不受影响", () => {
    const masked = maskExtraConfig({
      token: "",
      secretKey: null,
      enabled: true,
    }) as Record<string, unknown>;

    expect(masked.token).toBe("");
    expect(masked.secretKey).toBeNull();
    expect(masked.enabled).toBe(true);
  });

  it("非对象输入原样返回", () => {
    expect(maskExtraConfig(null)).toBeNull();
    expect(maskExtraConfig(undefined)).toBeUndefined();
    expect(maskExtraConfig("plain")).toBe("plain");
    expect(maskExtraConfig([1, 2])).toEqual([1, 2]);
  });
});

describe("preserveMaskedExtraConfig", () => {
  const existing = {
    appId: "1234567890",
    accessToken: "volc-secret-token-value",
    secretKey: "baidu-real-secret-key",
  };

  it("回传掩码值时保留库中真值（GET → PUT 往返不丢密钥）", () => {
    const roundTripped = maskExtraConfig(existing) as Record<string, unknown>;
    const restored = preserveMaskedExtraConfig(
      roundTripped,
      existing
    ) as Record<string, unknown>;

    expect(restored.accessToken).toBe("volc-secret-token-value");
    expect(restored.secretKey).toBe("baidu-real-secret-key");
    expect(restored.appId).toBe("1234567890");
  });

  it("用户真改了凭据时以新值为准", () => {
    const restored = preserveMaskedExtraConfig(
      { accessToken: "brand-new-token" },
      existing
    ) as Record<string, unknown>;

    expect(restored.accessToken).toBe("brand-new-token");
  });

  it("纯星号占位视为未编辑，不覆盖真值", () => {
    const restored = preserveMaskedExtraConfig(
      { secretKey: "****" },
      existing
    ) as Record<string, unknown>;

    expect(restored.secretKey).toBe("baidu-real-secret-key");
  });

  it("库中无对应真值时按新值写入", () => {
    const restored = preserveMaskedExtraConfig(
      { apiSecret: "first-time-value" },
      existing
    ) as Record<string, unknown>;

    expect(restored.apiSecret).toBe("first-time-value");
  });

  it("非敏感键不参与保留逻辑", () => {
    const restored = preserveMaskedExtraConfig(
      { appId: "9999999999" },
      existing
    ) as Record<string, unknown>;

    expect(restored.appId).toBe("9999999999");
  });
});
