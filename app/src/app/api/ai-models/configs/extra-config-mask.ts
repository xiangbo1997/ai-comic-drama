/**
 * extraConfig 敏感字段掩码（2026-09-08 安全修复）
 *
 * 背景：UserAIConfig.extraConfig 是扁平 Json，除了 appId / refAudioPath 这类
 * 无害字段，还塞着真凭据——火山 accessToken、百度 secretKey、各家 apiSecret /
 * token / appSecret。GET 直出 extraConfig 等于把密钥明文回吐给浏览器，任何
 * XSS 或共享设备都能顺走。
 *
 * 策略与 apiKey 一致：读时掩码，写时若客户端回传的仍是掩码值则保留库中原值
 * （前端表单只回填部分字段就保存的场景很常见，不能用掩码把真密钥覆盖掉）。
 *
 * 静态加密（at-rest）由 lib/encryption 的 encryptExtraConfig /
 * decryptExtraConfig 负责；本文件只处理「对外展示」这一层，入参必须已是明文
 * （调用方先解密再掩码），否则掩码的是密文，PUT 的「掩码即未编辑」判据会失效。
 */

import { maskApiKey, isSensitiveExtraKey } from "@/lib/encryption";

// 敏感键判据的单一真源在 lib/encryption（加密与掩码必须同一套判据，否则会出现
// 「加密了但不掩码」或「掩码了但明文落库」的错配）。此处转出供既有调用方使用。
export { isSensitiveExtraKey };

/** 把 unknown 收敛为扁平对象；非对象 / 数组返回 null（调用方原样透传） */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 掩码 extraConfig 中的敏感值；非敏感键、非字符串值、空串原样保留。
 * @param extraConfig 库中取出的 Json 值
 * @returns 可安全返回给客户端的同形对象
 */
export function maskExtraConfig(extraConfig: unknown): unknown {
  const source = asPlainObject(extraConfig);
  if (!source) return extraConfig;

  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      isSensitiveExtraKey(key) && typeof value === "string" && value.length > 0
        ? maskApiKey(value)
        : value,
    ])
  );
}

/**
 * 写入前还原：客户端把 GET 拿到的掩码值原样回传时，说明该字段未被编辑，
 * 应保留库中真值而非用掩码覆盖。判据是「提交值等于该字段现存真值的掩码形态」。
 *
 * @param incoming 客户端提交的 extraConfig（可能含掩码占位）
 * @param existing 库中现存的 extraConfig
 * @returns 已把未编辑的敏感字段还原为真值的对象
 */
export function preserveMaskedExtraConfig(
  incoming: unknown,
  existing: unknown
): unknown {
  const incomingObj = asPlainObject(incoming);
  const existingObj = asPlainObject(existing);
  if (!incomingObj || !existingObj) return incoming;

  return Object.fromEntries(
    Object.entries(incomingObj).map(([key, value]) => {
      if (!isSensitiveExtraKey(key) || typeof value !== "string") {
        return [key, value];
      }
      const stored = existingObj[key];
      if (typeof stored !== "string" || stored.length === 0) {
        return [key, value];
      }
      // 提交值与「现存真值的掩码」一致 → 视为未编辑，回填真值。
      // 全星号（短值掩码形态）也按未编辑处理：用户不可能真把凭据设成纯 *，
      // 而放行它会把真凭据覆盖成星号串，等同静默清空。
      const isMasked =
        value === maskApiKey(stored) || /^\*+$/.test(value.trim());
      return [key, isMasked ? stored : value];
    })
  );
}
