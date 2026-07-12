/**
 * 小说→剧本「外化转换」方法论 Prompt 层（单一真源）
 *
 * 规则来源：专业影视改编方法论（prose→screenplay 外化转换）蒸馏——小说的
 * 内心独白/心理叙述不能直切分镜，必须先路由到「可见动作 / 对白潜台词 / 旁白」
 * 三级承载，否则大段内心戏会退化成说教式旁白或人物动机崩塌（off-model）。
 * 由两条解析路径共享：
 *   (A) 服务层直连解析：script-parse.ts
 *   (B) Agent 解析路径：agent-prompts/script-parser.ts
 *
 * 设计原则：
 * - 只导出可组合的中文常量块 + 极小工具函数；由各消费者自行决定拼哪几块。
 * - 与 episode-structure.ts 的方法论块并列注入，二者互补（一治节奏、一治外化）。
 * - 旁白占比阈值（≤20-25%）与 narrative-review.ts 的「外化质量」评审维度对齐。
 */

/** 解析层 — 内心戏外化规则（把不可拍的心理活动改写成镜头语言） */
export const EXTERNALIZATION_RULES = `【内心戏外化（小说→剧本的核心改编工序，最高优先级）】
- 小说的内心独白 / 心理活动，优先转为「可见动作 / 表情 / 反应镜头」，而不是塞进旁白；旁白是最后手段。
- 散文心理 → 视觉手法映射（照此改写 description，别直译心理词）：
  · 紧张不安 → 摆弄手指 / 反复吞咽 / 抖腿，配浅景深特写 insert 镜。
  · 领悟真相 → 缓推特写（dolly_in）+ 关键线索物件的特写 insert，眼神骤然聚焦。
  · 回忆 / 闪回 → 闪回语法：去饱和调色 + 画幅或景别变化 + 音效提示，切勿用旁白复述往事。
  · 孤独 / 失落 → 大远景 + 负空间构图，人物被环境挤到画面一角。
  · 愤怒但隐忍 → 杯子重重放下 / 指节发白攥拳 / 面部肌肉紧绷特写，动作替代内心怒吼。
  · 时间流逝 → 用转场表现（叠化 / 匹配剪辑 / 光线由昼到夜 / 同机位场景陈设变化）。
  · 犹豫决断 → 手悬在门把 / 电话上停顿，特写手部的迟疑再落下。
  · 恐惧 → 呼吸急促的胸口特写 / 后退半步 / 瞳孔收缩，环境用低角度与阴影施压。
- description（画面描述）里禁止出现「他觉得 / 她想 / 意识到 / 内心 / 明白了 / 心里」这类不可拍摄的内心状态词——必须改写成镜头能拍到的外在行为、表情或环境。
- 每个场景应有一次情绪价值转变（+→− 或 −→+，如：安全→受威胁、羞辱→反击得势）；纯粹无转变的对话平场戏（talking-heads）要合并或删除，防止镜头停滞。`;

/** 解析层 — 旁白纪律（控制旁白占比，禁止旁白复述画面） */
export const NARRATION_DISCIPLINE_RULES = `【旁白纪律（旁白是最后手段，严控占比）】
- 旁白（narration）只在「画面拍不出、对白也无法自然承载」的信息时才保留（如跨越时空的交代、无角色在场的世界观补充）。
- 带旁白的分镜数应 ≤ 全部分镜数的 20-25%；超出说明外化没做够，回去把旁白改写成动作或对白。
- 禁止用旁白复述画面已经表现的内容：画面里角色已经在哭，旁白不要再说「她很伤心」；画面已是雨夜，旁白不要再念「那是一个下雨的夜晚」。
- 优先把叙述性信息转成两条出路：① 落到「角色的一个动作」上；② 改写成「另一个在场角色能听到的、带潜台词的对白」（话里有话，而非直白说明）。
- 如果一段旁白既非画面不可承载、又能改成动作或对白，就必须删除或改写，不得原样保留。`;

/**
 * 组合出「外化转换」方法论块（内心戏外化 + 旁白纪律）。
 * 默认全含；消费者可按需只取其中一块。
 */
export function buildAdaptationBlock(opts?: {
  includeExternalization?: boolean;
  includeNarrationDiscipline?: boolean;
}): string {
  const includeExternalization = opts?.includeExternalization ?? true;
  const includeNarrationDiscipline = opts?.includeNarrationDiscipline ?? true;
  const blocks: string[] = [];
  if (includeExternalization) blocks.push(EXTERNALIZATION_RULES);
  if (includeNarrationDiscipline) blocks.push(NARRATION_DISCIPLINE_RULES);
  return blocks.join("\n\n");
}
