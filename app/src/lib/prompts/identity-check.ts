/**
 * 属性级身份一致性校验 prompt（单一真源）
 *
 * 设计要点（对应 identity-verdict.ts 的判据）：
 * 1. 不问「是否保持身份」这类笼统问题 —— 强制逐维度表态（6 个维度各一条）。
 * 2. 非对称判据写进 prompt：明显换人/脸型体型明显不同/物种改变 = mismatch；
 *    轻微脏污、配饰小差异、光照色温变化 = minor（不算违规）。
 * 3. 把原始画面描述与换装标注喂进去，让模型区分「剧情有意变化」与「错误」。
 * 4. 固定 JSON 输出形状，解析失败即记「无法校验」，绝不静默放行。
 */

import type { IdentityAttribute } from "@/services/generation/identity-verdict";

/** 维度中文说明（同时作为 prompt 里的枚举清单与解析白名单的语义注释） */
export const IDENTITY_ATTRIBUTE_LABELS: Record<IdentityAttribute, string> = {
  face: "面部特征（五官比例、脸型、眼型、肤色）",
  bodyType: "体型身形（身高比例、胖瘦、体格）",
  hairstyle: "发型（长度、造型、刘海）",
  hairColor: "发色",
  outfit: "服装（款式、颜色、层次）",
  accessories: "配饰（眼镜、耳饰、武器、挂件）",
};

export const IDENTITY_CHECK_SYSTEM = [
  "你是专业的漫剧「角色一致性审查员」。你会看到两张图：第一张是角色的【权威定妆参考图】，第二张是【新生成的分镜画面】。",
  "你的任务不是给一个笼统的「像不像」结论，而是【逐属性】判定第二张图中的该角色是否与参考图一致。",
  "",
  "必须逐一判定以下 6 个属性维度（一个都不能漏）：",
  ...Object.entries(IDENTITY_ATTRIBUTE_LABELS).map(
    ([key, label]) => `- ${key}：${label}`
  ),
  "",
  "每个维度的判定只能取三个值，判定标准【不对称】，务必严格遵守：",
  '- "mismatch"（明显不一致）：仅用于——明显换成了另一个人、脸型或体型明显不同、物种/性别改变、发色完全变成另一种颜色、服装款式完全不同。',
  '- "minor"（轻微差异）：服装脏污或破损、配饰增减、光照与色温变化、画风笔触差异、角度造成的细微形变。这类差异【不算错误】。',
  '- "match"（一致）：该维度与参考图相符。',
  "宁可判 minor 也不要轻易判 mismatch —— 误判会触发无意义的重新生成。",
  "",
  "【剧情意图优先】：如果给出的画面描述或换装标注显示剧情【有意】让角色换装、战损、湿身、改变发型，那么对应维度即使与参考图不同，也必须判为 match，不要报错。",
  "",
  "严格只输出如下 JSON，不要任何解释或 markdown 代码块标记：",
  '{"attributes":[{"attribute":"face","judgement":"match","note":"理由≤40字"}]}',
  "attribute 只能取上面 6 个英文 key；judgement 只能取 match / minor / mismatch。",
].join("\n");

export interface IdentityCheckPromptArgs {
  characterName: string;
  /** 角色外貌文字描述（圣经 / Character.description），作为文字侧锚 */
  appearanceSummary?: string;
  /** 本镜画面描述（剧情意图判断依据） */
  sceneDescription?: string;
  /** 本镜换装标注（来自 Scene.characterOutfits，形如「战损铠甲」） */
  outfitNote?: string;
  /** 景别（特写要求最严，中景可放宽细节） */
  shotType?: string;
}

/** 构建用户侧 prompt。纯函数，导出供单测覆盖（剧情意图行的有/无分支）。 */
export function buildIdentityCheckPrompt(
  args: IdentityCheckPromptArgs
): string {
  const lines: string[] = [
    `待审查角色：${args.characterName}`,
    "第一张图 = 该角色的权威定妆参考图；第二张图 = 新生成的分镜画面。",
  ];

  if (args.shotType) {
    lines.push(
      `本镜景别：${args.shotType}（景别越远，细节差异越应判为 minor）`
    );
  }
  if (args.appearanceSummary?.trim()) {
    lines.push(`角色设定描述：${clamp(args.appearanceSummary, 200)}`);
  }

  // 剧情意图块：仅在有数据时拼入，防 prompt 膨胀
  const intent: string[] = [];
  if (args.sceneDescription?.trim()) {
    intent.push(`本镜画面描述：${clamp(args.sceneDescription, 180)}`);
  }
  if (args.outfitNote?.trim()) {
    intent.push(
      `本镜换装标注：${clamp(args.outfitNote, 60)}（属剧情需要，服装/配饰维度的对应差异必须判 match）`
    );
  }
  if (intent.length > 0) {
    lines.push("【剧情设定（用于区分有意变化与错误）】", ...intent);
  } else {
    lines.push("本镜无换装标注 —— 服装应与参考图一致。");
  }

  lines.push(
    "请按系统要求逐一判定 6 个属性维度，输出 JSON（attributes 数组必须含全部 6 项）。"
  );
  return lines.join("\n");
}

function clamp(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) : t;
}
