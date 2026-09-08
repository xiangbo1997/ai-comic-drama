/**
 * AIProviderProtocol 运行时白名单 —— 纯函数单测
 *
 * 这道闸的价值：DB 里的 apiProtocol 是开放字符串，用户自建 provider 可以填
 * 任意值。不校验的话未知协议会被 provider-factory 的 switch default 静默当
 * openai 处理，故障表现为「配了 X 协议却按 OpenAI 发请求」，极难排查。
 */

import { describe, it, expect } from "vitest";
import { AI_PROVIDER_PROTOCOLS, isAIProviderProtocol } from "@/types/ai";

describe("isAIProviderProtocol", () => {
  it("放行全部已声明协议", () => {
    for (const protocol of AI_PROVIDER_PROTOCOLS) {
      expect(isAIProviderProtocol(protocol)).toBe(true);
    }
  });

  it("拒绝未知协议与近似拼写", () => {
    for (const value of ["mistral", "cohere", "OpenAI", "openai ", "sovits"]) {
      expect(isAIProviderProtocol(value)).toBe(false);
    }
  });

  it("拒绝空串与非字符串（空串由调用方单独放行为历史配置）", () => {
    for (const value of ["", null, undefined, 42, {}, ["openai"]]) {
      expect(isAIProviderProtocol(value)).toBe(false);
    }
  });
});
