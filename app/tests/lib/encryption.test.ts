import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/encryption";

describe("encryption round-trip", () => {
  it("加密后能原样解密", () => {
    const plain = "sk-proj-abcdef123456";
    const { encrypted, iv } = encrypt(plain);
    expect(decrypt(encrypted, iv)).toBe(plain);
  });

  it("每次加密使用随机 IV（相同明文密文不同）", () => {
    const a = encrypt("same-text");
    const b = encrypt("same-text");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });
});

describe("decrypt 输入合法性校验", () => {
  it("空密文抛可识别错误而非不透明 crypto 错", () => {
    expect(() => decrypt("", "00")).toThrow(/非法|损坏/);
  });

  it("过短密文（不足以容纳 authTag）被拒", () => {
    // authTag 需 32 hex，这里给不足长度的 hex
    expect(() => decrypt("abcd", "00112233445566778899aabbccddeeff")).toThrow(
      /非法|损坏/
    );
  });

  it("非 hex 密文被拒", () => {
    const long = "z".repeat(40); // 长度够但非 hex
    expect(() => decrypt(long, "00112233445566778899aabbccddeeff")).toThrow(
      /非法|损坏/
    );
  });

  it("篡改密文导致 GCM 认证失败（tag 校验生效）", () => {
    const { encrypted, iv } = encrypt("integrity-check");
    // 翻转首字符触发 authTag/数据不匹配
    const tampered = (encrypted[0] === "a" ? "b" : "a") + encrypted.slice(1);
    expect(() => decrypt(tampered, iv)).toThrow();
  });
});
