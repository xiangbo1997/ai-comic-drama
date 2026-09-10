/**
 * MCP Prompt 注册（对话侧的引导流程）。
 *
 * 方法论不另写一套：爆款短剧的三道质检闸、五类钩子轮换、矛盾四级阶梯等规则，
 * 单一真源在 lib/prompts/episode-structure.ts 与 adaptation-rules.ts（同时供
 * 小说解析与短剧创作两条管线消费）。这里直接注入那些常量块，保证「对话里打磨
 * 剧本」和「服务端生成剧本」用的是同一把尺子。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  EPISODE_CONFLICT_RULES,
  buildEpisodeStructureBlock,
} from "@/lib/prompts/episode-structure";
import { buildAdaptationBlock } from "@/lib/prompts/adaptation-rules";

/** 注册全部引导 prompt */
export function registerPrompts(server: McpServer): void {
  // ------------------------------------------------------- 从零起一部新剧
  server.registerPrompt(
    "new-drama",
    {
      title: "创作一部新漫剧",
      description:
        "从一句话想法出发，走完「世界观 → 项目 → 剧本 → 分镜」的完整流程",
      argsSchema: z.object({
        idea: z.string().describe("一句话故事想法"),
        genre: z.string().optional().describe("题材倾向（可选）"),
      }),
    },
    ({ idea, genre }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `我想做一部漫剧短剧，想法是：${idea}${
              genre ? `\n题材倾向：${genre}` : ""
            }

请按下面的顺序陪我完成剧本工作台环节（视觉环节我到网页端做）：

1. 用 draft_worldview 起草世界观、主角、题材、片名。**先把结果给我确认**，我可能要改。
2. 我确认后，用 create_project 建项目。
3. 用 generate_drama_script 生成结构化剧本（这步约 1-2 分钟）。
4. 拿到剧本后，**先按下面的标准自审一遍**，把不过关的地方指出来并给出修改建议，而不是直接说"完成了"：

${EPISODE_HOOK_RULES}

${EPISODE_ENDING_RULES}

5. 我认可剧本后，用 script_to_storyboard 落库成分镜，并把 editorUrl 给我。

注意：出图、配音、视频、导出都在网页端完成，你不需要（也无法）代劳。`,
          },
        },
      ],
    })
  );

  // ---------------------------------------------------------- 打磨已有剧本
  server.registerPrompt(
    "polish-script",
    {
      title: "打磨剧本",
      description:
        "载入指定项目的剧本，按爆款短剧方法论（钩子/节奏/冲突阶梯）做定向诊断与修改建议",
      argsSchema: z.object({
        projectId: z.string().describe("要打磨的项目 id"),
        focus: z
          .string()
          .optional()
          .describe("想重点打磨的方面，如「开场太平」「结尾没钩子」"),
      }),
    },
    ({ projectId, focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `请帮我打磨项目 ${projectId} 的剧本。

先读这两个资源了解现状：
- comic://project/${projectId}（项目设定）
- comic://project/${projectId}/storyboard（分镜表）
${focus ? `\n我想重点解决：${focus}\n` : ""}
然后**逐条对照下面的标准做诊断**——每条明确判定「过 / 不过」，不过的要指出具体是哪一镜、哪句台词的问题，并给出可直接替换的改法。不要泛泛地说"可以更紧凑"。

${EPISODE_HOOK_RULES}

${EPISODE_PACING_RULES}

${EPISODE_ENDING_RULES}

${EPISODE_CONFLICT_RULES}

${buildAdaptationBlock()}

诊断完成后，如果我认可你的修改方案，再讨论怎么落地（重新生成剧本或我手动改）。`,
          },
        },
      ],
    })
  );

  // ------------------------------------------------------------ 起草下一集
  server.registerPrompt(
    "next-episode",
    {
      title: "起草下一集",
      description:
        "载入系列故事圣经与上一集结尾钩子，在保持连续性的前提下起草下一集",
      argsSchema: z.object({
        seriesId: z.string().describe("系列 id"),
      }),
    },
    ({ seriesId }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `我要给系列 ${seriesId} 写下一集。

先读 comic://series/${seriesId}，重点看：
- storyBible 里的主题锁、未解决伏笔、角色状态（这是跨集记忆，不能自相矛盾）
- 已有剧集列表，确认下一集是第几集
- 最近几集用过的钩子类型

然后按下面的规则起草本集大纲，**在动手调用工具前先把大纲给我看**：

${EPISODE_ENDING_RULES}

${EPISODE_CONFLICT_RULES}

${buildEpisodeStructureBlock({ includeShotRhythm: false })}

额外要求：
- 本集开头要承接上一集的结尾钩子，但**不要立即完全化解**它。
- 必须推进至少一条未解决伏笔，或给出新的伏笔。
- 钩子类型要和最近 3 集不同。

大纲我认可后，再用 create_project + generate_drama_script 落地。`,
          },
        },
      ],
    })
  );
}
