import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildCharacterRosterPrompt,
  CHARACTER_ROSTER_SYSTEM,
  normalizeRosterGender,
  filterRosterByNames,
  type CharacterRosterInput,
  type RosterProfileRaw,
} from "@/lib/prompts/character-roster";
import { parseLooseJSON } from "@/lib/json-repair";

function makeInput(
  overrides: Partial<CharacterRosterInput> = {}
): CharacterRosterInput {
  return {
    names: ["林烬", "苏晚"],
    worldview: "架空的苍潮界，一条失落航路埋着惊天秘密。",
    protagonist: "林烬，被家族背叛的天才炼丹师",
    scenesDigest: "开场：林烬立于崖边\n林烬：我一定会回来",
    ...overrides,
  };
}

describe("normalizeRosterGender", () => {
  it("male 系列 → male", () => {
    expect(normalizeRosterGender("male")).toBe("male");
    expect(normalizeRosterGender("男")).toBe("male");
    expect(normalizeRosterGender("m")).toBe("male");
  });

  it("female 系列 → female", () => {
    expect(normalizeRosterGender("female")).toBe("female");
    expect(normalizeRosterGender("女")).toBe("female");
    expect(normalizeRosterGender("f")).toBe("female");
  });

  it("大小写 / 首尾空白不敏感", () => {
    expect(normalizeRosterGender("  MALE ")).toBe("male");
    expect(normalizeRosterGender("Female")).toBe("female");
    expect(normalizeRosterGender(" M ")).toBe("male");
  });

  it("空串 / 乱值 → 空串", () => {
    expect(normalizeRosterGender("")).toBe("");
    expect(normalizeRosterGender("   ")).toBe("");
    expect(normalizeRosterGender("unknown")).toBe("");
    expect(normalizeRosterGender("其他")).toBe("");
  });
});

describe("buildCharacterRosterPrompt", () => {
  it("包含所有角色名与世界观", () => {
    const prompt = buildCharacterRosterPrompt(makeInput());
    expect(prompt).toContain("林烬");
    expect(prompt).toContain("苏晚");
    expect(prompt).toContain("架空的苍潮界");
    // 输出 JSON 模板字段名
    expect(prompt).toContain("gender");
    expect(prompt).toContain("age");
    expect(prompt).toContain("description");
    // gender 二选一约束
    expect(prompt).toContain("male");
    expect(prompt).toContain("female");
  });

  it("有 protagonist / scenesDigest 时注入；无则不注入", () => {
    const withAll = buildCharacterRosterPrompt(makeInput());
    expect(withAll).toContain("主角身份");
    expect(withAll).toContain("场景摘要");

    const bare = buildCharacterRosterPrompt(
      makeInput({ protagonist: undefined, scenesDigest: undefined })
    );
    expect(bare).not.toContain("主角身份");
    expect(bare).not.toContain("场景摘要");
    // 无 protagonist/scenesDigest 时仍能正常构建（不炸）
    expect(bare).toContain("林烬");
  });

  it("超长 worldview 被截断（≤2000 + 省略号标记）", () => {
    const longWorldview = "设".repeat(5000);
    const prompt = buildCharacterRosterPrompt(
      makeInput({ worldview: longWorldview })
    );
    expect(prompt).toContain("已截断");
    // 未把全部 5000 字原样带入
    expect(prompt).not.toContain("设".repeat(2500));
  });

  it("超长 scenesDigest 被截断（≤3000 + 省略号标记）", () => {
    const longDigest = "镜".repeat(5000);
    const prompt = buildCharacterRosterPrompt(
      makeInput({ scenesDigest: longDigest })
    );
    expect(prompt).toContain("已截断");
    expect(prompt).not.toContain("镜".repeat(3500));
  });

  it("system prompt 声明只输出 JSON", () => {
    expect(CHARACTER_ROSTER_SYSTEM).toContain("JSON");
  });
});

describe("filterRosterByNames（按请求 names 过滤 + 归一 gender）", () => {
  it("只保留请求 names 内的条目，剔除 LLM 编造的多余角色", () => {
    const raw: RosterProfileRaw[] = [
      { name: "林烬", gender: "male", age: "24", description: "天才炼丹师" },
      { name: "苏晚", gender: "女", age: "22", description: "神秘少女" },
      { name: "无关路人", gender: "male", age: "40", description: "多余" },
    ];
    const result = filterRosterByNames(["林烬", "苏晚"], raw);
    expect(result.map((r) => r.name)).toEqual(["林烬", "苏晚"]);
  });

  it("gender 被归一化（女→female / 乱值→空串）", () => {
    const raw: RosterProfileRaw[] = [
      { name: "苏晚", gender: "女", age: "22", description: "少女" },
      { name: "林烬", gender: "unknown", age: "24", description: "炼丹师" },
    ];
    const result = filterRosterByNames(["林烬", "苏晚"], raw);
    const byName = new Map(result.map((r) => [r.name, r]));
    expect(byName.get("苏晚")?.gender).toBe("female");
    expect(byName.get("林烬")?.gender).toBe("");
  });

  it("trim 后精确匹配（含前后空白的 name / requestedName）", () => {
    const raw: RosterProfileRaw[] = [
      { name: " 林烬 ", gender: "male", age: "24", description: "炼丹师" },
    ];
    const result = filterRosterByNames([" 林烬"], raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("林烬");
  });

  it("同名重复只留第一条（LLM 偶发重复输出）", () => {
    const raw: RosterProfileRaw[] = [
      { name: "林烬", gender: "male", age: "24", description: "第一条" },
      { name: "林烬", gender: "female", age: "99", description: "重复条" },
    ];
    const result = filterRosterByNames(["林烬"], raw);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("第一条");
  });

  it("空输出 → 空数组", () => {
    expect(filterRosterByNames(["林烬"], [])).toEqual([]);
  });
});

// 与路由 DraftSchema 保持一致（此处独立声明，测端到端解析行为）
const DraftSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string(),
        gender: z.string().catch("").default(""),
        age: z.string().catch("").default(""),
        description: z.string().catch("").default(""),
      })
    )
    .catch([])
    .default([]),
});

describe("character-roster DraftSchema 解析（含畸形 JSON 容错）", () => {
  it("解析规范 JSON", () => {
    const raw = JSON.stringify({
      characters: [
        { name: "林烬", gender: "male", age: "24", description: "炼丹师" },
        { name: "苏晚", gender: "female", age: "22", description: "少女" },
      ],
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.characters).toHaveLength(2);
    }
  });

  it("单条字段为 null 时回落空串，不整单挂", () => {
    const raw = JSON.stringify({
      characters: [
        { name: "林烬", gender: null, age: null, description: null },
      ],
    });
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      const c = result.data.characters[0];
      expect(c.gender).toBe("");
      expect(c.age).toBe("");
      expect(c.description).toBe("");
    }
  });

  it("容错 code fence + trailing comma", () => {
    const raw =
      '```json\n{"characters":[{"name":"张三","gender":"male","age":"30","description":"路人",},]}\n```';
    const result = DraftSchema.safeParse(parseLooseJSON(raw));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.characters[0].name).toBe("张三");
    }
  });
});
