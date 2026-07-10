/**
 * 客户端文件上传 helper（浏览器侧）。
 *
 * 与 /api/upload 的双模式契约对齐，对调用方屏蔽存储后端差异：
 * - R2 模式：先取预签名 { uploadUrl, fileUrl }，再 PUT 直传 R2（零服务端中转）。
 * - 本地模式：后端返回 { direct: true }，改用 multipart/form-data 一段式直传，
 *   服务端写盘后返回 { fileUrl }。
 *
 * 切换存储后端时调用方无需改动——本函数自动选择上传姿势。
 */

/** 后端 /api/upload JSON 模式可能的响应形态 */
interface PresignResponse {
  /** R2 模式：预签名 PUT 地址（本地模式下不存在） */
  uploadUrl?: string;
  /** 最终可访问的文件 URL（R2 模式下随预签名一起返回） */
  fileUrl?: string;
  /** 本地模式标记：提示改用 multipart 直传 */
  direct?: boolean;
  /** 错误信息 */
  error?: string;
}

export interface UploadFileParams {
  /** 待上传文件 */
  file: File;
  /**
   * 上传类型，与后端 ALLOWED_FILE_TYPES 对齐：
   * "image" | "video" | "audio" | "watermark"
   */
  fileType: "image" | "video" | "audio" | "watermark";
  /** 可选：归属项目 ID（决定存储路径前缀） */
  projectId?: string;
}

/**
 * 上传文件并返回可访问 URL。
 * 失败时抛出带中文提示的 Error，由调用方捕获展示。
 */
/** 各上传类型的大小上限（MB），与后端 ALLOWED_FILE_TYPES.maxBytes 对齐，用于前端预检 */
const MAX_MB: Record<UploadFileParams["fileType"], number> = {
  image: 15,
  watermark: 2,
  video: 200,
  audio: 30,
};

/** 把底层网络异常（fetch reject，如 Failed to fetch）包装成友好中文提示 */
async function fetchOrFriendly(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    // fetch reject = 请求未完成握手（断网/连接被重置/CORS）——非 HTTP 错误码
    throw new Error("网络异常，上传未送达，请检查网络后重试");
  }
}

export async function uploadFileViaApi({
  file,
  fileType,
  projectId,
}: UploadFileParams): Promise<string> {
  // 前端大小预检：超限直接提示，不发请求（省一次往返，提示更明确）
  const maxMb = MAX_MB[fileType];
  if (file.size > maxMb * 1024 * 1024) {
    throw new Error(
      `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），上限 ${maxMb} MB`
    );
  }

  // 第一步：JSON 请求上传凭证
  const presignRes = await fetchOrFriendly("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileType,
      fileSize: file.size,
      projectId,
    }),
  });

  const presign = (await presignRes.json()) as PresignResponse;

  if (!presignRes.ok) {
    throw new Error(presign.error ?? "获取上传凭证失败");
  }

  // R2 模式：拿到预签名地址，PUT 直传
  if (presign.uploadUrl && presign.fileUrl) {
    const putRes = await fetchOrFriendly(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error("上传失败，请重试");
    }
    return presign.fileUrl;
  }

  // 本地模式：改用 multipart/form-data 一段式直传
  if (presign.direct) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileType", fileType);
    if (projectId) formData.append("projectId", projectId);

    const uploadRes = await fetchOrFriendly("/api/upload", {
      method: "POST",
      body: formData,
    });
    const result = (await uploadRes.json()) as PresignResponse;
    if (!uploadRes.ok || !result.fileUrl) {
      throw new Error(result.error ?? "上传失败，请重试");
    }
    return result.fileUrl;
  }

  // 两种形态都不满足——后端契约异常
  throw new Error("上传响应异常，请稍后重试");
}
