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

  // 输入合法性校验：密文至少要能容纳 authTag（32 hex）+ 至少 1 字节数据。
  // 密文损坏 / 密钥轮换 / 空串时提前抛可识别错误，让调用方降级为「配置不可用」，
  // 而非把 authTag 截成不足长度后由 decipher.final() 抛不透明的 crypto 错。
  const AUTH_TAG_HEX_LEN = AUTH_TAG_LENGTH * 2;
  if (
    typeof encrypted !== "string" ||
    encrypted.length <= AUTH_TAG_HEX_LEN ||
    !/^[0-9a-fA-F]+$/.test(encrypted) ||
    !/^[0-9a-fA-F]+$/.test(iv)
  ) {
    throw new Error("密文格式非法或已损坏（无法解密）");
  }

  // 分离加密数据和认证标签
  const authTagHex = encrypted.slice(-AUTH_TAG_HEX_LEN);
  const encryptedData = encrypted.slice(0, -AUTH_TAG_HEX_LEN);
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

// ============ UserAIConfig.extraConfig 敏感字段加密（at-rest） ============
//
// 背景：apiKey 走上面的 encrypt/decrypt 落库，但同一行的 extraConfig（jsonb）
// 里塞着同等级别的凭据——火山 accessToken、百度 secretKey、各家 apiSecret /
// appSecret，此前全是明文，一次库泄露 / 备份外流即全量失守。
//
// 策略：只加密「敏感键」的字符串值，非敏感键（appId / refAudioPath / region）
// 原样保留，保证 jsonb 仍可读、可排查。敏感判据 isSensitiveExtraKey 是单一真源，
// 加密（本文件）与 GET 掩码（api/ai-models/configs/extra-config-mask）共用。
//
// 密文自描述格式（冒号分隔三段）：
//
//     enc:v1:<iv_hex>:<ciphertext_hex + authTag_hex>
//
// 前缀让 decryptExtraConfig 能区分「本次加密写入的值」与「历史明文行」：线上
// 存量行不做迁移，读到无前缀的值直接原样透传，该行被重新保存时自动升级为密文。
// 判据是前缀而非「解密是否成功」，避免把恰好长得像 hex 的明文误解密。

/** 显式敏感键名单（大小写敏感，覆盖各 provider 的既有命名） */
const SENSITIVE_EXTRA_KEYS = [
  "accessToken",
  "secretKey",
  "apiSecret",
  "token",
  "appSecret",
];

/** 兜底模式：任何含 secret / token 或以 key 结尾的键都按凭据处理 */
const SENSITIVE_EXTRA_KEY_PATTERN = /secret|token|key$/i;

/** 判定 extraConfig 的某个键是否承载凭据（掩码与加密共用的单一真源） */
export function isSensitiveExtraKey(key: string): boolean {
  return (
    SENSITIVE_EXTRA_KEYS.includes(key) || SENSITIVE_EXTRA_KEY_PATTERN.test(key)
  );
}

/** 密文前缀（含版本号，便于将来换算法时新旧并存） */
const EXTRA_CIPHER_PREFIX = "enc:v1:";

/**
 * extraConfig 的值域：扁平的标量映射。
 * UserAIConfig.extraConfig 在表单层就是一组 key→字符串输入，历史行里偶有
 * 布尔 / 数字 / null；不存在嵌套对象或数组。显式约束成标量后，返回值可直接
 * 写入 Prisma 的 jsonb 字段而无需类型断言。
 */
export type ExtraConfigRecord = Record<
  string,
  string | number | boolean | null
>;

/** 把 unknown 收敛为扁平标量对象；非对象 / 数组返回 null（调用方另行处理） */
function asPlainObject(value: unknown): ExtraConfigRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    ([, v]) =>
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
  ) as [string, string | number | boolean | null][];
  return Object.fromEntries(entries);
}

/** 判定某个值是否为本模块产出的密文（历史明文一律 false） */
export function isEncryptedExtraValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(EXTRA_CIPHER_PREFIX);
}

/** 单值加密：拼成 enc:v1:<iv>:<ciphertext> 自描述串 */
function encryptExtraValue(plain: string): string {
  const { encrypted, iv } = encrypt(plain);
  return `${EXTRA_CIPHER_PREFIX}${iv}:${encrypted}`;
}

/**
 * 单值解密：解析 enc:v1:<iv>:<ciphertext>。
 * 格式不完整或解密失败时抛错，由 decryptExtraConfig 决定降级策略。
 */
function decryptExtraValue(cipher: string): string {
  const rest = cipher.slice(EXTRA_CIPHER_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) {
    throw new Error("extraConfig 密文格式非法（缺少 IV 分隔符）");
  }
  return decrypt(rest.slice(separator + 1), rest.slice(0, separator));
}

/**
 * 落库前加密：仅对敏感键的非空字符串值加密；已是密文的值不重复加密（幂等）。
 *
 * 返回值收窄为 Record<string, unknown>：调用方直接写 Prisma jsonb 字段，
 * 返回 unknown 会逼调用方加类型断言。非对象入参（null/数组/标量）视为「没有
 * 可加密内容」，返回 undefined 让调用方按「不更新该字段」处理。
 *
 * @param extraConfig 待落库的 extraConfig（明文或明文/密文混合）
 * @returns 敏感值已密文化的同形对象；非对象输入返回 undefined
 */
export function encryptExtraConfig(
  extraConfig: unknown
): ExtraConfigRecord | undefined {
  const source = asPlainObject(extraConfig);
  if (!source) return undefined;

  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      if (
        !isSensitiveExtraKey(key) ||
        typeof value !== "string" ||
        value.length === 0 ||
        isEncryptedExtraValue(value)
      ) {
        return [key, value];
      }
      return [key, encryptExtraValue(value)];
    })
  );
}

/**
 * 读取后解密：带 enc:v1: 前缀的值还原为明文，历史明文原样透传。
 *
 * 解密失败（密钥轮换 / 密文损坏）时把该值降级为空串而非抛错：让下游按
 * 「该字段未配置」处理并给出可诊断的失败，而不是整个配置加载 500。
 *
 * 返回值收窄为 Record<string, unknown>：非对象入参（null / 数组 / 标量）
 * 一律返回 undefined，即「该配置没有 extraConfig」，与库中 null 语义一致。
 *
 * @param extraConfig 库中取出的 Json 值
 * @returns 敏感值已还原为明文的同形对象；非对象输入返回 undefined
 */
export function decryptExtraConfig(
  extraConfig: unknown
): ExtraConfigRecord | undefined {
  const source = asPlainObject(extraConfig);
  if (!source) return undefined;

  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      if (!isEncryptedExtraValue(value)) return [key, value];
      try {
        return [key, decryptExtraValue(value)];
      } catch {
        return [key, ""];
      }
    })
  );
}
