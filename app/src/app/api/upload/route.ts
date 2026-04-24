import { auth } from "@/lib/auth";
import { getPresignedUploadUrl, isR2Configured } from "@/services/storage";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:upload");

// 获取预签名上传 URL
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: "Storage not configured" },
        { status: 503 }
      );
    }

    const { fileName, contentType, fileType, projectId } = await request.json();

    if (!fileName || !contentType || !fileType) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, contentType, fileType" },
        { status: 400 }
      );
    }

    if (!["image", "video", "audio"].includes(fileType)) {
      return NextResponse.json(
        { error: "Invalid fileType. Must be: image, video, or audio" },
        { status: 400 }
      );
    }

    const result = await getPresignedUploadUrl({
      fileName,
      contentType,
      fileType,
      userId: session.user.id,
      projectId,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("Get presigned URL error:", error);
    return NextResponse.json(
      { error: "Failed to get upload URL" },
      { status: 500 }
    );
  }
}
