/**
 * 短剧脚本 → 分镜列表的结构化直转。
 *
 * 背景：短剧脚本（DramaScriptArtifact）本身就是结构化数据（场景/时长/对白/
 * 旁白/情绪），旧链路「应用为分镜原文 → 智能拆解分镜」把结构拍平成纯文本再让
 * LLM 重新解析回结构——多一次 LLM 调用、有漂移、九宫格打磨的镜头语言全程丢失。
 *
 * 本模块做确定性转换（零 LLM、零积分）：
 * - 脚本场景逐一映射为 Scene（POST /api/projects/[id]/scenes 契约）
 * - 若九宫格分镜表已生成/打磨，按 index 对位把镜头语言合入对应分镜
 *   （shot → shotType；特写要点并入画面描述；格内对白兜底场景对白）
 * - 登场角色写入 characters（LLM 场景声明 ∪ 项目角色名文本子串匹配），由后端
 *   匹配落库 selectedCharacterIds（全量，驱动 UI 自动选中与多角色一致性）与
 *   selectedCharacterId（首个，单角色锚点兼容）
 */

import type {
  DramaScriptArtifact,
  StoryboardCell,
  StoryboardTableArtifact,
} from "@/types";
import type { TransitionType } from "@/types/export-style";
import { computeShotDuration } from "@/lib/shot-timing";

/** POST /api/projects/[id]/scenes 接受的单镜字段（route 侧按此消费） */
export interface SceneDraft {
  shotType: string | null;
  description: string;
  dialogue: string | null;
  narration: string | null;
  emotion: string;
  duration: number;
  characters: string[];
  /** 地点标签：供场景锚定图（环境一致性）分组 */
  locationKey: string | null;
  /**
   * 镜头语言字段（全部可选）：短剧脚本 LLM 产出时透传，供出图/视频 prompt 增强电影感。
   * 与手动小说解析路径对齐（scenes 路由按同名字段落库）。脚本未产出时缺席即回落无约束。
   * 向后兼容：这些字段仅在 doc.scenes 携带时才出现，ProducerWizardDialog 等既有调用不受影响。
   */
  cameraAngle?: string;
  lighting?: string;
  composition?: string;
  colorPalette?: string;
  actionBeat?: string;
  cameraMovement?: string;
  /**
   * 出向转场类型（本镜 → 下一镜之间；剪辑节奏回归 · 批2）。
   * 由九宫格 cell.transition 中文词映射而来，供后端聚合为
   * generationParams.transitions。缺省不下传（缺席即回落硬切默认）。
   */
  transition?: TransitionType;
  /** 转场时长（秒）；闪白/闪黑短促（0.15s），叠化稍长（0.4s），硬切无时长 */
  transitionDuration?: number;
  [key: string]: unknown;
}

/**
 * 九宫格转场中文词 → TransitionType + 建议时长（秒）。
 *
 * 剪辑节奏回归（批2）：漫剧惯例硬切为主，闪白/闪黑留给情绪爆点，叠化仅用于
 * 时间流逝。LLM 产出的 transition 文案措辞多样（"硬切"/"直切"/"闪白"/"故障
 * 闪白"/"叠化"/"淡入"…），这里做确定性子串匹配收敛到白名单转场。
 * 未命中任何关键词 → undefined（缺席，后端回落硬切默认）。
 */
const TRANSITION_WORD_MAP: Array<{
  keywords: string[];
  type: TransitionType;
  duration: number;
}> = [
  // 闪白（情绪爆点 / 冲击）：短促 0.15s
  {
    keywords: ["闪白", "白闪", "爆闪", "flash white", "white flash"],
    type: "fadewhite",
    duration: 0.15,
  },
  // 闪黑 / 黑场（时空跳切 / 情绪落点）：短促 0.15s
  {
    keywords: ["闪黑", "黑闪", "黑场", "淡出", "fade black", "fade to black"],
    type: "fadeblack",
    duration: 0.15,
  },
  // 叠化 / 溶解（时间流逝）：稍长 0.4s
  {
    keywords: [
      "叠化",
      "溶解",
      "交叠",
      "dissolve",
      "crossfade",
      "cross dissolve",
    ],
    type: "dissolve",
    duration: 0.4,
  },
  // 淡入（片头 / 段落开场，近似黑场淡入）：0.4s
  { keywords: ["淡入", "fade in"], type: "fadeblack", duration: 0.4 },
  // 硬切 / 直切（默认，占比最高）：无时长（none 走极短近似）
  {
    keywords: ["硬切", "直切", "切", "hard cut", "cut"],
    type: "none",
    duration: 0,
  },
];

/**
 * 把九宫格 cell.transition 中文/英文措辞映射为 TransitionType（+建议时长）。
 * 空/未命中返回 null（后端据此不下发，回落硬切默认）。
 */
function mapTransitionWord(
  raw: string | null | undefined
): { type: TransitionType; duration: number } | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;
  for (const entry of TRANSITION_WORD_MAP) {
    if (entry.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return { type: entry.type, duration: entry.duration };
    }
  }
  return null;
}

/** 供后端/测试复用的映射入口（导出以便单测直接断言词表覆盖）。 */
export function resolveTransitionFromWord(
  raw: string | null | undefined
): { type: TransitionType; duration: number } | null {
  return mapTransitionWord(raw);
}

/**
 * 从短剧场景标题规整地点标签：短剧脚本 scene.title 本就是地点/场景名
 * （如 "天幕之下"、"删除程序启动"）。裁掉常见修饰后缀、限长 12 字，作为 locationKey。
 * 空标题回落 null（场景锚定分组自然退化为无约束）。
 */
function deriveLocationKey(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;
  return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
}

/** 场景文本中出现的项目角色名（确定性子串匹配，供后端挂 selectedCharacterId） */
function matchCharacters(
  characterNames: string[],
  ...texts: (string | null | undefined)[]
): string[] {
  const haystack = texts.filter(Boolean).join("\n");
  return characterNames.filter((name) => name && haystack.includes(name));
}

/**
 * 结构化直转：脚本（+可选九宫格）→ 分镜草稿数组。
 * 数组顺序即分镜顺序（后端按下标写 order）。
 */
export function dramaScriptToScenes(
  doc: DramaScriptArtifact,
  storyboard: StoryboardTableArtifact | null | undefined,
  characterNames: string[] = []
): SceneDraft[] {
  const cellByIndex = new Map<number, StoryboardCell>(
    (storyboard?.cells ?? []).map((c) => [c.index, c])
  );

  return (doc.scenes ?? []).map((scene) => {
    const cell = cellByIndex.get(scene.index);

    // 九宫格特写要点是镜头语言的一部分，并入画面描述增强出图 prompt
    const description = cell?.closeup
      ? `${scene.description}\n特写要点：${cell.closeup}`
      : scene.description;

    // 转场：九宫格 cell.transition 中文词 → TransitionType（剪辑节奏回归 · 批2）。
    // 命中即下传，供后端聚合为 generationParams.transitions；未命中缺席（回落硬切）。
    const transition = mapTransitionWord(cell?.transition);

    const dialogue = scene.dialogue ?? cell?.dialogue ?? null;
    const narration = scene.narration ?? null;

    // 登场角色：LLM 显式声明优先（能覆盖代词指代"他/她"），场景文本子串匹配兜底，
    // 去重保序（首个即单数锚点）。声明名与项目角色名不完全一致时，由 scenes 路由的
    // 三级模糊匹配收敛，未命中即忽略，不会误挂。
    const declaredCharacters = (scene.characters ?? [])
      .map((name) => name.trim())
      .filter(Boolean);
    const matchedCharacters = matchCharacters(
      characterNames,
      scene.title,
      scene.description,
      dialogue,
      scene.narration
    );

    return {
      shotType: cell?.shot || null,
      description,
      dialogue,
      narration,
      emotion: scene.emotion || "neutral",
      // 时长校准（断裂 C 修复）：短剧脚本路径同源走对白驱动时长，
      // 而非仅 clamp 脚本给的 durationSec。九宫格 shot 非标准五景别时，
      // computeShotDuration 有兜底（对白下限逻辑仍生效）。
      duration: computeShotDuration({
        dialogue,
        narration,
        shotType: cell?.shot ?? null,
        emotion: scene.emotion ?? null,
        llmDuration: scene.durationSec ?? null,
      }),
      characters: [...new Set([...declaredCharacters, ...matchedCharacters])],
      // 地点标签：短剧场景标题即地点/场景名，规整为 locationKey 供场景锚定分组
      locationKey: deriveLocationKey(scene.title),
      // 镜头语言透传：脚本携带则落库供出图/视频 prompt（scenes 路由按同名字段消费）。
      // 缺省字段不下传（`|| null` 兜底在 route 侧），保持产出对象干净且向后兼容。
      ...(scene.cameraAngle ? { cameraAngle: scene.cameraAngle } : {}),
      ...(scene.lighting ? { lighting: scene.lighting } : {}),
      ...(scene.composition ? { composition: scene.composition } : {}),
      ...(scene.colorPalette ? { colorPalette: scene.colorPalette } : {}),
      ...(scene.actionBeat ? { actionBeat: scene.actionBeat } : {}),
      ...(scene.cameraMovement ? { cameraMovement: scene.cameraMovement } : {}),
      // 转场（命中九宫格 transition 词才下传）：type + duration 供后端聚合。
      ...(transition
        ? {
            transition: transition.type,
            transitionDuration: transition.duration,
          }
        : {}),
    };
  });
}

/** 把结构化脚本拼成可读的分镜原文（回填输入框，保持原文与分镜同源） */
export function scriptToInputText(doc: DramaScriptArtifact): string {
  const header = `《${doc.filmTitle}》\n${doc.logline}\n`;
  const body = (doc.scenes ?? [])
    .map((s) => {
      const lines = [`场景${s.index} ${s.title}`, s.description];
      if (s.dialogue) lines.push(`对白：${s.dialogue}`);
      if (s.narration) lines.push(`旁白：${s.narration}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `${header}\n${body}`;
}
