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
import { useToast } from "@/components/ui/toast";

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
  const toast = useToast();
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
    } catch {
      // 拉取失败给出可行动提示（面板支持手动输入模型名兜底）
      toast.error("获取模型列表失败，可手动输入模型名");
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
        <label className="text-muted-foreground block text-sm">
          选择模型
          {hasCustomUrl && modelSource === "remote" && (
            <span className="text-muted-foreground ml-2 text-xs">
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
            className="text-primary hover:text-primary/80 flex items-center gap-1 text-xs"
            title="从 API 获取模型列表"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleManualInputToggle}
            className="text-muted-foreground hover:text-foreground text-xs"
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
            className="bg-secondary text-foreground placeholder-muted-foreground focus:ring-primary flex-1 rounded-lg px-4 py-2 focus:ring-2 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleManualInputConfirm}
            className="bg-primary text-foreground hover:bg-primary/90 rounded-lg px-3 py-2 transition"
          >
            <Check size={16} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="bg-secondary text-foreground focus:ring-primary flex w-full items-center gap-2 rounded-lg px-4 py-2 text-left focus:ring-2 focus:outline-none"
          >
            {currentModelAvailability === "available" && (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
            )}
            {currentModelAvailability === "unavailable" && (
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
            )}
            {currentModelAvailability === "unknown" && (
              <span className="bg-muted-foreground h-2 w-2 flex-shrink-0 rounded-full" />
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
            <div className="bg-secondary absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg shadow-lg">
              {models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectModel(model.id)}
                  className={`hover:bg-secondary/80 flex w-full items-center gap-2 px-4 py-2 text-left transition ${
                    selectedModel === model.id
                      ? "bg-secondary text-primary"
                      : "text-foreground"
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
                      className="bg-muted-foreground h-2 w-2 flex-shrink-0 rounded-full"
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
                <div className="text-muted-foreground px-4 py-2 text-sm">
                  暂无模型
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-muted-foreground mt-1 text-xs">
        点击「刷新」从 API 获取最新模型列表，或切换到「手动输入」添加自定义模型
      </p>
    </div>
  );
}
