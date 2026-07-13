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
 * - 项目角色名出现在场景文本中时写入 characters，由后端匹配
 *   selectedCharacterId（出图角色一致性）
 */

import type {
  DramaScriptArtifact,
  StoryboardCell,
  StoryboardTableArtifact,
} from "@/types";
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
  [key: string]: unknown;
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

    const dialogue = scene.dialogue ?? cell?.dialogue ?? null;
    const narration = scene.narration ?? null;

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
      characters: matchCharacters(
        characterNames,
        scene.title,
        scene.description,
        dialogue,
        scene.narration
      ),
      // 地点标签：短剧场景标题即地点/场景名，规整为 locationKey 供场景锚定分组
      locationKey: deriveLocationKey(scene.title),
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
