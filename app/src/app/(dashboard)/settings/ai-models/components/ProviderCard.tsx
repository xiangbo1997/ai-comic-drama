"use client";

import { useState } from "react";
import {
  Check,
  X,
  Loader2,
  Settings,
  Trash2,
  TestTube,
  Star,
  Edit3,
  Plus,
  AlertTriangle,
} from "lucide-react";
import type { AIProvider, UserConfig } from "./types";

interface ProviderCardProps {
  provider: AIProvider;
  config?: UserConfig;
  onConfigure: () => void;
  onRefresh: () => void;
  onEditProvider?: () => void;
  onDeleteProvider?: () => void;
}

export function ProviderCard({
  provider,
  config,
  onConfigure,
  onRefresh,
  onEditProvider,
  onDeleteProvider,
}: ProviderCardProps) {
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    if (!config) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/ai-models/configs/${config.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        alert(`连接成功！延迟: ${data.latency}ms`);
      } else {
        alert(`连接失败: ${data.message}`);
      }
      onRefresh();
    } catch {
      alert("测试失败");
    } finally {
      setTesting(false);
    }
  };

  const setAsDefault = async () => {
    if (!config) return;
    try {
      await fetch(`/api/ai-models/configs/${config.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      onRefresh();
    } catch {
      alert("设置失败");
    }
  };

  const deleteConfig = async () => {
    if (!config) return;
    if (!confirm("确定要删除此配置吗？")) return;
    try {
      await fetch(`/api/ai-models/configs/${config.id}`, {
        method: "DELETE",
      });
      onRefresh();
    } catch {
      alert("删除失败");
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-white">{provider.name}</h3>
            {provider.isCustom && (
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                自定义
              </span>
            )}
            {config?.isDefault && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full flex items-center gap-1">
                <Star size={12} fill="currentColor" />
                默认
              </span>
            )}
            {config?.testStatus === "SUCCESS" && (
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                <Check size={12} />
                已连接
              </span>
            )}
            {config?.testStatus === "FAILED" && (
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full flex items-center gap-1">
                <X size={12} />
                连接失败
              </span>
            )}
            {config?.authType === "CHATGPT_TOKEN" && (
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded-full">
                ChatGPT Token
              </span>
            )}
          </div>
          {config?.authType === "CHATGPT_TOKEN" && config.tokenExpiresAt && (() => {
            const expires = new Date(config.tokenExpiresAt);
            const now = new Date();
            const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysLeft <= 0) {
              return (
                <div className="flex items-center gap-1 text-xs text-red-400 mt-1">
                  <AlertTriangle size={12} />
                  Token 已过期，请重新获取
                </div>
              );
            }
            if (daysLeft <= 7) {
              return (
                <div className="flex items-center gap-1 text-xs text-yellow-400 mt-1">
                  <AlertTriangle size={12} />
                  Token 将在 {daysLeft} 天后过期
                </div>
              );
            }
            return null;
          })()}
          <p className="text-sm text-gray-400 mb-3">{provider.description}</p>

          {config ? (
            <div className="text-sm text-gray-300">
              <span className="text-gray-500">API Key: </span>
              <code className="bg-gray-700 px-2 py-0.5 rounded">{config.apiKeyMasked}</code>
              {config.selectedModel && (
                <span className="ml-4">
                  <span className="text-gray-500">模型: </span>
                  {provider.models.find((m) => m.id === config.selectedModel)?.name || config.selectedModel}
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">未配置</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {provider.isCustom && (
            <>
              {onEditProvider && (
                <button
                  onClick={onEditProvider}
                  className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded-lg transition"
                  title="编辑提供商"
                >
                  <Edit3 size={18} />
                </button>
              )}
              {onDeleteProvider && (
                <button
                  onClick={onDeleteProvider}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-lg transition"
                  title="删除提供商"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </>
          )}
          {config && (
            <>
              <button
                onClick={testConnection}
                disabled={testing}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition"
                title="测试连接"
              >
                {testing ? <Loader2 size={18} className="animate-spin" /> : <TestTube size={18} />}
              </button>
              {!config.isDefault && (
                <button
                  onClick={setAsDefault}
                  className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded-lg transition"
                  title="设为默认"
                >
                  <Star size={18} />
                </button>
              )}
              {!provider.isCustom && (
                <button
                  onClick={deleteConfig}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-lg transition"
                  title="删除配置"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </>
          )}
          <button
            onClick={onConfigure}
            className={`px-4 py-2 rounded-lg transition flex items-center gap-2 ${
              config
                ? "bg-gray-700 text-white hover:bg-gray-600"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {config ? (
              <>
                <Settings size={16} />
                修改
              </>
            ) : (
              <>
                <Plus size={16} />
                配置
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
