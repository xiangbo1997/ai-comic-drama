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
    (c: UserConfig) => c.provider.category === category && c.testStatus === "SUCCESS"
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
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 获取显示的模型名称
  const getDisplayName = (config: UserConfig) => {
    const model = config.provider.models.find((m) => m.id === config.selectedModel);
    return model?.name || config.provider.name;
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-1 text-gray-400 ${size === "sm" ? "text-xs" : "text-sm"}`}>
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

  const sizeClasses = size === "sm"
    ? "px-2 py-1 text-xs gap-1"
    : "px-3 py-1.5 text-sm gap-2";

  return (
    <div className="flex items-center gap-1" ref={dropdownRef}>
      {/* 下拉选择器 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`flex items-center ${sizeClasses} bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition`}
        >
          <span className="truncate max-w-[120px]">
            {selectedConfig ? getDisplayName(selectedConfig) : "选择模型"}
          </span>
          <ChevronDown size={size === "sm" ? 12 : 14} className={`transition ${isOpen ? "rotate-180" : ""}`} />
        </button>

        {/* 下拉菜单 */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
            {configs.map((config) => (
              <button
                key={config.id}
                onClick={() => {
                  onChange?.(config.id, config.selectedModel || "");
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-700 transition ${
                  selectedConfig?.id === config.id ? "bg-gray-700" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{getDisplayName(config)}</div>
                  <div className="text-xs text-gray-400 truncate">{config.provider.name}</div>
                </div>
                {selectedConfig?.id === config.id && (
                  <Check size={14} className="text-blue-400 shrink-0" />
                )}
                {config.isDefault && (
                  <span className="text-xs text-yellow-400 shrink-0">默认</span>
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
          className={`${size === "sm" ? "p-1" : "p-1.5"} text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-50 rounded-lg transition`}
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
    (c: UserConfig) => c.provider.category === category && c.testStatus === "SUCCESS"
  );

  const defaultConfig = configs.find((c) => c.isDefault) || configs[0];

  return {
    configs,
    defaultConfig,
    hasConfigs: configs.length > 0,
  };
}
