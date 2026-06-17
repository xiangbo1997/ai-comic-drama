import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:projects:[id]");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个项目详情
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        scenes: {
          orderBy: { order: "asc" },
          include: {
            sceneCharacters: {
              include: {
                character: true,
              },
            },
            selectedCharacter: {
              select: {
                id: true,
                name: true,
                referenceImages: true,
              },
            },
          },
        },
        characters: {
          include: {
            character: {
              include: {
                // 三视图等参考资产，供生视频多参考锁形象
                referenceAssets: {
                  orderBy: { createdAt: "desc" },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    log.error("Get project error:", error);
    return NextResponse.json(
      { error: "Failed to get project" },
      { status: 500 }
    );
  }
}

// 更新项目
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      description,
      status,
      style,
      aspectRatio,
      inputText,
      generationParams,
    } = body;

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 校验 generationParams：只接受已知字段 + 合理范围
    const normalizedGenParams =
      generationParams !== undefined
        ? normalizeGenerationParams(generationParams)
        : undefined;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(style !== undefined && { style }),
        ...(aspectRatio !== undefined && { aspectRatio }),
        ...(inputText !== undefined && { inputText }),
        ...(normalizedGenParams !== undefined && {
          generationParams: normalizedGenParams as Prisma.InputJsonValue,
        }),
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    log.error("Update project error:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

/**
 * 白名单 + 范围校验 generationParams，防止任意 JSON 落库。
 * 返回 Prisma 可接受的 plain object。
 */
function normalizeGenerationParams(
  input: unknown
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof src.temperature === "number") {
    out.temperature = clampNumber(src.temperature, 0, 1.5);
  }
  if (typeof src.topP === "number") {
    out.topP = clampNumber(src.topP, 0, 1);
  }
  if (typeof src.styleStrength === "number") {
    out.styleStrength = clampNumber(src.styleStrength, 0, 1);
  }
  if (
    typeof src.negativePreset === "string" &&
    src.negativePreset.length <= 32
  ) {
    out.negativePreset = src.negativePreset;
  }
  if (
    typeof src.customNegative === "string" &&
    src.customNegative.length <= 1000
  ) {
    out.customNegative = src.customNegative;
  }
  // 字幕样式（全片统一）：校验后整体放行
  if (src.subtitleStyle && typeof src.subtitleStyle === "object") {
    const ss = src.subtitleStyle as Record<string, unknown>;
    const positions = ["top", "middle", "bottom"];
    out.subtitleStyle = {
      fontSize:
        typeof ss.fontSize === "number" ? clampNumber(ss.fontSize, 8, 96) : 24,
      fontColor:
        typeof ss.fontColor === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(ss.fontColor)
          ? ss.fontColor
          : "#FFFFFF",
      outlineColor:
        typeof ss.outlineColor === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(ss.outlineColor)
          ? ss.outlineColor
          : "#000000",
      outlineWidth:
        typeof ss.outlineWidth === "number"
          ? clampNumber(ss.outlineWidth, 0, 10)
          : 2,
      position:
        typeof ss.position === "string" && positions.includes(ss.position)
          ? ss.position
          : "bottom",
      bold: ss.bold === true,
      backgroundBox: ss.backgroundBox === true,
    };
  }
  // 商标水印：校验后整体放行
  if (src.watermark && typeof src.watermark === "object") {
    const wm = src.watermark as Record<string, unknown>;
    const wmPos = ["tl", "tr", "bl", "br", "center"];
    out.watermark = {
      enabled: wm.enabled === true,
      imageUrl:
        typeof wm.imageUrl === "string" && wm.imageUrl.length <= 2048
          ? wm.imageUrl
          : "",
      position:
        typeof wm.position === "string" && wmPos.includes(wm.position)
          ? wm.position
          : "br",
      opacity:
        typeof wm.opacity === "number" ? clampNumber(wm.opacity, 0, 1) : 0.8,
      scale:
        typeof wm.scale === "number" ? clampNumber(wm.scale, 0.02, 0.5) : 0.12,
    };
  }
  // 贴图列表：校验每个贴图后放行（最多 50 个）
  if (Array.isArray(src.stickers)) {
    out.stickers = src.stickers
      .slice(0, 50)
      .filter(
        (st): st is Record<string, unknown> => !!st && typeof st === "object"
      )
      .map((st) => ({
        id: typeof st.id === "string" ? st.id.slice(0, 64) : "",
        imageUrl:
          typeof st.imageUrl === "string" && st.imageUrl.length <= 2048
            ? st.imageUrl
            : "",
        sceneId: typeof st.sceneId === "string" ? st.sceneId.slice(0, 64) : "",
        x: typeof st.x === "number" ? clampNumber(st.x, 0, 1) : 0.5,
        y: typeof st.y === "number" ? clampNumber(st.y, 0, 1) : 0.5,
        scale:
          typeof st.scale === "number" ? clampNumber(st.scale, 0.02, 1) : 0.2,
        ...(typeof st.startOffset === "number"
          ? { startOffset: clampNumber(st.startOffset, 0, 600) }
          : {}),
        ...(typeof st.duration === "number"
          ? { duration: clampNumber(st.duration, 0.1, 600) }
          : {}),
      }))
      .filter((st) => st.imageUrl && st.sceneId);
  }
  // 转场列表：校验每项的类型白名单 + 时长范围（与 video-synthesis XFADE_TYPES 一致）
  if (Array.isArray(src.transitions)) {
    const transitionTypes = [
      "none",
      "fade",
      "fadeblack",
      "fadewhite",
      "dissolve",
      "wipeleft",
      "wiperight",
      "wipeup",
      "wipedown",
      "slideleft",
      "slideright",
      "slideup",
      "slidedown",
      "circleopen",
      "circleclose",
      "radial",
      "smoothleft",
      "smoothright",
    ];
    out.transitions = src.transitions
      .slice(0, 200)
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        type:
          typeof t.type === "string" && transitionTypes.includes(t.type)
            ? t.type
            : "fade",
        duration:
          typeof t.duration === "number"
            ? clampNumber(t.duration, 0.1, 2)
            : 0.3,
      }));
  }
  // 分镜滤镜/变速：校验滤镜 id 白名单 + 变速范围（与 video-synthesis FX_FILTERS 一致）
  if (Array.isArray(src.sceneEffects)) {
    const effectIds = [
      "bw",
      "vivid",
      "sepia",
      "cold",
      "warm",
      "vignette",
      "blur",
      "oldfilm",
      "sharpen",
      "vintage",
      "tealorange",
      "dreampurple",
    ];
    out.sceneEffects = src.sceneEffects
      .slice(0, 200)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        sceneId: typeof e.sceneId === "string" ? e.sceneId.slice(0, 64) : "",
        effect:
          typeof e.effect === "string" && effectIds.includes(e.effect)
            ? e.effect
            : null,
        speed: typeof e.speed === "number" ? clampNumber(e.speed, 0.25, 4) : 1,
      }))
      .filter((e) => e.sceneId);
  }
  return out;
}

function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// 删除项目
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 验证项目归属
    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Delete project error:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
