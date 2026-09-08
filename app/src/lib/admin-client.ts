/**
 * 后台前端的 fetch 封装（客户端专用）
 *
 * 后台 API 的错误约定是 `{ error: string }`，且非管理员一律返回 **404 空响应**
 * （伪装不存在）。裸 fetch 在这两种情况下都只能给出「Failed to fetch」级别的
 * 信息，每个页面各写一遍解析很快就会漂移，故收成一个门面。
 */

/** 后台请求失败：带上 HTTP 状态码，便于调用方区分 403 / 409 等分支 */
export class AdminFetchError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminFetchError";
    this.status = status;
    Object.setPrototypeOf(this, AdminFetchError.prototype);
  }
}

/**
 * 发起后台请求并解析 JSON。
 *
 * - 2xx：返回解析后的 JSON（204 等空响应返回 undefined）
 * - 404：翻译成「无权限或不存在」——服务端刻意不区分这两者
 * - 其他非 2xx：优先用响应体里的 `error` 字段作消息
 */
export async function adminFetch<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.ok) {
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AdminFetchError(response.status, "服务端返回了非 JSON 响应");
    }
  }

  if (response.status === 404) {
    throw new AdminFetchError(404, "无权限或不存在");
  }

  // 错误体可能不是 JSON（网关 502 等），解析失败就退回状态码文案
  let message = `请求失败（HTTP ${response.status}）`;
  try {
    const data: unknown = await response.json();
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as { error?: unknown }).error === "string"
    ) {
      message = (data as { error: string }).error;
    }
  } catch {
    // 保留默认文案
  }

  throw new AdminFetchError(response.status, message);
}
