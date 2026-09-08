/**
 * extraConfig 敏感字段静态加密（at-rest）—— 纯函数单测
 *
 * 覆盖四条语义：
 * 1. 加密→解密往返还原明文；
 * 2. 历史明文行（无 enc:v1: 前缀）读取时原样透传（线上不做迁移）；
 * 3. 非敏感键（appId / refAudioPath 等）不被加密，jsonb 保持可读；
 * 4. 与掩码层协同：GET 掩码 → PUT 回传时真凭据不被覆盖，且重新落库仍是密文。
 */

import { describe, it, expect } from "vitest";
import {
  encryptExtraConfig,
  decryptExtraConfig,
  isEncryptedExtraValue,
} from "@/lib/encryption";
import {
  maskExtraConfig,
  preserveMaskedExtraConfig,
} from "@/app/api/ai-models/configs/extra-config-mask";

describe("encryptExtraConfig / decryptExtraConfig", () => {
  const plain = {
    appId: "1234567890",
    accessToken: "volc-secret-token-value",
    secretKey: "baidu-real-secret-key",
    refAudioPath: "/data/ref.wav",
  };

  it("加密→解密往返还原全部字段", () => {
    const encrypted = encryptExtraConfig(plain);
    expect(decryptExtraConfig(encrypted)).toEqual(plain);
  });

  it("敏感键落库为 enc:v1: 密文，且不等于明文", () => {
    const encrypted = encryptExtraConfig(plain)!;

    expect(isEncryptedExtraValue(encrypted.accessToken)).toBe(true);
    expect(isEncryptedExtraValue(encrypted.secretKey)).toBe(true);
    expect(encrypted.accessToken).not.toBe(plain.accessToken);
    expect(encrypted.secretKey).not.toBe(plain.secretKey);
    // 密文中不得残留明文片段
    expect(String(encrypted.accessToken)).not.toContain("volc-secret");
  });

  it("非敏感键原样保留，jsonb 仍可读", () => {
    const encrypted = encryptExtraConfig(plain)!;

    expect(encrypted.appId).toBe("1234567890");
    expect(encrypted.refAudioPath).toBe("/data/ref.wav");
    expect(isEncryptedExtraValue(encrypted.appId)).toBe(false);
  });

  it("历史明文行（无前缀）读取时原样透传，不做迁移", () => {
    // 线上存量行就是这个形态：敏感键也是裸明文
    expect(decryptExtraConfig(plain)).toEqual(plain);
  });

  it("明文 / 密文混合行逐值处理（重新保存后的中间态）", () => {
    const half = {
      ...encryptExtraConfig({ accessToken: plain.accessToken })!,
      secretKey: plain.secretKey, // 仍是历史明文
    };

    expect(decryptExtraConfig(half)).toEqual({
      accessToken: plain.accessToken,
      secretKey: plain.secretKey,
    });
  });

  it("重复加密幂等：已是密文的值不再套一层", () => {
    const once = encryptExtraConfig(plain)!;
    const twice = encryptExtraConfig(once)!;

    expect(twice.accessToken).toBe(once.accessToken);
    expect(decryptExtraConfig(twice)).toEqual(plain);
  });

  it("空串敏感值不加密（视为未配置）", () => {
    const encrypted = encryptExtraConfig({ token: "", appId: "x" })!;

    expect(encrypted.token).toBe("");
    expect(isEncryptedExtraValue(encrypted.token)).toBe(false);
  });

  it("非字符串值原样保留", () => {
    const encrypted = encryptExtraConfig({ enabled: true, retries: 3 })!;

    expect(encrypted.enabled).toBe(true);
    expect(encrypted.retries).toBe(3);
  });

  it("非对象输入返回 undefined（等价于「无 extraConfig」）", () => {
    for (const input of [null, undefined, "plain", 42, [1, 2]]) {
      expect(encryptExtraConfig(input)).toBeUndefined();
      expect(decryptExtraConfig(input)).toBeUndefined();
    }
  });

  it("密文损坏时降级为空串，不抛错拖垮整个配置加载", () => {
    const broken = { accessToken: "enc:v1:deadbeef:zzzz-not-hex" };

    expect(decryptExtraConfig(broken)).toEqual({ accessToken: "" });
  });
});

describe("加密层与掩码层协同（GET → PUT 往返）", () => {
  const plain = {
    appId: "1234567890",
    accessToken: "volc-secret-token-value",
    secretKey: "baidu-real-secret-key",
  };

  it("GET 先解密再掩码：下发的是明文的掩码形态，不泄露密文", () => {
    const stored = encryptExtraConfig(plain)!;
    const exposed = maskExtraConfig(decryptExtraConfig(stored)) as Record<
      string,
      unknown
    >;

    expect(String(exposed.accessToken)).not.toContain("enc:v1:");
    expect(exposed.accessToken).not.toBe(plain.accessToken);
    expect(exposed.appId).toBe("1234567890");
  });

  it("PUT 回传掩码值：真凭据被保留且重新落库仍是密文", () => {
    const stored = encryptExtraConfig(plain)!;
    // 服务端 PUT 分支：解密库中值 → 与提交的掩码值比对 → 还原 → 重新加密
    const existing = decryptExtraConfig(stored)!;
    const incoming = maskExtraConfig(existing);
    const restored = preserveMaskedExtraConfig(incoming, existing) as Record<
      string,
      unknown
    >;
    const reEncrypted = encryptExtraConfig(restored)!;

    expect(isEncryptedExtraValue(reEncrypted.accessToken)).toBe(true);
    expect(decryptExtraConfig(reEncrypted)).toEqual(plain);
  });

  it("PUT 提交新凭据：以新值为准并加密落库", () => {
    const stored = encryptExtraConfig(plain)!;
    const existing = decryptExtraConfig(stored)!;
    const restored = preserveMaskedExtraConfig(
      { accessToken: "brand-new-token" },
      existing
    ) as Record<string, unknown>;
    const reEncrypted = encryptExtraConfig(restored)!;

    expect(isEncryptedExtraValue(reEncrypted.accessToken)).toBe(true);
    expect(decryptExtraConfig(reEncrypted)).toEqual({
      accessToken: "brand-new-token",
    });
  });

  it("历史明文行走同一条 PUT 路径也能正确升级为密文", () => {
    // 库中还是明文（未迁移），用户只改了 appId 就保存
    const existing = decryptExtraConfig(plain)!;
    const incoming = maskExtraConfig(existing) as Record<string, unknown>;
    const restored = preserveMaskedExtraConfig(
      { ...incoming, appId: "9999999999" },
      existing
    ) as Record<string, unknown>;
    const reEncrypted = encryptExtraConfig(restored)!;

    expect(decryptExtraConfig(reEncrypted)).toEqual({
      ...plain,
      appId: "9999999999",
    });
  });
});
