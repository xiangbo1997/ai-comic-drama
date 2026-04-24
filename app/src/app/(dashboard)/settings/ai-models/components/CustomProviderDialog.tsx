"use client";

import { useState } from "react";
import { Loader2, Plus, X, AlertTriangle } from "lucide-react";
import type { AICategory, AIProvider } from "./types";
import {
  API_PROTOCOLS,
  categoryLabels,
  getProtocolsForCategory,
  normalizeBaseUrl,
  generateUrlPreview,
} from "./types";

interface CustomProviderDialogProps {
  category: AICategory;
  existingProvider: AIProvider | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function CustomProviderDialog({
  category,
  existingProvider,
  onClose,
  onSuccess,
}: CustomProviderDialogProps) {
  const [name, setName] = useState(existingProvider?.name || "");
  const [description, setDescription] = useState(existingProvider?.description || "");
  const [baseUrl, setBaseUrl] = useState(existingProvider?.baseUrl || "");
  const [apiProtocol, setApiProtocol] = useState(existingProvider?.apiProtocol || "openai");
  const [models, setModels] = useState<Array<{ id: string; name: string }>>(
    (existingProvider?.models as Array<{ id: string; name: string }>) || []
  );
  const [saving, setSaving] = useState(false);

  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");

  const urlValidation = baseUrl ? normalizeBaseUrl(baseUrl) : null;
  const currentProtocol = API_PROTOCOLS.find(p => p.id === apiProtocol);

  const handleAddModel = () => {
    if (!newModelId.trim()) return;
    setModels([...models, { id: newModelId.trim(), name: newModelName.trim() || newModelId.trim() }]);
    setNewModelId("");
    setNewModelName("");
  };

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert("请输入提供商名称");
      return;
    }

    if (!baseUrl.trim()) {
      alert("请输入 API 基础地址");
      return;
    }

    setSaving(true);

    try {
      const body = {
        name: name.trim(),
        category,
        description: description.trim() || null,
        baseUrl: urlValidation?.normalized || baseUrl.trim(),
        apiProtocol,
        models,
      };

      const url = existingProvider
        ? `/api/ai-models/providers/${existingProvider.id}`
        : "/api/ai-models/providers";
      const method = existingProvider ? "PUT" : "POST";

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
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            {existingProvider ? "编辑" : "添加"}自定义提供商
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            添加到「{categoryLabels[category]}」分类
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              提供商名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：我的中转站"
              className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述（可选）"
              className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">API 协议</label>
            {(() => {
              const availableProtocols = getProtocolsForCategory(category);
              if (availableProtocols.length <= 1) {
                const protocol = availableProtocols[0] || API_PROTOCOLS[0];
                return (
                  <div className="w-full bg-gray-700/50 rounded-lg px-4 py-2 text-gray-400">
                    {protocol.name}
                    <span className="text-xs text-gray-500 ml-2">(该分类仅支持此协议)</span>
                  </div>
                );
              }
              return (
                <select
                  value={apiProtocol}
                  onChange={(e) => setApiProtocol(e.target.value)}
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableProtocols.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.name}
                    </option>
                  ))}
                </select>
              );
            })()}
            {currentProtocol && (
              <p className="text-xs text-gray-500 mt-1">{currentProtocol.description}</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              API 基础地址 <span className="text-red-400">*</span>
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={currentProtocol?.defaultBaseUrl || "https://api.example.com/v1"}
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

            {baseUrl && currentProtocol && (
              <div className="mt-2 p-2 bg-gray-700/50 rounded-lg">
                <p className="text-xs text-gray-400 mb-1">API 地址预览：</p>
                <code className="text-xs text-green-400 bg-gray-800 px-2 py-0.5 rounded break-all">
                  {generateUrlPreview(baseUrl, currentProtocol, category, "main")}
                </code>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">预置模型</label>
            <p className="text-xs text-gray-500 mb-2">
              添加常用模型，方便后续快速选择
            </p>

            {models.length > 0 && (
              <div className="space-y-1 mb-3">
                {models.map((model, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-gray-700/50 rounded text-sm"
                  >
                    <span className="flex-1 text-white truncate">{model.name}</span>
                    <code className="text-xs text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">
                      {model.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleRemoveModel(index)}
                      className="p-1 text-gray-400 hover:text-red-400"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="模型 ID"
                className="flex-1 bg-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称（可选）"
                className="flex-1 bg-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleAddModel}
                disabled={!newModelId.trim()}
                className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {existingProvider ? "保存修改" : "创建提供商"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
