/**
 * LLM 输出 JSON 宽松解析
 *
 * LLM（DeepSeek / GPT / Claude / Gemini）输出 JSON 时常见的格式问题：
 * - trailing comma：`[1, 2, 3,]` 或 `{"a": 1,}`
 * - 中文智能引号：`{"name": "张三"}`（用了 " " 而非 " "）
 * - 单引号字符串：`{'a': 1}`
 * - 截断（输出超 maxTokens 被切）：JSON 不闭合
 * - 注释：`// 这是 ...` 或 `/* ... *\/`
 *
 * 本模块按"先严后宽"顺序尝试解析：
 * 1) 原生 JSON.parse 直接 OK → 0 成本
 * 2) 失败 → 应用一系列宽松规则后重试
 * 3) 仍失败 → 抛出原始 SyntaxError + 修复后片段（前 200 字）便于排查
 *
 * 设计取舍：
 * - 不引入 jsonrepair / JSON5 等外部依赖（保持零依赖、build size 不增）
 * - 不解决"语义级"错误（如 LLM 用 Number 类型给了 String 字段）—— 那是 Zod 的工作
 * - 修复只做"文本层"，不递归 walk AST
 *
 * 与 Zod 的协作：本函数返回 unknown，调用方仍需用 Zod schema 验证 shape。
 */

/**
 * 尝试解析一段可能不规范的 JSON 文本。
 *
 * @param text 来自 LLM 的原始字符串（可能含 markdown code fence、智能引号等）
 * @returns 解析后的 JS 对象/数组
 * @throws SyntaxError，message 包含修复后片段便于排查
 */
export function parseLooseJSON(text: string): unknown {
  // 步骤 1：提取候选 JSON 片段
  const candidate = extractJSONCandidate(text);

  // 步骤 2：尝试严格解析
  try {
    return JSON.parse(candidate);
  } catch {
    // 步骤 3：宽松修复后重试（严格错误已被 looseErr 信息覆盖，无需保留）
    const repaired = repairJSON(candidate);
    try {
      return JSON.parse(repaired);
    } catch (looseErr) {
      // 两次都失败 —— 抛出更有信息量的错误
      const snippet = repaired.slice(0, 200).replace(/\s+/g, " ");
      throw new SyntaxError(
        `JSON 解析失败（严格 + 宽松均不通过）：${
          looseErr instanceof Error ? looseErr.message : String(looseErr)
        }。修复后前 200 字符：${snippet}`
      );
    }
  }
}

/**
 * 解析 LLM 输出中的 JSON【数组】。
 *
 * 与 parseLooseJSON 的差别只在「契约」：调用方明确要一个数组，故这里在宽松解析
 * 之上再断言 Array.isArray，把「LLM 返回了对象/字符串」这类错误在此处拦下，
 * 而不是让调用方各自零散判断。
 *
 * 取代 suggest-links.ts / location-plate.ts 里两份逐字相同的 extractJsonArray：
 * 那两份只做 indexOf("[") + JSON.parse，对 trailing comma / 智能引号 / 单引号
 * 等常见 LLM 瑕疵一概崩溃；改走本函数即免费获得 repairJSON 的全部容错。
 *
 * @throws SyntaxError 解析失败，或解析结果不是数组
 */
export function parseLooseJSONArray(text: string): unknown[] {
  const parsed = parseLooseJSON(text);
  if (!Array.isArray(parsed)) {
    throw new SyntaxError(
      `LLM 输出解析后不是 JSON 数组（实际类型：${
        parsed === null ? "null" : typeof parsed
      }）`
    );
  }
  return parsed;
}

/**
 * 从可能含有 markdown / 散文 / code fence 的文本中提取 JSON 片段。
 * 优先级：```json``` 代码块 > ``` 代码块 > 裸的 {...} 或 [...]（取先出现者）
 */
function extractJSONCandidate(text: string): string {
  // 优先匹配 ```json ... ```（LLM 最常用的包装）
  const jsonFenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFenceMatch) return jsonFenceMatch[1].trim();

  // 退到普通 ``` ... ```
  const plainFenceMatch = text.match(/```\s*([\s\S]*?)```/);
  if (plainFenceMatch) return plainFenceMatch[1].trim();

  // 退到裸结构：取 { 与 [ 中【先出现】的那个作为起点。
  //
  // 必须比先后而非固定偏好 {：对象数组 `[{"a":1}]` 里 { 也存在，若无条件优先
  // 花括号就只会截出内层的 `{"a":1}`，把数组悄悄变成对象（parseLooseJSONArray
  // 会因此误报「不是数组」）。
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  const hasObject = firstBrace !== -1 && lastBrace > firstBrace;
  const hasArray = firstBracket !== -1 && lastBracket > firstBracket;

  if (hasObject && hasArray) {
    return firstBracket < firstBrace
      ? text.slice(firstBracket, lastBracket + 1)
      : text.slice(firstBrace, lastBrace + 1);
  }
  if (hasObject) return text.slice(firstBrace, lastBrace + 1);
  if (hasArray) return text.slice(firstBracket, lastBracket + 1);

  // 兜底：返回原文，让 JSON.parse 自己抛错
  return text.trim();
}

/**
 * 对 JSON 字符串做"文本层"修复。
 *
 * 修复规则（按出现频率排序）：
 * 1) 中文智能引号 → ASCII 引号
 * 2) 单引号 字符串 → 双引号字符串
 * 3) trailing comma：`,]` `,}` → `]` `}`
 * 4) 移除行注释 //... 和块注释 /\* ... *\/
 * 5) 控制字符（\x00-\x1F 除 \n \t）转义/移除
 *
 * 注意：每条规则都可能误伤合法内容（如字符串里的 ' 字符），
 * 这里采用"尽力而为"策略：失败时调用方会回退到原始 JSON.parse 错误。
 */
function repairJSON(text: string): string {
  let repaired = text;

  // 规则 1：智能引号 → ASCII 双引号
  // U+201C " / U+201D " / U+2018 ' / U+2019 ' / U+FF02 ＂ / U+FF07 ＇
  repaired = repaired.replace(/[“”＂]/g, '"').replace(/[‘’＇]/g, "'");

  // 规则 2：把"key 用单引号""字符串值用单引号"转成双引号
  //
  // 关键：必须先跳过【已经在双引号字符串内部】的区域，否则合法 JSON 里的
  // 撇号会被误配对改写 —— 例如 {"a":"it's fine","b":"o'clock"} 中的两个 '
  // 会被当成一对单引号字符串，产出 {"a":"it"s fine","b":"o"clock"}，把原本
  // 能解析的内容改坏。故用一个交替正则整体扫描：先吃掉完整的双引号串（原样
  // 保留），剩下的裸 'xxx' 才做替换。
  repaired = repaired.replace(
    /"(?:[^"\\]|\\.)*"|'([^'\\]*(?:\\.[^'\\]*)*)'/g,
    (match, inner: string | undefined) => {
      // 命中的是双引号字符串（inner 为 undefined）→ 原样保留，撇号不受影响
      if (inner === undefined) return match;
      // 内层若已包含未转义双引号，转换会破坏 JSON —— 跳过
      if (/(?<!\\)"/.test(inner)) return match;
      return `"${inner}"`;
    }
  );

  // 规则 3：trailing comma 在 ] 或 } 前
  repaired = repaired.replace(/,(\s*[\]}])/g, "$1");

  // 规则 4：去注释（// 到行尾，/* ... */ 块）
  // 注意：不能跨字符串边界，但简单实现先这样；LLM 输出极少在字符串里写 //
  repaired = repaired
    .replace(/\/\/[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // 规则 5：剥离不可见控制字符（保留 \t \n \r 因为合法 JSON 允许 \uXXXX）
  repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  return repaired;
}
