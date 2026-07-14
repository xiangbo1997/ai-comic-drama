/**
 * POST /api/projects/[id]/locations/describe
 *
 * AI 补全地点/描述（计划 §5 · 2.2）：纯文本 LLM 辅助，不扣积分
 * （与 assist 起草路由族一致，见 worldview-draft / suggest-links）。
 *
 * 两步（labelMissing=true 时先做第 1 步）：
 *  1) 存量补跑：为 locationKey 为空的分镜批量指派地点标签（一次 LLM，updateMany 写回）。
 *     这是计划里「AI 识别场景地点」的存量入口。
 *  2) 地点描述：为「无 ProjectLocation 行或行无描述」的地点各写一句环境描述（一次 LLM），
 *     upsert 到 ProjectLocation。
 *
 * 返回 { labeled, described }：本次打标的分镜数、写入描述的地点数，供 UI 提示。
 * 部分成功：第 1 步（打标）已提交事务，第 2 步（描述）解析失败时，不再整体 502，
 * 而是返回 200 + { labeled, described: 0, describeError }——labels 已落库，UI 应刷新
 * 并提示「地点已打标，描述生成失败，可重试」，而非误报为整体失败（见 LocationsDialog）。
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserLLMConfig } from "@/lib/ai-config";
import { rateLimiters, rateLimitHeaders } from "@/lib/rate-limit";
import { chatCompletion } from "@/services/ai";
import {
  buildLabelPrompt,
  parseLabelOutput,
  LABEL_SYSTEM,
  buildDescribePrompt,
  parseDescribeOutput,
  DESCRIBE_SYSTEM,
  type LabelScene,
  type DescribeTarget,
} from "@/services/generation/location-plate";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:projects:[id]:locations:describe");

interface RouteParams {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  // 存量补跑开关：true 时先为 locationKey 为空的分镜指派地点标签
  labelMissing: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const rl = await rateLimiters.imageGeneration(request, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", retryAfter: rl.retryAfter },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    const labelMissing = parsed.success ? parsed.data.labelMissing : false;

    const llmConfig = await getUserLLMConfig(userId);
    if (!llmConfig) {
      return NextResponse.json(
        { error: "请先在「设置 > AI 模型配置」中配置大语言模型" },
        { status: 400 }
      );
    }

    let labeled = 0;

    // ===== 第 1 步（可选）：为未标注地点的分镜批量指派 locationKey =====
    if (labelMissing) {
      const unlabeled = await prisma.scene.findMany({
        where: {
          projectId: id,
          OR: [{ locationKey: null }, { locationKey: "" }],
        },
        orderBy: { order: "asc" },
        select: { id: true, order: true, description: true },
      });

      if (unlabeled.length > 0) {
        const raw = await chatCompletion(
          [
            { role: "system", content: LABEL_SYSTEM },
            {
              role: "user",
              content: buildLabelPrompt(unlabeled as LabelScene[]),
            },
          ],
          { config: llmConfig, temperature: 0.3, maxTokens: 2048 }
        );

        let labels;
        try {
          labels = parseLabelOutput(raw, unlabeled as LabelScene[]);
        } catch (parseErr) {
          log.error("地点打标解析失败:", parseErr);
          return NextResponse.json(
            { error: "AI 返回格式异常，请重试" },
            { status: 502 }
          );
        }

        // 逐条写回（按分镜分组更新，一个事务）。数量有限（存量补跑），逐条 update 可接受。
        if (labels.length > 0) {
          await prisma.$transaction(
            labels.map((l) =>
              prisma.scene.update({
                where: { id: l.sceneId },
                data: { locationKey: l.locationKey },
              })
            )
          );
          labeled = labels.length;
        }
      }
    }

    // ===== 第 2 步：为缺描述的地点补一句环境描述 =====
    // 现有地点全集（分镜里非空 locationKey 去重）+ 已建行
    const scenes = await prisma.scene.findMany({
      where: { projectId: id },
      select: { locationKey: true, description: true },
    });
    const rows = await prisma.projectLocation.findMany({
      where: { projectId: id },
      select: { locationKey: true, description: true },
    });

    // 每地点收集分镜描述样本
    const samplesByKey = new Map<string, string[]>();
    for (const s of scenes) {
      const key = (s.locationKey ?? "").trim();
      if (!key) continue;
      const arr = samplesByKey.get(key) ?? [];
      if (s.description) arr.push(s.description);
      samplesByKey.set(key, arr);
    }

    // 已有描述的地点集合（跳过，不覆盖）
    const describedKeys = new Set(
      rows
        .filter((r) => (r.description ?? "").trim().length > 0)
        .map((r) => r.locationKey.trim())
    );

    const targets: DescribeTarget[] = [...samplesByKey.keys()]
      .filter((key) => !describedKeys.has(key))
      .map((key) => ({
        locationKey: key,
        sceneDescriptions: samplesByKey.get(key) ?? [],
      }));

    let described = 0;
    if (targets.length > 0) {
      const raw = await chatCompletion(
        [
          { role: "system", content: DESCRIBE_SYSTEM },
          { role: "user", content: buildDescribePrompt(targets) },
        ],
        { config: llmConfig, temperature: 0.4, maxTokens: 2048 }
      );

      let descriptions;
      try {
        descriptions = parseDescribeOutput(raw, targets);
      } catch (parseErr) {
        log.error("地点描述解析失败:", parseErr);
        // 部分成功：第 1 步打标已提交事务，此处仅描述解析失败。若已打标则返回
        // 200 + describeError（labels 已落库，UI 应刷新并提示可重试），否则整体 502。
        if (labeled > 0) {
          return NextResponse.json({
            labeled,
            described: 0,
            describeError: "AI 返回格式异常，请重试",
          });
        }
        return NextResponse.json(
          { error: "AI 返回格式异常，请重试" },
          { status: 502 }
        );
      }

      if (descriptions.length > 0) {
        await prisma.$transaction(
          descriptions.map((d) =>
            prisma.projectLocation.upsert({
              where: {
                projectId_locationKey: {
                  projectId: id,
                  locationKey: d.locationKey,
                },
              },
              create: {
                projectId: id,
                locationKey: d.locationKey,
                description: d.description,
              },
              update: { description: d.description },
            })
          )
        );
        described = descriptions.length;
      }
    }

    return NextResponse.json({ labeled, described });
  } catch (error) {
    log.error("Describe locations error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "补全地点/描述失败" },
      { status: 500 }
    );
  }
}
