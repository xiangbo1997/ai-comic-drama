/**
 * 音色分配（voice casting）—— 角色设定表驱动的自动选声。
 *
 * ## 为什么需要
 *
 * 此前只有「角色手动选了音色才用，没选就全用 provider 默认」。绝大多数用户
 * 不会逐个角色去配音色（那是个藏得很深的操作），所以典型成片是：旁白一个
 * 磁性男声，**所有角色——男的女的老的少的——全是同一个甜美女声**。
 * 这是听感上最刺耳的 AI 破绽，观众三秒内就能判定"这是 AI 做的"。
 *
 * ## 当前实现是「按性别分池轮转」，不是完整的三维矩阵
 *
 * 完整方案需要按 `gender × ageBand × timbre` 查表（少年音/御姐音/大叔音/
 * 萝莉音…），但当前音色池只有 6 条、且只标了 gender，年龄维度完全空白，
 * 扣掉旁白占用的 1 条后实际可分配只剩 5 条。矩阵建不起来。
 *
 * 所以先做能立刻生效的版本：**按性别分池 + 项目内轮转互斥**。
 * 效果是把「10 个角色 1 个声音」变成「10 个角色 5 个声音」——从 1 到 5 的
 * 提升，比将来从 5 到 10 更值钱。音色池扩容后，把 VOICE_CASTING_POOL 换成
 * 带 ageBand/timbre 标签的版本、把 pickVoice 换成三维查表即可，调用方不变。
 *
 * ## 落点：character-bible 落库时写回 Character.voiceId
 *
 * 不放在配音路径现算——那是每镜调用一次的热路径，同一角色在不同镜可能因
 * 「当时已占用集合」不同而算出不同结果，前 3 镜少年音、后 5 镜青年音。
 * 落库则天然幂等：算一次、存一次、所有下游只读。
 *
 * 系列剧跨集一致性天然成立：续集继承的是 ProjectCharacter 关联，指向同一条
 * Character 记录（不是复制角色），所以 voiceId 跨集共享。
 */

import { VOLCANO_NARRATOR_VOICE_ID } from "./tts-voice";

/** 可自动分配的音色（火山 Moon 系列）。旁白专用音色已排除，见下方过滤。 */
const VOICE_CASTING_POOL: ReadonlyArray<{
  id: string;
  name: string;
  gender: "male" | "female";
}> = [
  {
    id: "zh_female_shuangkuaisisi_moon_bigtts",
    name: "甜美女声",
    gender: "female",
  },
  {
    id: "zh_female_tianmeixiaoyuan_moon_bigtts",
    name: "温柔女声",
    gender: "female",
  },
  { id: "zh_female_linjie_moon_bigtts", name: "知性女声", gender: "female" },
  { id: "zh_male_chunhou_moon_bigtts", name: "磁性男声", gender: "male" },
  { id: "zh_male_yangguang_moon_bigtts", name: "阳光男声", gender: "male" },
  { id: "zh_male_wennuanahu_moon_bigtts", name: "温暖男声", gender: "male" },
];

/**
 * 旁白音色不参与角色分配 —— 否则某个角色会和说书人同声，
 * 观众分不清"这句是旁白还是这个人在说"。
 */
const ASSIGNABLE = VOICE_CASTING_POOL.filter(
  (v) => v.id !== VOLCANO_NARRATOR_VOICE_ID
);

const FEMALE_POOL = ASSIGNABLE.filter((v) => v.gender === "female");
const MALE_POOL = ASSIGNABLE.filter((v) => v.gender === "male");

/** 性别未知时的兜底池：两性音色交替，至少保证角色间互不相同 */
const UNKNOWN_POOL = ASSIGNABLE;

export interface CastingCharacter {
  /** 角色标识（用作返回 Map 的键） */
  id: string;
  /** 性别：识别 male/男/f/female/女 等常见写法；无法判定走兜底池 */
  gender?: string | null;
  /** 已有音色：非空则原样保留，不参与重新分配 */
  voiceId?: string | null;
}

/** 把各种性别写法归一到三态 */
function normalizeGender(raw?: string | null): "male" | "female" | "unknown" {
  const g = raw?.trim().toLowerCase();
  if (!g) return "unknown";
  if (g === "male" || g === "m" || g.includes("男")) return "male";
  if (g === "female" || g === "f" || g.includes("女")) return "female";
  return "unknown";
}

/**
 * 给一批角色分配音色。
 *
 * 策略：按性别取池 → 优先取本项目尚未占用的 → 全被占用则按序轮转复用
 * （角色数超过池子容量时必然复用，此时保证的是「尽量分散」而非「绝对不撞」）。
 *
 * @param characters 待分配角色；已有 voiceId 的会被跳过并计入已占用集合
 * @returns 仅包含**新分配**的 characterId → voiceId；已有音色的角色不在结果里
 */
export function assignVoices(
  characters: readonly CastingCharacter[]
): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  // 先收集已占用：用户手选的音色优先级最高，其他角色要避开它
  for (const c of characters) {
    if (c.voiceId?.trim()) used.add(c.voiceId.trim());
  }

  // 每个池独立的轮转游标，保证同性别角色依次取不同音色
  const cursors = { male: 0, female: 0, unknown: 0 };

  for (const c of characters) {
    if (c.voiceId?.trim()) continue; // 已有音色，不动

    const gender = normalizeGender(c.gender);
    const pool =
      gender === "female"
        ? FEMALE_POOL
        : gender === "male"
          ? MALE_POOL
          : UNKNOWN_POOL;

    if (pool.length === 0) continue; // 理论不可达（池非空），防御

    // 先找池里没被占用的
    const free = pool.find((v) => !used.has(v.id));
    const picked = free ?? pool[cursors[gender] % pool.length];

    cursors[gender] += 1;
    used.add(picked.id);
    assigned.set(c.id, picked.id);
  }

  return assigned;
}

/** 供 UI 展示：音色 id → 中文名 */
export function voiceDisplayName(voiceId?: string | null): string | null {
  if (!voiceId) return null;
  return VOICE_CASTING_POOL.find((v) => v.id === voiceId)?.name ?? null;
}

/** 可分配音色总数（供 UI 提示"角色数超过 N 时会有角色共用音色"） */
export const ASSIGNABLE_VOICE_COUNT = ASSIGNABLE.length;
