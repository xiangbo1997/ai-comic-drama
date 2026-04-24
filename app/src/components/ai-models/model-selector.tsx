"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Check, Loader2, Settings2 } from "lucide-react";

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

interface ModelSelectorProps {
  category: "LLM" | "IMAGE" | "VIDEO" | "TTS";
  value?: string; // configId
  onChange?: (configId: string, modelId: string) => void;
  onOpenMultiSelect?: () => void;
  disabled?: boolean;
  showMultiSelectButton?: boolean;
  size?: "sm" | "md";
}

// 获取用户已配置的模型
async function fetchUserConfigs() {
  const res = await fetch("/api/ai-models/configs");
  if (!res.ok) throw new Error("获取配置失败");
  return res.json();
}

export function ModelSelector({
  category,
  value,
  onChange,
  onOpenMultiSelect,
  disabled = false,
  showMultiSelectButton = false,
  size = "md",
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-configs"],
    queryFn: fetchUserConfigs,
    staleTime: 30000, // 30秒内不重新请求
  });

  // 过滤出当前分类的配置
  const configs: UserConfig[] = (data?.configs || []).filter(
    (c: UserConfig) =>
      c.provider.category === category && c.testStatus === "SUCCESS"
  );

  // 找到默认配置
  const defaultConfig = configs.find((c) => c.isDefault) || configs[0];

  // 当前选中的配置
  const selectedConfig = value
    ? configs.find((c) => c.id === value)
    : defaultConfig;

  // 点击外部关闭下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 获取显示的模型名称
  const getDisplayName = (config: UserConfig) => {
    const model = config.provider.models.find(
      (m) => m.id === config.selectedModel
    );
    return model?.name || config.provider.name;
  };

  if (isLoading) {
    return (
      <div
        className={`flex items-center gap-1 text-gray-400 ${size === "sm" ? "text-xs" : "text-sm"}`}
      >
        <Loader2 size={size === "sm" ? 12 : 14} className="animate-spin" />
        <span>加载中...</span>
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <a
        href="/settings/ai-models"
        className={`text-blue-400 hover:text-blue-300 ${size === "sm" ? "text-xs" : "text-sm"}`}
      >
        配置模型
      </a>
    );
  }

  const sizeClasses =
    size === "sm" ? "px-2 py-1 text-xs gap-1" : "px-3 py-1.5 text-sm gap-2";

  return (
    <div className="flex items-center gap-1" ref={dropdownRef}>
      {/* 下拉选择器 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`flex items-center ${sizeClasses} rounded-lg bg-gray-700 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="max-w-[120px] truncate">
            {selectedConfig ? getDisplayName(selectedConfig) : "选择模型"}
          </span>
          <ChevronDown
            size={size === "sm" ? 12 : 14}
            className={`transition ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {/* 下拉菜单 */}
        {isOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 max-h-60 w-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
            {configs.map((config) => (
              <button
                key={config.id}
                onClick={() => {
                  onChange?.(config.id, config.selectedModel || "");
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-700 ${
                  selectedConfig?.id === config.id ? "bg-gray-700" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {getDisplayName(config)}
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {config.provider.name}
                  </div>
                </div>
                {selectedConfig?.id === config.id && (
                  <Check size={14} className="shrink-0 text-blue-400" />
                )}
                {config.isDefault && (
                  <span className="shrink-0 text-xs text-yellow-400">默认</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 多版本生成按钮 */}
      {showMultiSelectButton && onOpenMultiSelect && (
        <button
          type="button"
          onClick={onOpenMultiSelect}
          disabled={disabled}
          className={`${size === "sm" ? "p-1" : "p-1.5"} rounded-lg text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50`}
          title="多版本生成"
        >
          <Settings2 size={size === "sm" ? 14 : 16} />
        </button>
      )}
    </div>
  );
}

// 导出一个 hook 用于获取当前选中的模型配置
export function useSelectedModel(category: "LLM" | "IMAGE" | "VIDEO" | "TTS") {
  const { data } = useQuery({
    queryKey: ["ai-configs"],
    queryFn: fetchUserConfigs,
    staleTime: 30000,
  });

  const configs: UserConfig[] = (data?.configs || []).filter(
    (c: UserConfig) =>
      c.provider.category === category && c.testStatus === "SUCCESS"
  );

  const defaultConfig = configs.find((c) => c.isDefault) || configs[0];

  return {
    configs,
    defaultConfig,
    hasConfigs: configs.length > 0,
  };
}
