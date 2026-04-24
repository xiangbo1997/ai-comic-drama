"use client";

import { useState, useEffect } from "react";
import { Check, RefreshCw, ChevronDown } from "lucide-react";
import type {
  AIProvider,
  UserConfig,
  ModelWithAvailability,
  ModelAvailability,
} from "./types";
import { ModelCapabilityIcons } from "./ModelCapabilityIcons";

interface ModelSelectorProps {
  provider: AIProvider;
  selectedModel: string;
  onModelChange: (model: string) => void;
  apiKey: string;
  customBaseUrl: string;
  existingConfig: UserConfig | null;
}

export function ModelSelector({
  provider,
  selectedModel,
  onModelChange,
  apiKey,
  customBaseUrl,
}: ModelSelectorProps) {
  const [models, setModels] = useState<ModelWithAvailability[]>(
    provider.models.map((m) => ({
      ...m,
      availability: "unknown" as ModelAvailability,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [isManualInput, setIsManualInput] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [modelSource, setModelSource] = useState<"preset" | "remote">("preset");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hasCustomUrl, setHasCustomUrl] = useState(false);
  const [hasFetchedRemote, setHasFetchedRemote] = useState(false);

  useEffect(() => {
    if (hasFetchedRemote) return;

    const updatedModels = provider.models.map((m) => ({
      ...m,
      availability: "unknown" as ModelAvailability,
    }));
    setModels(updatedModels);
  }, [provider.models, hasFetchedRemote]);

  const fetchModels = async () => {
    setLoading(true);
    const isUsingCustomUrl = !!customBaseUrl.trim();
    setHasCustomUrl(isUsingCustomUrl);

    try {
      const res = await fetch("/api/ai-models/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey: apiKey || undefined,
          customBaseUrl: customBaseUrl.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (data.models && data.models.length > 0) {
        const remoteIds = new Set<string>(
          data.models.map((m: { id: string }) => m.id)
        );

        const remoteModels = data.models.map(
          (m: { id: string; name: string }) => ({
            id: m.id,
            name: m.name || m.id,
            availability: "available" as ModelAvailability,
          })
        );

        if (isUsingCustomUrl) {
          const presetOnlyModels = provider.models
            .filter((pm) => !remoteIds.has(pm.id))
            .map((m) => ({
              ...m,
              availability: "unavailable" as ModelAvailability,
            }));

          setModels([...remoteModels, ...presetOnlyModels]);
        } else {
          setModels(remoteModels);
        }
        setModelSource(data.source);
        setHasFetchedRemote(true);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualInputToggle = () => {
    if (isManualInput) {
      if (manualModel.trim()) {
        onModelChange(manualModel.trim());
      }
      setIsManualInput(false);
    } else {
      setManualModel(selectedModel);
      setIsManualInput(true);
    }
  };

  const handleManualInputConfirm = () => {
    if (manualModel.trim()) {
      onModelChange(manualModel.trim());
      if (!models.find((m) => m.id === manualModel.trim())) {
        setModels([
          ...models,
          {
            id: manualModel.trim(),
            name: manualModel.trim(),
            availability: "unknown",
          },
        ]);
      }
    }
    setIsManualInput(false);
  };

  const handleSelectModel = (modelId: string) => {
    onModelChange(modelId);
    setDropdownOpen(false);
  };

  const currentModel = models.find((m) => m.id === selectedModel);
  const currentModelName = currentModel?.name || selectedModel;
  const currentModelAvailability = currentModel?.availability || "unknown";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm text-gray-400">
          选择模型
          {hasCustomUrl && modelSource === "remote" && (
            <span className="ml-2 text-xs text-gray-500">
              (绿色=可用, 红色=不可用, 灰色=未检测)
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          {modelSource === "remote" && (
            <span className="text-xs text-green-400">已从 API 获取</span>
          )}
          <button
            type="button"
            onClick={fetchModels}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            title="从 API 获取模型列表"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleManualInputToggle}
            className="text-xs text-gray-400 hover:text-gray-300"
          >
            {isManualInput ? "选择模式" : "手动输入"}
          </button>
        </div>
      </div>

      {isManualInput ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={manualModel}
            onChange={(e) => setManualModel(e.target.value)}
            placeholder="输入模型 ID，如 gpt-4o"
            className="flex-1 rounded-lg bg-gray-700 px-4 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleManualInputConfirm}
            className="rounded-lg bg-blue-600 px-3 py-2 text-white transition hover:bg-blue-700"
          >
            <Check size={16} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex w-full items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-left text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {currentModelAvailability === "available" && (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
            )}
            {currentModelAvailability === "unavailable" && (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
            )}
            {currentModelAvailability === "unknown" && (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-500" />
            )}
            <span className="flex-1 truncate">
              {currentModelName || "选择模型"}
            </span>
            {selectedModel && <ModelCapabilityIcons modelId={selectedModel} />}
            {currentModelAvailability === "unavailable" && (
              <span className="flex-shrink-0 text-xs text-red-400">不可用</span>
            )}
            <ChevronDown
              size={16}
              className={`flex-shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg bg-gray-700 shadow-lg">
              {models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectModel(model.id)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left transition hover:bg-gray-600 ${
                    selectedModel === model.id
                      ? "bg-gray-600 text-blue-400"
                      : "text-white"
                  } ${model.availability === "unavailable" ? "opacity-60" : ""}`}
                >
                  {model.availability === "available" && (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
                      title="可用"
                    />
                  )}
                  {model.availability === "unavailable" && (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500"
                      title="不可用"
                    />
                  )}
                  {model.availability === "unknown" && (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-500"
                      title="未检测"
                    />
                  )}
                  <span className="flex-1 truncate">{model.name}</span>
                  <ModelCapabilityIcons modelId={model.id} />
                  {model.availability === "unavailable" && (
                    <span className="flex-shrink-0 text-xs text-red-400">
                      不可用
                    </span>
                  )}
                  {selectedModel === model.id && (
                    <Check size={14} className="flex-shrink-0" />
                  )}
                </button>
              ))}
              {models.length === 0 && (
                <div className="px-4 py-2 text-sm text-gray-400">暂无模型</div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-1 text-xs text-gray-500">
        点击「刷新」从 API 获取最新模型列表，或切换到「手动输入」添加自定义模型
      </p>
    </div>
  );
}
