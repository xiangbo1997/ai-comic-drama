/**
 * Next.js 启动钩子（boot-time 校验，2026-07-04）
 *
 * 此前配置错误延迟到首个请求才炸：ENCRYPTION_KEY 少一位 → 服务正常起、
 * 首页正常开，用户第一次触发生成才 500，线上不知道是配置问题；R2/Redis
 * 未配是静默降级，无任何日志提示（a8 审计 P1-4）。
 *
 * 实际校验逻辑在 instrumentation-node.ts：本文件会被同时编译进 edge 包，
 * 只能做 runtime 分流 + 动态 import，不能直接引用 Node API（process.exit 等）。
 *
 * register() 仅在 nodejs runtime 执行一次（Next 稳定特性，无需 experimental）。
 */

export async function register() {
  // 仅在 Node.js runtime 跑（edge runtime 无这些 env 语义）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNode } = await import("./instrumentation-node");
  await registerNode();
}
