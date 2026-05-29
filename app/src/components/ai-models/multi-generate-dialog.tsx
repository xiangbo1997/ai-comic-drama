"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2, Zap, Clock } from "lucide-react";

interface AIModel {
  id: string;
  name: string;
  costPerUnit?: number;
}

interface AIProvider {
  id: string;
  name: string;
  slug: string;
  category: "LLM" | "IMAGE" | "VIDEO" | "TTS";
  models: AIModel[];
}

interface UserConfig {
  id: string;
  providerId: string;
  provider: AIProvider;
  selectedModel: string | null;
  isDefault: boolean;
  testStatus: "SUCCESS" | "FAILED" | "PENDING" | null;
}

interface Preference {
  concurrencyMode: "SERIAL" | "PARALLEL";
  maxConcurrent: number;
}

interface MultiGenerateDialogProps {
  category: "IMAGE" | "VIDEO" | "TTS";
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (
    configs: { configId: string; modelId: string }[],
    mode: "SERIAL" | "PARALLEL"
  ) => void;
  isGenerating?: boolean;
}

// 获取用户已配置的模型
async function fetchUserConfigs() {
  const res = await fetch("/api/ai-models/configs");
  if (!res.ok) throw new Error("获取配置失败");
  return res.json();
}

// 获取用户偏好
async function fetchPreferences() {
  const res = await fetch("/api/ai-models/preferences");
  if (!res.ok) throw new Error("获取偏好失败");
  return res.json();
}

export function MultiGenerateDialog({
  category,
  isOpen,
  onClose,
  onGenerate,
  isGenerating = false,
}: MultiGenerateDialogProps) {
  const [selectedConfigs, setSelectedConfigs] = useState<Set<string>>(
    new Set()
  );
  const [mode, setMode] = useState<"SERIAL" | "PARALLEL">("PARALLEL");

  const { data: configsData, isLoading: configsLoading } = useQuery({
    queryKey: ["ai-configs"],
    queryFn: fetchUserConfigs,
    enabled: isOpen,
  });

  const { data: prefData } = useQuery({
    queryKey: ["ai-preferences"],
    queryFn: fetchPreferences,
    enabled: isOpen,
  });

  // 过滤出当前分类的配置
  const configs: UserConfig[] = (configsData?.configs || []).filter(
    (c: UserConfig) =>
      c.provider.category === category && c.testStatus === "SUCCESS"
  );

  const preference: Preference | undefined = prefData?.preference;

  // 初始化选中状态和模式
  const configsLength = configs.length;
  const preferredMode = preference?.concurrencyMode;
  useEffect(() => {
    if (isOpen && configsLength > 0) {
      // 默认选中默认配置
      const defaultConfig = configs.find((c) => c.isDefault) || configs[0];
      if (defaultConfig) {
        setSelectedConfigs(new Set([defaultConfig.id]));
      }
    }
    if (preferredMode) {
      setMode(preferredMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, configsLength, preferredMode]);

  // 切换选中状态
  const toggleConfig = (configId: string) => {
    setSelectedConfigs((prev) => {
      const next = new Set(prev);
      if (next.has(configId)) {
        next.delete(configId);
      } else {
        next.add(configId);
      }
      return next;
    });
  };

  // 计算预估积分
  const estimatedCredits = Array.from(selectedConfigs).reduce(
    (total, configId) => {
      const config = configs.find((c) => c.id === configId);
      if (!config) return total;
      const model = config.provider.models.find(
        (m) => m.id === config.selectedModel
      );
      return total + (model?.costPerUnit || 1);
    },
    0
  );

  // 获取显示的模型名称
  const getDisplayName = (config: UserConfig) => {
    const model = config.provider.models.find(
      (m) => m.id === config.selectedModel
    );
    return model?.name || config.provider.name;
  };

  // 获取模型积分
  const getModelCost = (config: UserConfig) => {
    const model = config.provider.models.find(
      (m) => m.id === config.selectedModel
    );
    return model?.costPerUnit || 1;
  };

  // 开始生成
  const handleGenerate = () => {
    const selectedList = Array.from(selectedConfigs).map((configId) => {
      const config = configs.find((c) => c.id === configId)!;
      return {
        configId,
        modelId: config.selectedModel || "",
      };
    });
    onGenerate(selectedList, mode);
  };

  if (!isOpen) return null;

  const categoryLabels = {
    IMAGE: "图像",
    VIDEO: "视频",
    TTS: "配音",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-md rounded-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            多版本{categoryLabels[category]}生成
          </h2>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="hover:bg-secondary rounded-lg p-1 transition disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {configsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2
                size={24}
                className="text-muted-foreground animate-spin"
              />
            </div>
          ) : configs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground mb-4">
                暂无可用的{categoryLabels[category]}模型配置
              </p>
              <a
                href="/settings/ai-models"
                className="text-primary hover:text-primary/80"
              >
                前往配置
              </a>
            </div>
          ) : (
            <>
              {/* 模型选择 */}
              <div className="mb-6">
                <label className="text-muted-foreground mb-3 block text-sm">
                  选择模型（可多选）
                </label>
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {configs.map((config) => (
                    <label
                      key={config.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 transition ${
                        selectedConfigs.has(config.id)
                          ? "border-primary bg-primary/20 border"
                          : "bg-secondary hover:bg-secondary/80 border border-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedConfigs.has(config.id)}
                        onChange={() => toggleConfig(config.id)}
                        className="border-border bg-secondary text-primary focus:ring-primary h-4 w-4 rounded"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {getDisplayName(config)}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {config.provider.name}
                        </div>
                      </div>
                      <div className="text-muted-foreground text-sm">
                        ~{getModelCost(config)} 积分
                      </div>
                      {config.isDefault && (
                        <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                          默认
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* 生成策略 */}
              <div className="mb-6">
                <label className="text-muted-foreground mb-3 block text-sm">
                  生成策略
                </label>
                <div className="flex gap-3">
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg p-3 transition ${
                      mode === "SERIAL"
                        ? "border-primary bg-primary/20 border"
                        : "bg-secondary hover:bg-secondary/80 border border-transparent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === "SERIAL"}
                      onChange={() => setMode("SERIAL")}
                      className="border-border bg-secondary text-primary h-4 w-4"
                    />
                    <Clock size={16} className="text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">串行</div>
                      <div className="text-muted-foreground text-xs">
                        依次生成
                      </div>
                    </div>
                  </label>
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg p-3 transition ${
                      mode === "PARALLEL"
                        ? "border-primary bg-primary/20 border"
                        : "bg-secondary hover:bg-secondary/80 border border-transparent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === "PARALLEL"}
                      onChange={() => setMode("PARALLEL")}
                      className="border-border bg-secondary text-primary h-4 w-4"
                    />
                    <Zap size={16} className="text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">并行</div>
                      <div className="text-muted-foreground text-xs">
                        同时生成
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* 预估消耗 */}
              <div className="bg-secondary/50 mb-6 flex items-center justify-between rounded-lg px-4 py-3">
                <span className="text-muted-foreground">预估消耗</span>
                <span className="text-lg font-semibold text-yellow-400">
                  {estimatedCredits} 积分
                </span>
              </div>

              {/* 按钮 */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={isGenerating}
                  className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg px-4 py-2 transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={selectedConfigs.size === 0 || isGenerating}
                  className="bg-primary hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 transition disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>开始生成 ({selectedConfigs.size})</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
