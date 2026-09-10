/**
 * 系统运行时配置注册表（单一真源）
 *
 * 背景：初始积分、签到奖励、各类生成单价此前以 `const XXX_COST = 3` 散落在
 * 十来个 route 文件里，改价必须改代码 + 重新部署。这里把它们收成一份带类型/
 * 取值范围/分组的注册表，运行时值存 SystemConfig 表，缺行即回落到代码默认值。
 *
 * 三条约束（改动前先读）：
 * 1. **默认值即现值**：注册表里每个 default 都必须等于迁移前代码里的常量，
 *    保证「不配置 = 行为不变」，DB 里一行都没有时系统照常跑。
 * 2. **服务端专用**：本模块读 DB，只能在 server 组件 / route / service 里用。
 *    客户端的成本提示走 `GET /api/config/pricing`。
 * 3. **缓存有 TTL**：进程内缓存 60 秒，多实例部署下改配置最多 60 秒生效不齐，
 *    这对运营数值可接受；要立即生效就重启或等窗口过。
 */

import { Prisma } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = createLogger("lib:system-config");

/** 单个配置项的元信息：类型 + 分组 + 展示文案 + 取值范围 */
export interface SystemConfigDef {
  default: number | string | boolean;
  type: "int" | "number" | "string" | "boolean";
  label: string;
  group: "credits" | "pricing" | "limits" | "feature";
  min?: number;
  max?: number;
  description: string;
}

/**
 * 配置注册表。新增一项 = 在这里加一行 + 把消费方改成 getSystemConfig。
 *
 * 每项的 default 必须与迁移前代码里的字面量一致，注释里标了原出处，
 * 便于日后核对是否漂移。
 */
export const SYSTEM_CONFIG_DEFS = {
  // ---- credits：账号赠送与运营激励 ----
  INITIAL_CREDITS: {
    default: 300,
    type: "int",
    label: "注册初始积分",
    group: "credits",
    min: 0,
    max: 100000,
    description:
      "新用户注册时赠送的积分。schema 上 User.credits 的 @default(300) 保留为直插数据的兜底。",
  },
  CHECKIN_CREDITS: {
    default: 5,
    type: "int",
    label: "每日签到积分",
    group: "credits",
    min: 0,
    max: 10000,
    description: "用户每日签到获得的积分（api/user/checkin）。",
  },
  INVITE_REWARD: {
    default: 50,
    type: "int",
    label: "邀请奖励积分",
    group: "credits",
    min: 0,
    max: 10000,
    description:
      "邀请人与被邀请人各自获得的积分（双向激励，lib/auth.ts 与 api/user/invite 共用）。",
  },

  // ---- pricing：各类生成的积分单价 ----
  COST_IMAGE_NORMAL: {
    default: 1,
    type: "int",
    label: "图像生成（无参考图）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "单张普通图像生成的积分成本。",
  },
  COST_IMAGE_WITH_REF: {
    default: 3,
    type: "int",
    label: "图像生成（带参考图）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "带角色参考图的单张图像生成成本（一致性开销更高）。",
  },
  COST_THREE_VIEWS_PER_VIEW: {
    default: 3,
    type: "int",
    label: "角色三视图（每视角）",
    group: "pricing",
    min: 0,
    max: 10000,
    description:
      "角色定妆三视图按视角计价，总价 = 本值 × 视角数（当前 3 个）。",
  },
  COST_GRID_IMAGE: {
    default: 5,
    type: "int",
    label: "九宫格合成图",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "剧本九宫格分镜合成图的一次生成成本。",
  },
  COST_LOCATION_PLATE: {
    default: 1,
    type: "int",
    label: "场景锚图",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "单张场景锚图（location plate）的生成成本。",
  },
  COST_ANALYZE_SCENE: {
    default: 1,
    type: "int",
    label: "分镜 AI 分析",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "调用 LLM 分析单个分镜（动作/表情/构图）的成本。",
  },
  COST_GENERATE_DESCRIPTION: {
    default: 1,
    type: "int",
    label: "角色描述生成",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "AI 生成角色外貌描述的单次成本。",
  },
  COST_TTS_PER_100_CHARS: {
    default: 2,
    type: "int",
    label: "语音合成（每 100 字）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "TTS 按字数计价，成本 = ceil(字数 / 100) × 本值。",
  },
  COST_SCRIPT_PARSE_PER_1000_CHARS: {
    default: 1,
    type: "int",
    label: "剧本解析（每 1000 字）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "剧本解析按原文长度计价，成本 = ceil(字数 / 1000) × 本值。",
  },
  COST_SCRIPT_PARSE_MIN: {
    default: 2,
    type: "int",
    label: "剧本解析最低消费",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "剧本解析的保底积分，短文本也至少扣这么多。",
  },
  COST_VIDEO_TIER_5S: {
    default: 10,
    type: "int",
    label: "视频生成（5 秒档）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "视频按档位计价；多段视频总价为各段档位成本之和。",
  },
  COST_VIDEO_TIER_10S: {
    default: 20,
    type: "int",
    label: "视频生成（10 秒档）",
    group: "pricing",
    min: 0,
    max: 10000,
    description:
      "10 秒档成本。Veo 类不接受时长参数的模型，每段按本档计价（见 video-segmenter）。",
  },
  COST_VIDEO_TIER_15S: {
    default: 30,
    type: "int",
    label: "视频生成（15 秒档）",
    group: "pricing",
    min: 0,
    max: 10000,
    description: "15 秒档成本。",
  },

  // ---- feature：质量闭环开关（成本/耗时敏感，故做成可配置而非硬编码全开）----
  //
  // 四闭环里 imageConsistency 一直默认开（无开关，行为不变）；其余三个此前硬编码
  // enabled:false。这里把它们提为运维可调项，默认值按「额外 LLM 调用数 × 用户感知延迟」定：
  CLOSED_LOOP_CHARACTER_BIBLE: {
    default: true,
    type: "boolean",
    label: "闭环：角色圣经评审",
    group: "feature",
    description:
      "评分函数 reviewCharacterBible 是纯函数（零 LLM 调用、零积分、毫秒级），" +
      "仅在评分不达标时才重新生成圣经（上界 maxRounds=2，每轮 1 次 LLM）。" +
      "绝大多数项目一轮过，成本≈0，故默认开启。",
  },
  CLOSED_LOOP_STORYBOARD: {
    default: false,
    type: "boolean",
    label: "闭环：分镜叙事连贯评审",
    group: "feature",
    description:
      "每次 workflow 固定增加 1 次纯文本 LLM 调用（整套分镜摘要进 prompt，约 1-3k tokens），" +
      "当前实现只评分不重生成。会给用户感知路径增加数秒等待，收益仅为一条评分记录，故默认关闭。",
  },
  CLOSED_LOOP_VIDEO_COHERENCE: {
    default: false,
    type: "boolean",
    label: "闭环：视频连贯评审",
    group: "feature",
    description:
      "每次 workflow 固定增加 1 次纯文本 LLM 调用，只评分不重生成（视频重生成成本最高，未接）。" +
      "与分镜评审同理，默认关闭；需要采集质量数据时再开。",
  },
} as const satisfies Record<string, SystemConfigDef>;

/** 合法配置键 */
export type SystemConfigKey = keyof typeof SYSTEM_CONFIG_DEFS;

/** 某个键对应的运行时值类型（由 default 的字面量类型推导出基础类型） */
export type SystemConfigValue<K extends SystemConfigKey> =
  (typeof SYSTEM_CONFIG_DEFS)[K]["default"] extends number
    ? number
    : (typeof SYSTEM_CONFIG_DEFS)[K]["default"] extends boolean
      ? boolean
      : string;

/** 全部键的运行时值映射 */
export type SystemConfigMap = {
  [K in SystemConfigKey]: SystemConfigValue<K>;
};

/** 配置项对外形态（后台设置页用） */
export interface SystemConfigItem {
  key: SystemConfigKey;
  value: number | string | boolean;
  default: number | string | boolean;
  type: SystemConfigDef["type"];
  label: string;
  group: SystemConfigDef["group"];
  description: string;
  min?: number;
  max?: number;
  updatedAt: string | null;
}

/** 判断任意字符串是否合法配置键（收窄类型，供 API 层校验入参） */
export function isSystemConfigKey(key: string): key is SystemConfigKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_CONFIG_DEFS, key);
}

/** 全部键（稳定顺序：与注册表声明顺序一致） */
export function listSystemConfigKeys(): SystemConfigKey[] {
  return Object.keys(SYSTEM_CONFIG_DEFS) as SystemConfigKey[];
}

/**
 * 校验并归一化一个配置值（纯函数，无 IO；单测覆盖）。
 *
 * 数字接受字符串形式（表单提交天然是字符串），布尔接受 "true"/"false"，
 * 但都必须能无歧义转换——空串、NaN、"yes" 一律拒绝。
 */
export function validateSystemConfigValue(
  key: string,
  raw: unknown
):
  | { ok: true; value: number | string | boolean }
  | { ok: false; error: string } {
  if (!isSystemConfigKey(key)) {
    return { ok: false, error: `未知配置项：${key}` };
  }
  const def: SystemConfigDef = SYSTEM_CONFIG_DEFS[key];

  if (def.type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true") return { ok: true, value: true };
    if (raw === "false") return { ok: true, value: false };
    return { ok: false, error: `${def.label}：必须是布尔值` };
  }

  if (def.type === "string") {
    if (typeof raw !== "string") {
      return { ok: false, error: `${def.label}：必须是字符串` };
    }
    return { ok: true, value: raw };
  }

  // int / number：允许数字或可无歧义解析的字符串
  let num: number;
  if (typeof raw === "number") {
    num = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    num = Number(raw);
  } else {
    return { ok: false, error: `${def.label}：必须是数字` };
  }

  if (!Number.isFinite(num)) {
    return { ok: false, error: `${def.label}：必须是有效数字` };
  }
  if (def.type === "int" && !Number.isInteger(num)) {
    return { ok: false, error: `${def.label}：必须是整数` };
  }
  if (def.min !== undefined && num < def.min) {
    return { ok: false, error: `${def.label}：不能小于 ${def.min}` };
  }
  if (def.max !== undefined && num > def.max) {
    return { ok: false, error: `${def.label}：不能大于 ${def.max}` };
  }

  return { ok: true, value: num };
}

// ---- 进程内缓存 ----
//
// 一次性把整表读进来（表最多几十行），而不是逐键查：读配置的地方在热路径上
// （每次生成都要读单价），逐键查会给每次生成加一次 DB 往返。

/** 缓存存活时长（毫秒） */
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  values: SystemConfigMap;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
/** 并发去重：同一时刻只允许一次回源查询，其余等待同一个 Promise */
let inflight: Promise<SystemConfigMap> | null = null;

/** 全部键取默认值（DB 不可用时的兜底形态） */
function defaultsMap(): SystemConfigMap {
  const out: Record<string, number | string | boolean> = {};
  for (const key of listSystemConfigKeys()) {
    out[key] = SYSTEM_CONFIG_DEFS[key].default;
  }
  return out as SystemConfigMap;
}

/** 手动失效缓存（写配置后调用；测试亦可用） */
export function invalidateSystemConfigCache(): void {
  cache = null;
  inflight = null;
}

/** 回源：读全表，逐行校验，非法/缺失回落默认值 */
async function loadFromDb(): Promise<SystemConfigMap> {
  const values = defaultsMap();

  const rows = await prisma.systemConfig.findMany({
    select: { key: true, value: true },
  });

  for (const row of rows) {
    if (!isSystemConfigKey(row.key)) {
      // 注册表里已删除的历史键：保留行不删（可能是回滚需要），读取时忽略
      continue;
    }
    const parsed = validateSystemConfigValue(row.key, row.value);
    if (!parsed.ok) {
      log.warn(`系统配置 ${row.key} 的库内值非法，回落默认值：${parsed.error}`);
      continue;
    }
    // 类型已由 validateSystemConfigValue 按 def.type 校验过，
    // 与 SystemConfigMap 的推导一致，此处的赋值是安全的
    (values as Record<string, number | string | boolean>)[row.key] =
      parsed.value;
  }

  return values;
}

/** 取全部配置（带缓存）。DB 异常时整体回落默认值，不让配置读取拖垮业务。 */
export async function getSystemConfigs(): Promise<SystemConfigMap> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.values;
  }
  if (inflight) {
    return inflight;
  }

  inflight = loadFromDb()
    .then((values) => {
      cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
      return values;
    })
    .catch((error: unknown) => {
      log.warn("读取系统配置失败，本次回落默认值:", error);
      return defaultsMap();
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 取单个配置值（带缓存） */
export async function getSystemConfig<K extends SystemConfigKey>(
  key: K
): Promise<SystemConfigValue<K>> {
  const all = await getSystemConfigs();
  return all[key];
}

/**
 * 写入一个配置项。校验失败抛 Error（调用方转 400）。
 *
 * 返回变更前后的值，供审计日志记 before/after。
 */
export async function setSystemConfig(
  key: string,
  value: unknown,
  updatedById: string
): Promise<{
  key: SystemConfigKey;
  before: number | string | boolean;
  after: number | string | boolean;
}> {
  const parsed = validateSystemConfigValue(key, value);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  // isSystemConfigKey 已在 validateSystemConfigValue 内校验通过
  const typedKey = key as SystemConfigKey;

  const before = await getSystemConfig(typedKey);

  await prisma.systemConfig.upsert({
    where: { key: typedKey },
    create: {
      key: typedKey,
      value: parsed.value as Prisma.InputJsonValue,
      description: SYSTEM_CONFIG_DEFS[typedKey].description,
      updatedById,
    },
    update: {
      value: parsed.value as Prisma.InputJsonValue,
      updatedById,
    },
  });

  invalidateSystemConfigCache();

  return { key: typedKey, before, after: parsed.value };
}

/**
 * 视频档位单价表（供 services/generation/video-segmenter 的 estimateVideoCost）。
 *
 * 单独给一个 helper 而不是让调用方各自拼 Record：档位键（5/10/15）与配置键的
 * 对应关系只此一处，加档位时不用去 grep 每个调用点。
 */
export async function getVideoTierCosts(): Promise<Record<number, number>> {
  const config = await getSystemConfigs();
  return {
    5: config.COST_VIDEO_TIER_5S,
    10: config.COST_VIDEO_TIER_10S,
    15: config.COST_VIDEO_TIER_15S,
  };
}

/** 列出全部配置项（含当前值与元信息），供后台设置页与定价接口使用 */
export async function listSystemConfigItems(): Promise<SystemConfigItem[]> {
  const [values, rows] = await Promise.all([
    getSystemConfigs(),
    prisma.systemConfig
      .findMany({ select: { key: true, updatedAt: true } })
      .catch((error: unknown) => {
        log.warn("读取系统配置更新时间失败，updatedAt 置空:", error);
        return [] as Array<{ key: string; updatedAt: Date }>;
      }),
  ]);

  const updatedAtByKey = new Map(rows.map((r) => [r.key, r.updatedAt]));

  return listSystemConfigKeys().map((key) => {
    const def: SystemConfigDef = SYSTEM_CONFIG_DEFS[key];
    return {
      key,
      value: values[key],
      default: def.default,
      type: def.type,
      label: def.label,
      group: def.group,
      description: def.description,
      min: def.min,
      max: def.max,
      updatedAt: updatedAtByKey.get(key)?.toISOString() ?? null,
    };
  });
}
