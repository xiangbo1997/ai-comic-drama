import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_LENGTH = 16;

// 从环境变量获取加密密钥（32 字节 = 64 个十六进制字符）
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  if (key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(key, "hex");
}

/**
 * 加密文本
 * @param text 要加密的明文
 * @returns 加密后的数据和 IV
 */
export function encrypt(text: string): { encrypted: string; iv: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  // 获取认证标签并附加到加密数据末尾
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted + authTag.toString("hex"),
    iv: iv.toString("hex"),
  };
}

/**
 * 解密文本
 * @param encrypted 加密的数据（包含认证标签）
 * @param iv 初始化向量
 * @returns 解密后的明文
 */
export function decrypt(encrypted: string, iv: string): string {
  const key = getEncryptionKey();

  // 分离加密数据和认证标签
  const authTagHex = encrypted.slice(-AUTH_TAG_LENGTH * 2);
  const encryptedData = encrypted.slice(0, -AUTH_TAG_LENGTH * 2);
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 生成新的加密密钥（用于初始化）
 * @returns 64 个十六进制字符的密钥
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * 掩码显示 API Key（只显示前后几位）
 * @param apiKey 原始 API Key
 * @param showChars 前后显示的字符数
 * @returns 掩码后的字符串
 */
export function maskApiKey(apiKey: string, showChars: number = 4): string {
  if (apiKey.length <= showChars * 2) {
    return "*".repeat(apiKey.length);
  }
  const start = apiKey.slice(0, showChars);
  const end = apiKey.slice(-showChars);
  const middle = "*".repeat(Math.min(apiKey.length - showChars * 2, 8));
  return `${start}${middle}${end}`;
}
