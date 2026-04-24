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
  const [description, setDescription] = useState(
    existingProvider?.description || ""
  );
  const [baseUrl, setBaseUrl] = useState(existingProvider?.baseUrl || "");
  const [apiProtocol, setApiProtocol] = useState(
    existingProvider?.apiProtocol || "openai"
  );
  const [models, setModels] = useState<Array<{ id: string; name: string }>>(
    (existingProvider?.models as Array<{ id: string; name: string }>) || []
  );
  const [saving, setSaving] = useState(false);

  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");

  const urlValidation = baseUrl ? normalizeBaseUrl(baseUrl) : null;
  const currentProtocol = API_PROTOCOLS.find((p) => p.id === apiProtocol);

  const handleAddModel = () => {
    if (!newModelId.trim()) return;
    setModels([
      ...models,
      { id: newModelId.trim(), name: newModelName.trim() || newModelId.trim() },
    ]);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-gray-800">
        <div className="border-b border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-white">
            {existingProvider ? "编辑" : "添加"}自定义提供商
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            添加到「{categoryLabels[category]}」分类
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm text-gray-400">
              提供商名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：我的中转站"
              className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述（可选）"
              className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">API 协议</label>
            {(() => {
              const availableProtocols = getProtocolsForCategory(category);
              if (availableProtocols.length <= 1) {
                const protocol = availableProtocols[0] || API_PROTOCOLS[0];
                return (
                  <div className="w-full rounded-lg bg-gray-700/50 px-4 py-2 text-gray-400">
                    {protocol.name}
                    <span className="ml-2 text-xs text-gray-500">
                      (该分类仅支持此协议)
                    </span>
                  </div>
                );
              }
              return (
                <select
                  value={apiProtocol}
                  onChange={(e) => setApiProtocol(e.target.value)}
                  className="w-full rounded-lg bg-gray-700 px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
              <p className="mt-1 text-xs text-gray-500">
                {currentProtocol.description}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">
              API 基础地址 <span className="text-red-400">*</span>
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                currentProtocol?.defaultBaseUrl || "https://api.example.com/v1"
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

            {baseUrl && currentProtocol && (
              <div className="mt-2 rounded-lg bg-gray-700/50 p-2">
                <p className="mb-1 text-xs text-gray-400">API 地址预览：</p>
                <code className="rounded bg-gray-800 px-2 py-0.5 text-xs break-all text-green-400">
                  {generateUrlPreview(
                    baseUrl,
                    currentProtocol,
                    category,
                    "main"
                  )}
                </code>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">预置模型</label>
            <p className="mb-2 text-xs text-gray-500">
              添加常用模型，方便后续快速选择
            </p>

            {models.length > 0 && (
              <div className="mb-3 space-y-1">
                {models.map((model, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded bg-gray-700/50 p-2 text-sm"
                  >
                    <span className="flex-1 truncate text-white">
                      {model.name}
                    </span>
                    <code className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
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
                className="flex-1 rounded bg-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称（可选）"
                className="flex-1 rounded bg-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddModel}
                disabled={!newModelId.trim()}
                className="rounded bg-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-4 py-2 text-white transition hover:bg-gray-600"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
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
