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

  // 当前分类的全部配置（含未测试/测试失败的，用于空态诊断）
  const categoryConfigs: UserConfig[] = (data?.configs || []).filter(
    (c: UserConfig) => c.provider.category === category
  );

  // 可选配置：仅测试成功的才允许被选中生成，避免拿一个连通性未知的配置去烧积分
  const configs: UserConfig[] = categoryConfigs.filter(
    (c) => c.testStatus === "SUCCESS"
  );

  // 已配置但未通过测试的（含 testStatus 为 null 的「从未测试」）。
  // 这些配置在设置页可见、甚至可被设为「默认」，却不会出现在这里——
  // 若不显式说明，用户会看到「我明明设了默认却选不到」的矛盾（实际发生过）。
  const untestedConfigs = categoryConfigs.filter(
    (c) => c.testStatus !== "SUCCESS"
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
        className={`text-muted-foreground flex items-center gap-1 ${size === "sm" ? "text-xs" : "text-sm"}`}
      >
        <Loader2 size={size === "sm" ? 12 : 14} className="animate-spin" />
        <span>加载中...</span>
      </div>
    );
  }

  if (configs.length === 0) {
    // 区分「没配过」与「配了但没测试通过」——后者用户已经做了配置工作，
    // 只是缺最后一步测试，给出的指引必须不同，否则他会反复去检查配置本身。
    const hint =
      untestedConfigs.length > 0
        ? `${untestedConfigs.map((c) => c.provider.name).join("、")} 需先测试`
        : "配置模型";
    return (
      <a
        href="/settings/ai-models"
        title={
          untestedConfigs.length > 0
            ? "配置需测试成功后才能用于生成：请到「设置 > AI 模型」点该配置的测试按钮"
            : undefined
        }
        className={`text-primary hover:text-primary/80 ${size === "sm" ? "text-xs" : "text-sm"}`}
      >
        {hint}
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
          className={`flex items-center ${sizeClasses} bg-secondary hover:bg-secondary/80 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50`}
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
          <div className="border-border bg-card absolute top-full left-0 z-50 mt-1 max-h-60 w-48 overflow-y-auto rounded-lg border py-1 shadow-xl">
            {configs.map((config) => (
              <button
                key={config.id}
                onClick={() => {
                  onChange?.(config.id, config.selectedModel || "");
                  setIsOpen(false);
                }}
                className={`hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  selectedConfig?.id === config.id ? "bg-secondary" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {getDisplayName(config)}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {config.provider.name}
                  </div>
                </div>
                {selectedConfig?.id === config.id && (
                  <Check size={14} className="text-primary shrink-0" />
                )}
                {config.isDefault && (
                  <span className="shrink-0 text-xs text-yellow-400">默认</span>
                )}
              </button>
            ))}

            {/* 已配置但未通过测试的配置：列出来并说明原因。
                不列的话，用户在设置页看到它（甚至标着「默认」）却在这里找不到，
                会误以为是 bug 或配置丢失——静默过滤是最难排查的一类问题。 */}
            {untestedConfigs.length > 0 && (
              <div className="border-border mt-1 border-t pt-1">
                {untestedConfigs.map((config) => (
                  <div
                    key={config.id}
                    className="px-3 py-2 text-left text-sm opacity-50"
                    title="该配置尚未测试成功，无法用于生成。请到「设置 > AI 模型」点测试按钮"
                  >
                    <div className="text-muted-foreground truncate">
                      {getDisplayName(config)}
                    </div>
                    <div className="truncate text-xs text-amber-500/80">
                      {config.testStatus === "FAILED"
                        ? "测试失败，去设置页重试"
                        : "未测试，去设置页点测试"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 多版本生成按钮 */}
      {showMultiSelectButton && onOpenMultiSelect && (
        <button
          type="button"
          onClick={onOpenMultiSelect}
          disabled={disabled}
          className={`${size === "sm" ? "p-1" : "p-1.5"} text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg transition disabled:opacity-50`}
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
