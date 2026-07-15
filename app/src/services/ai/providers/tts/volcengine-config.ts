/**
 * 火山引擎 TTS 凭证解析（纯函数，无副作用）
 *
 * 存在原因：表单/seed 要求用户在 extraConfig 里必填 appId + accessToken，
 * 连通性测试也读 extraConfig（appId/accessToken），但生成路径此前只读
 * config.apiKey 与 env.VOLC_APP_ID —— 于是「测试通过、生成断裂」。
 * 这里把「凭证解析」抽成单一权威函数，测试路径与生成路径共用，从根上
 * 消除两处解析规则漂移。
 *
 * 解析优先级（生成与测试一致）：
 *   - accessToken：extraConfig.accessToken → config.apiKey → env.VOLC_ACCESS_TOKEN
 *   - appId：      extraConfig.appId       → env.VOLC_APP_ID
 */

/** 火山 TTS 解析后的凭证 */
export interface VolcengineCredentials {
  /** TTS 鉴权 token（Authorization + request body 均需要） */
  accessToken: string;
  /** 应用 ID（request body app.appid） */
  appId: string;
}

/** 解析入参：仅依赖 extraConfig / apiKey 与进程环境变量，便于测试注入 */
export interface VolcengineConfigInput {
  apiKey?: string;
  extraConfig?: Record<string, string>;
}

/** 环境变量来源；仅需按名读取，收窄为字符串键值对便于测试注入 */
type EnvSource = Record<string, string | undefined>;

/**
 * 解析火山 TTS 凭证。env 允许显式注入（默认取 process.env），
 * 便于单测在不污染全局环境的前提下覆盖各优先级分支。
 */
export function resolveVolcengineCredentials(
  config: VolcengineConfigInput,
  env: EnvSource = process.env
): VolcengineCredentials {
  const accessToken =
    config.extraConfig?.accessToken?.trim() ||
    config.apiKey?.trim() ||
    env.VOLC_ACCESS_TOKEN?.trim() ||
    "";

  const appId =
    config.extraConfig?.appId?.trim() || env.VOLC_APP_ID?.trim() || "";

  return { accessToken, appId };
}
