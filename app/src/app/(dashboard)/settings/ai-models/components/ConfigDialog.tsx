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
  const supportedAuth = providerAuthMethods[provider.slug] || ["API_KEY" as AuthType];
  const showAuthTabs = supportedAuth.length > 1;
  const [authType, setAuthType] = useState<AuthType>(existingConfig?.authType || "API_KEY");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(existingConfig?.selectedModel || provider.models[0]?.id || "");
  const [isDefault, setIsDefault] = useState(existingConfig?.isDefault || false);
  const [customBaseUrl, setCustomBaseUrl] = useState(existingConfig?.customBaseUrl || "");
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
  const currentProtocol = API_PROTOCOLS.find(p => p.id === selectedProtocol);
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
  const selectedProtocolIsAdvanced = advancedProtocols.some((protocol) => protocol.id === selectedProtocol);
  const visibleProtocols = showAdvancedProtocols || selectedProtocolIsAdvanced
    ? [...primaryProtocols, ...advancedProtocols]
    : primaryProtocols;

  const configFields = provider.configSchema?.fields || [
    { key: "apiKey", label: "API Key", type: "password", required: true },
  ];

  const handleTest = async () => {
    const currentApiKey = apiKey || (existingConfig?.hasApiKey ? "__EXISTING__" : "");
    if (!currentApiKey || currentApiKey === "__EXISTING__") {
      if (existingConfig) {
        setTesting(true);
        setTestResult(null);
        try {
          const res = await fetch(`/api/ai-models/configs/${existingConfig.id}/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: selectedModel || undefined,
              customBaseUrl: customBaseUrl.trim() || undefined,
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
          setTestResult({ success: false, message: "测试请求失败", errorType: "network" });
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
      setTestResult({ success: false, message: "测试请求失败", errorType: "network" });
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
        customBaseUrl: urlValidation?.normalized || customBaseUrl.trim() || null,
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
        alert(authType === "CHATGPT_TOKEN" ? "请输入 Access Token" : "请输入 API Key");
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-md">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            {existingConfig ? "修改" : "配置"} {provider.name}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 认证方式 Tabs */}
          {showAuthTabs && (
            <div className="flex gap-1 bg-gray-700/50 p-1 rounded-lg">
              {supportedAuth.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAuthType(type)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm transition ${
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
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-2">
              <div className="flex items-start gap-2">
                <Info size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-yellow-300 font-medium mb-1">获取 ChatGPT Access Token</p>
                  <ol className="text-yellow-200/80 space-y-1 text-xs">
                    <li>1. 登录 <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer" className="underline">chatgpt.com</a></li>
                    <li>2. 访问 <a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noopener noreferrer" className="underline">chatgpt.com/api/auth/session</a></li>
                    <li>3. 复制 <code className="bg-black/20 px-1 rounded">accessToken</code> 字段的值</li>
                  </ol>
                  <p className="text-yellow-400/80 text-xs mt-2">Token 约 30 天过期，届时需重新获取</p>
                </div>
              </div>
            </div>
          )}

          {/* Gemini 免费 Key 引导 */}
          {provider.slug === "gemini" && authType === "API_KEY" && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-blue-300 font-medium mb-1">Gemini API 免费使用</p>
                  <p className="text-blue-200/80 text-xs">Google AI Studio 提供免费 API Key，无需信用卡。免费额度：Gemini 2.5 Pro 5次/分钟、Flash 10次/分钟。</p>
                  <button
                    type="button"
                    onClick={() => window.open("https://aistudio.google.com/apikey", "_blank")}
                    className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition flex items-center gap-1 w-fit"
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
              <label className="block text-sm text-gray-400 mb-1">Access Token</label>
              <textarea
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={existingConfig ? "留空保持不变" : "粘贴从 chatgpt.com 获取的 accessToken"}
                rows={3}
                className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono resize-none"
              />
            </div>
          ) : (
            configFields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm text-gray-400 mb-1">
                  {field.label}
                  {provider.slug === "gemini" && field.key === "apiKey" && (
                    <button
                      type="button"
                      onClick={() => window.open("https://aistudio.google.com/apikey", "_blank")}
                      className="ml-2 text-blue-400 hover:text-blue-300 text-xs"
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
                    placeholder={existingConfig ? "留空保持不变" : `输入 ${field.label}`}
                    className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={extraConfig[field.key] || ""}
                    onChange={(e) => setExtraConfig({ ...extraConfig, [field.key]: e.target.value })}
                    placeholder={`输入 ${field.label}`}
                    required={field.required && !existingConfig}
                    className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            ))
          )}

          {/* ChatGPT Token 需要代理地址 */}
          {authType === "CHATGPT_TOKEN" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                代理地址 <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://your-chatgpt-proxy.example.com/v1"
                required
                className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                需要自部署 ChatGPT-to-API 代理服务，将 ChatGPT 账号转为 OpenAI 兼容接口
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
            <label className="block text-sm text-gray-400 mb-1">API 协议</label>
            {availableProtocols.length <= 1 ? (
              (() => {
                const protocol = availableProtocols[0] || API_PROTOCOLS[0];
                return (
                  <div className="w-full bg-gray-700/50 rounded-lg px-4 py-2 text-gray-400">
                    {protocol.name}
                    <span className="text-xs text-gray-500 ml-2">(该分类仅支持此协议)</span>
                  </div>
                );
              })()
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedProtocol}
                  onChange={(e) => setSelectedProtocol(e.target.value)}
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
                  >
                    {showAdvancedProtocols || selectedProtocolIsAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAdvancedProtocols || selectedProtocolIsAdvanced ? "收起高级协议" : "显示高级协议"}
                  </button>
                )}
              </div>
            )}
            {currentProtocol && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-gray-500">{currentProtocol.description}</p>
                <p className="text-xs text-gray-500">
                  常用选择：
                  <span className="text-gray-400"> OpenAI 兼容</span> 适合绝大多数中转和第三方服务；
                  <span className="text-gray-400"> Claude</span> 仅用于 Anthropic；
                  <span className="text-gray-400"> Gemini</span> 仅用于 Google Gemini API。
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
            <label className="block text-sm text-gray-400 mb-1">
              自定义中转节点 <span className="text-gray-500">(可选)</span>
            </label>
            <input
              type="url"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder={currentProtocol?.defaultBaseUrl || provider.baseUrl || "留空使用默认地址"}
              className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {urlValidation && urlValidation.warnings.length > 0 && (
              <div className="mt-2 p-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-yellow-300 space-y-1">
                    {urlValidation.warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(customBaseUrl || currentProtocol) && (
              <div className="mt-2 p-2 bg-gray-700/50 rounded-lg">
                <p className="text-xs text-gray-400 mb-1">API 地址预览：</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">接口:</span>
                    <code className="text-xs text-green-400 bg-gray-800 px-2 py-0.5 rounded break-all">
                      {generateUrlPreview(
                        customBaseUrl || currentProtocol?.defaultBaseUrl || provider.baseUrl || "",
                        currentProtocol!,
                        provider.category,
                        "main"
                      )}
                    </code>
                  </div>
                  {currentProtocol?.endpoints[provider.category]?.list && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">模型:</span>
                      <code className="text-xs text-blue-400 bg-gray-800 px-2 py-0.5 rounded break-all">
                        {generateUrlPreview(
                          customBaseUrl || currentProtocol?.defaultBaseUrl || provider.baseUrl || "",
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

            <p className="text-xs text-gray-500 mt-1">
              如需使用代理或中转服务，请填写基础 URL（不含接口路径）
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-300">设为该分类的默认模型</span>
          </label>

          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm ${
                testResult.success
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? <Check size={16} /> : <X size={16} />}
                <span className="font-medium">
                  {testResult.success ? "测试通过" : "测试失败"}
                </span>
                {!testResult.success && testResult.errorType && (
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    testResult.errorType === "auth" ? "bg-yellow-500/30 text-yellow-300" :
                    testResult.errorType === "model" ? "bg-purple-500/30 text-purple-300" :
                    testResult.errorType === "network" ? "bg-orange-500/30 text-orange-300" :
                    "bg-gray-500/30 text-gray-300"
                  }`}>
                    {testResult.errorType === "auth" && "认证问题"}
                    {testResult.errorType === "model" && "模型问题"}
                    {testResult.errorType === "network" && "网络问题"}
                    {testResult.errorType === "config" && "配置问题"}
                    {testResult.errorType === "unknown" && "未知错误"}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {testResult.latency && (
                    <span className="text-gray-400">{testResult.latency}ms</span>
                  )}
                  {!testResult.success && (testResult.testedModel || testResult.testedUrl || testResult.suggestion) && (
                    <button
                      type="button"
                      onClick={() => setShowErrorDetails(!showErrorDetails)}
                      className="p-1 hover:bg-black/20 rounded transition"
                      title={showErrorDetails ? "收起详情" : "查看详情"}
                    >
                      <Info size={16} className={showErrorDetails ? "text-blue-400" : ""} />
                    </button>
                  )}
                </div>
              </div>

              <p className="mt-2 text-xs opacity-90">{testResult.message}</p>

              {(testResult.success || showErrorDetails) && (
                <div className="mt-2 space-y-1 text-xs">
                  {(testResult.testedModel || testResult.testedUrl) && (
                    <div className="pt-2 border-t border-current/20 space-y-1 opacity-75">
                      {testResult.testedModel && (
                        <p>测试模型: <code className="bg-black/20 px-1 rounded">{testResult.testedModel}</code></p>
                      )}
                      {testResult.testedUrl && (
                        <p>测试地址: <code className="bg-black/20 px-1 rounded break-all">{testResult.testedUrl}</code></p>
                      )}
                    </div>
                  )}

                  {!testResult.success && testResult.suggestion && (
                    <div className="mt-2 p-2 bg-black/20 rounded">
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
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition disabled:opacity-50 flex items-center gap-2"
            >
              {testing ? <Loader2 size={16} className="animate-spin" /> : <TestTube size={16} />}
              测试
            </button>
            <button
              type="submit"
              disabled={saving || testing}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
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
