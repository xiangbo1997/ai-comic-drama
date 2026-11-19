import type { Capability, ShortVideoConnector } from "./contracts";
// 只有具备官方权限与实测证据的适配器才登记；不通过环境变量注入任意发布端点。
export const productionConnectors: readonly ShortVideoConnector[] = [];
export function capabilities(): Capability[] {
  return (["DOUYIN", "KUAISHOU", "XIAOHONGSHU"] as const).map(
    (platform) =>
      productionConnectors.find((c) => c.capability.platform === platform)
        ?.capability ?? {
        platform,
        connectorId: `${platform.toLowerCase()}-manual`,
        discovery: "MANUAL",
        publish: "MANUAL",
        metrics: "MANUAL",
        mode: "MANUAL",
        supportsSubmissionLookup: false,
        supportsIdempotencyKey: false,
        verifiedAt: null,
        reason:
          "BLOCKED：尚无已核验的应用权限、授权账号和真实接入证据；可手动导入与人工发布",
      }
  );
}
