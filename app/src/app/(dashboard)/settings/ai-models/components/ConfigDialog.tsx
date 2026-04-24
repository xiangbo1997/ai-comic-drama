"use client";

import { useMemo, useState } from "react";
import {
  Check,
  X,
  Loader2,
  TestTube,
  AlertTriangle,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { AIProvider, UserConfig, AuthType } from "./types";
import {
  API_PROTOCOLS,
  getAdvancedProtocolsForCategory,
  getProtocolsForCategory,
  getPrimaryProtocolsForCategory,
  normalizeBaseUrl,
  generateUrlPreview,
  getDefaultProtocolForProvider,
  providerAuthMethods,
} from "./types";
import { ModelSelector } from "./ModelSelector";

interface ConfigDialogProps {
  provider: AIProvider;
  existingConfig: UserConfig | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConfigDialog({
  provider,
  existingConfig,
  onClose,
  onSuccess,
}: ConfigDialogProps) {
  const supportedAuth = providerAuthMethods[provider.slug] || [
    "API_KEY" as AuthType,
  ];
  const showAuthTabs = supportedAuth.length > 1;
  const [authType, setAuthType] = useState<AuthType>(
    existingConfig?.authType || "API_KEY"
  );
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(
    existingConfig?.selectedModel || provider.models[0]?.id || ""
  );
  const [isDefault, setIsDefault] = useState(
    existingConfig?.isDefault || false
  );
  const [customBaseUrl, setCustomBaseUrl] = useState(
    existingConfig?.customBaseUrl || ""
  );
  const [extraConfig, setExtraConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latency?: number;
    errorType?: "auth" | "network" | "model" | "config" | "unknown";
    suggestion?: string;
    testedModel?: string;
    testedUrl?: string;
  } | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showAdvancedProtocols, setShowAdvancedProtocols] = useState(false);

  const [selectedProtocol, setSelectedProtocol] = useState<string>(
    existingConfig?.apiProtocol || getDefaultProtocolForProvider(provider.slug)
  );

  const urlValidation = customBaseUrl ? normalizeBaseUrl(customBaseUrl) : null;
  const currentProtocol = API_PROTOCOLS.find((p) => p.id === selectedProtocol);
  const availableProtocols = useMemo(
    () => getProtocolsForCategory(provider.category),
    [provider.category]
  );
  const primaryProtocols = useMemo(
    () => getPrimaryProtocolsForCategory(provider.category),
    [provider.category]
  );
  const advancedProtocols = useMemo(
    () => getAdvancedProtocolsForCategory(provider.category),
    [provider.category]
  );
  const selectedProtocolIsAdvanced = advancedProtocols.some(
    (protocol) => protocol.id === selectedProtocol
  );
  const visibleProtocols =
    showAdvancedProtocols || selectedProtocolIsAdvanced
      ? [...primaryProtocols, ...advancedProtocols]
      : primaryProtocols;

  const configFields = provider.configSchema?.fields || [
    { key: "apiKey", label: "API Key", type: "password", required: true },
  ];

  const handleTest = async () => {
    const currentApiKey =
      apiKey || (existingConfig?.hasApiKey ? "__EXISTING__" : "");
    if (!currentApiKey || currentApiKey === "__EXISTING__") {
      if (existingConfig) {
        setTesting(true);
        setTestResult(null);
        try {
          const res = await fetch(
            `/api/ai-models/configs/${existingConfig.id}/test`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                modelId: selectedModel || undefined,
                customBaseUrl: customBaseUrl.trim() || undefined,
              }),
            }
          );
          const data = await res.json();
          setTestResult({
            success: data.success,
            message: data.message || (data.success ? "连接成功" : "连接失败"),
            latency: data.latency,
            errorType: data.errorType,
            suggestion: data.suggestion,
            testedModel: data.testedModel,
            testedUrl: data.testedUrl,
          });
        } catch {
          setTestResult({
            success: false,
            message: "测试请求失败",
            errorType: "network",
          });
        } finally {
          setTesting(false);
        }
        return;
      }
      alert("请先输入 API Key");
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/ai-models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey,
          customBaseUrl: customBaseUrl.trim() || null,
          extraConfig: Object.keys(extraConfig).length > 0 ? extraConfig : null,
          modelId: selectedModel || undefined,
          apiProtocol: selectedProtocol || undefined,
          authType,
        }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? "连接成功" : "连接失败"),
        latency: data.latency,
        errorType: data.errorType,
        suggestion: data.suggestion,
        testedModel: data.testedModel,
        testedUrl: data.testedUrl,
      });
    } catch {
      setTestResult({
        success: false,
        message: "测试请求失败",
        errorType: "network",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const body: Record<string, unknown> = {
        providerId: provider.id,
        selectedModel,
        isDefault,
        customBaseUrl:
          urlValidation?.normalized || customBaseUrl.trim() || null,
        apiProtocol: selectedProtocol,
        authType,
      };

      // ChatGPT token 设置 30 天过期
      if (authType === "CHATGPT_TOKEN" && apiKey) {
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);
        body.tokenExpiresAt = expires.toISOString();
      }

      if (apiKey) {
        body.apiKey = apiKey;
      } else if (!existingConfig) {
        alert(
          authType === "CHATGPT_TOKEN"
            ? "请输入 Access Token"
            : "请输入 API Key"
        );
        setSaving(false);
        return;
      }

      if (Object.keys(extraConfig).length > 0) {
        body.extraConfig = extraConfig;
      }

      const url = existingConfig
        ? `/api/ai-models/configs/${existingConfig.id}`
        : "/api/ai-models/configs";
      const method = existingConfig ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }

      onSuccess();
    } catch (error) {
      alert(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-gray-800">
        <div className="border-b border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-white">
            {existingConfig ? "修改" : "配置"} {provider.name}
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] space-y-4 overflow-y-auto p-6"
        >
          {/* 认证方式 Tabs */}
          {showAuthTabs && (
            <div className="flex gap-1 rounded-lg bg-gray-700/50 p-1">
              {supportedAuth.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAuthType(type)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                    authType === type
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {type === "API_KEY" ? "API Key" : "ChatGPT 账号"}
                </button>
              ))}
            </div>
          )}

          {/* ChatGPT Token 引导 */}
          {authType === "CHATGPT_TOKEN" && (
            <div className="space-y-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
              <div className="flex items-start gap-2">
                <Info
                  size={16}
                  className="mt-0.5 flex-shrink-0 text-yellow-400"
                />
                <div className="text-sm">
                  <p className="mb-1 font-medium text-yellow-300">
                    获取 ChatGPT Access Token
                  </p>
                  <ol className="space-y-1 text-xs text-yellow-200/80">
                    <li>
                      1. 登录{" "}
                      <a
                        href="https://chatgpt.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        chatgpt.com
                      </a>
                    </li>
                    <li>
                      2. 访问{" "}
                      <a
                        href="https://chatgpt.com/api/auth/session"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        chatgpt.com/api/auth/session
                      </a>
                    </li>
                    <li>
                      3. 复制{" "}
                      <code className="rounded bg-black/20 px-1">
                        accessToken
                      </code>{" "}
                      字段的值
                    </li>
                  </ol>
                  <p className="mt-2 text-xs text-yellow-400/80">
                    Token 约 30 天过期，届时需重新获取
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Gemini 免费 Key 引导 */}
          {provider.slug === "gemini" && authType === "API_KEY" && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
              <div className="flex items-start gap-2">
                <Info
                  size={16}
                  className="mt-0.5 flex-shrink-0 text-blue-400"
                />
                <div className="text-sm">
                  <p className="mb-1 font-medium text-blue-300">
                    Gemini API 免费使用
                  </p>
                  <p className="text-xs text-blue-200/80">
                    Google AI Studio 提供免费 API
                    Key，无需信用卡。免费额度：Gemini 2.5 Pro 5次/分钟、Flash
                    10次/分钟。
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        "https://aistudio.google.com/apikey",
                        "_blank"
                      )
                    }
                    className="mt-2 flex w-fit items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition hover:bg-blue-700"
                  >
                    <ExternalLink size={12} />
                    获取免费 API Key
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 凭证输入 */}
          {authType === "CHATGPT_TOKEN" ? (
            <div>
              <label className="mb-1 block text-sm text-gray-400">
                Access Token
              </label>
              <textarea
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  existingConfig
                    ? "留空保持不变"
                    : "粘贴从 chatgpt.com 获取的 accessToken"
                }
                rows={3}
                className="w-full resize-none rounded-lg bg-gray-700 px-4 py-2 font-mono text-xs text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          ) : (
            configFields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-sm text-gray-400">
                  {field.label}
                  {provider.slug === "gemini" && field.key === "apiKey" && (
                    <button
                      type="button"
                      onClick={() =>
                        window.open(
                          "https://aistudio.google.com/apikey",
                          "_blank"
                        )
                      }
                      className="ml-2 text-xs text-blue-400 hover:text-blue-300"
                    >
                      获取免费 Key
                    </button>
                  )}
                </label>
                {field.key === "apiKey" ? (
                  <input
                    type={field.type}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      existingConfig ? "留空保持不变" : `输入 ${field.label}`
                    }
                    className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={extraConfig[field.key] || ""}
                    onChange={(e) =>
                      setExtraConfig({
                        ...extraConfig,
                        [field.key]: e.target.value,
                      })
                    }
                    placeholder={`输入 ${field.label}`}
                    required={field.required && !existingConfig}
                    className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                )}
              </div>
            ))
          )}

          {/* ChatGPT Token 需要代理地址 */}
          {authType === "CHATGPT_TOKEN" && (
            <div>
              <label className="mb-1 block text-sm text-gray-400">
                代理地址 <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://your-chatgpt-proxy.example.com/v1"
                required
                className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                需要自部署 ChatGPT-to-API 代理服务，将 ChatGPT 账号转为 OpenAI
                兼容接口
              </p>
            </div>
          )}

          <ModelSelector
            provider={provider}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            apiKey={apiKey}
            customBaseUrl={customBaseUrl}
            existingConfig={existingConfig}
          />

          <div>
            <label className="mb-1 block text-sm text-gray-400">API 协议</label>
            {availableProtocols.length <= 1 ? (
              (() => {
                const protocol = availableProtocols[0] || API_PROTOCOLS[0];
                return (
                  <div className="w-full rounded-lg bg-gray-700/50 px-4 py-2 text-gray-400">
                    {protocol.name}
                    <span className="ml-2 text-xs text-gray-500">
                      (该分类仅支持此协议)
                    </span>
                  </div>
                );
              })()
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedProtocol}
                  onChange={(e) => setSelectedProtocol(e.target.value)}
                  className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {visibleProtocols.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.name}
                    </option>
                  ))}
                </select>

                {advancedProtocols.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAdvancedProtocols((prev) => !prev)}
                    className="flex items-center gap-1 text-xs text-blue-400 transition hover:text-blue-300"
                  >
                    {showAdvancedProtocols || selectedProtocolIsAdvanced ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    {showAdvancedProtocols || selectedProtocolIsAdvanced
                      ? "收起高级协议"
                      : "显示高级协议"}
                  </button>
                )}
              </div>
            )}
            {currentProtocol && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-gray-500">
                  {currentProtocol.description}
                </p>
                <p className="text-xs text-gray-500">
                  常用选择：
                  <span className="text-gray-400"> OpenAI 兼容</span>{" "}
                  适合绝大多数中转和第三方服务；
                  <span className="text-gray-400"> Claude</span> 仅用于
                  Anthropic；
                  <span className="text-gray-400"> Gemini</span> 仅用于 Google
                  Gemini API。
                </p>
                {selectedProtocolIsAdvanced && (
                  <p className="text-xs text-yellow-400/80">
                    当前使用的是高级协议，通常只在服务商文档明确要求时才需要切换。
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              自定义中转节点 <span className="text-gray-500">(可选)</span>
            </label>
            <input
              type="url"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder={
                currentProtocol?.defaultBaseUrl ||
                provider.baseUrl ||
                "留空使用默认地址"
              }
              className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />

            {urlValidation && urlValidation.warnings.length > 0 && (
              <div className="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/20 p-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 flex-shrink-0 text-yellow-400"
                  />
                  <div className="space-y-1 text-xs text-yellow-300">
                    {urlValidation.warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(customBaseUrl || currentProtocol) && (
              <div className="mt-2 rounded-lg bg-gray-700/50 p-2">
                <p className="mb-1 text-xs text-gray-400">API 地址预览：</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-xs text-gray-500">接口:</span>
                    <code className="rounded bg-gray-800 px-2 py-0.5 text-xs break-all text-green-400">
                      {generateUrlPreview(
                        customBaseUrl ||
                          currentProtocol?.defaultBaseUrl ||
                          provider.baseUrl ||
                          "",
                        currentProtocol!,
                        provider.category,
                        "main"
                      )}
                    </code>
                  </div>
                  {currentProtocol?.endpoints[provider.category]?.list && (
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-xs text-gray-500">模型:</span>
                      <code className="rounded bg-gray-800 px-2 py-0.5 text-xs break-all text-blue-400">
                        {generateUrlPreview(
                          customBaseUrl ||
                            currentProtocol?.defaultBaseUrl ||
                            provider.baseUrl ||
                            "",
                          currentProtocol!,
                          provider.category,
                          "list"
                        )}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="mt-1 text-xs text-gray-500">
              如需使用代理或中转服务，请填写基础 URL（不含接口路径）
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-300">设为该分类的默认模型</span>
          </label>

          {testResult && (
            <div
              className={`rounded-lg p-3 text-sm ${
                testResult.success
                  ? "border border-green-500/30 bg-green-500/20 text-green-400"
                  : "border border-red-500/30 bg-red-500/20 text-red-400"
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? <Check size={16} /> : <X size={16} />}
                <span className="font-medium">
                  {testResult.success ? "测试通过" : "测试失败"}
                </span>
                {!testResult.success && testResult.errorType && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      testResult.errorType === "auth"
                        ? "bg-yellow-500/30 text-yellow-300"
                        : testResult.errorType === "model"
                          ? "bg-purple-500/30 text-purple-300"
                          : testResult.errorType === "network"
                            ? "bg-orange-500/30 text-orange-300"
                            : "bg-gray-500/30 text-gray-300"
                    }`}
                  >
                    {testResult.errorType === "auth" && "认证问题"}
                    {testResult.errorType === "model" && "模型问题"}
                    {testResult.errorType === "network" && "网络问题"}
                    {testResult.errorType === "config" && "配置问题"}
                    {testResult.errorType === "unknown" && "未知错误"}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {testResult.latency && (
                    <span className="text-gray-400">
                      {testResult.latency}ms
                    </span>
                  )}
                  {!testResult.success &&
                    (testResult.testedModel ||
                      testResult.testedUrl ||
                      testResult.suggestion) && (
                      <button
                        type="button"
                        onClick={() => setShowErrorDetails(!showErrorDetails)}
                        className="rounded p-1 transition hover:bg-black/20"
                        title={showErrorDetails ? "收起详情" : "查看详情"}
                      >
                        <Info
                          size={16}
                          className={showErrorDetails ? "text-blue-400" : ""}
                        />
                      </button>
                    )}
                </div>
              </div>

              <p className="mt-2 text-xs opacity-90">{testResult.message}</p>

              {(testResult.success || showErrorDetails) && (
                <div className="mt-2 space-y-1 text-xs">
                  {(testResult.testedModel || testResult.testedUrl) && (
                    <div className="space-y-1 border-t border-current/20 pt-2 opacity-75">
                      {testResult.testedModel && (
                        <p>
                          测试模型:{" "}
                          <code className="rounded bg-black/20 px-1">
                            {testResult.testedModel}
                          </code>
                        </p>
                      )}
                      {testResult.testedUrl && (
                        <p>
                          测试地址:{" "}
                          <code className="rounded bg-black/20 px-1 break-all">
                            {testResult.testedUrl}
                          </code>
                        </p>
                      )}
                    </div>
                  )}

                  {!testResult.success && testResult.suggestion && (
                    <div className="mt-2 rounded bg-black/20 p-2">
                      <p className="text-yellow-300/90">
                        <span className="font-medium">建议: </span>
                        {testResult.suggestion}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-4 py-2 text-white transition hover:bg-gray-600"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              className="flex items-center gap-2 rounded-lg bg-gray-600 px-4 py-2 text-white transition hover:bg-gray-500 disabled:opacity-50"
            >
              {testing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <TestTube size={16} />
              )}
              测试
            </button>
            <button
              type="submit"
              disabled={saving || testing}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
