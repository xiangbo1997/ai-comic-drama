"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Settings } from "lucide-react";
import type { AICategory, AIProvider, UserConfig } from "./components/types";
import { categoryIcons, categoryLabels } from "./components/types";
import { ProviderCard } from "./components/ProviderCard";
import { ConfigDialog } from "./components/ConfigDialog";
import { PreferenceSettings } from "./components/PreferenceSettings";
import { CustomProviderDialog } from "./components/CustomProviderDialog";

export default function AIModelsPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<AICategory>("LLM");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(
    null
  );
  const [editingConfig, setEditingConfig] = useState<UserConfig | null>(null);
  const [customProviderDialogOpen, setCustomProviderDialogOpen] =
    useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(
    null
  );

  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: async () => {
      const res = await fetch("/api/ai-models/providers");
      if (!res.ok) throw new Error("获取提供商失败");
      return res.json();
    },
  });

  const { data: configsData, isLoading: configsLoading } = useQuery({
    queryKey: ["ai-configs"],
    queryFn: async () => {
      const res = await fetch("/api/ai-models/configs");
      if (!res.ok) throw new Error("获取配置失败");
      return res.json();
    },
  });

  const { data: preferenceData } = useQuery({
    queryKey: ["ai-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/ai-models/preferences");
      if (!res.ok) throw new Error("获取偏好失败");
      return res.json();
    },
  });

  const providers = providersData?.categories?.[activeCategory] || [];
  const configs = configsData?.configs || [];
  const preference = preferenceData?.preference;

  const getConfigForProvider = (providerId: string) => {
    return configs.find((c: UserConfig) => c.providerId === providerId);
  };

  const openConfigDialog = (
    provider: AIProvider,
    existingConfig?: UserConfig
  ) => {
    setSelectedProvider(provider);
    setEditingConfig(existingConfig || null);
    setConfigDialogOpen(true);
  };

  const openCustomProviderDialog = (provider?: AIProvider) => {
    setEditingProvider(provider || null);
    setCustomProviderDialogOpen(true);
  };

  const deleteCustomProvider = async (provider: AIProvider) => {
    if (
      !confirm(
        `确定要删除自定义提供商「${provider.name}」吗？相关配置也会被删除。`
      )
    )
      return;
    try {
      const res = await fetch(`/api/ai-models/providers/${provider.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      queryClient.invalidateQueries({ queryKey: ["ai-configs"] });
    } catch {
      alert("删除失败");
    }
  };

  if (providersLoading || configsLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-white">AI 模型配置</h1>
        <p className="text-gray-400">配置你的 AI 服务 API Key，选择默认模型</p>
      </div>

      <div className="mb-6 flex w-fit gap-2 rounded-lg bg-gray-800 p-1">
        {(["LLM", "IMAGE", "VIDEO", "TTS"] as const).map((category) => {
          const Icon = categoryIcons[category];
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 transition ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <Icon size={18} />
              <span className="hidden sm:inline">
                {categoryLabels[category]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {providers.map((provider: AIProvider) => {
          const config = getConfigForProvider(provider.id);
          return (
            <ProviderCard
              key={provider.id}
              provider={provider}
              config={config}
              onConfigure={() => openConfigDialog(provider, config)}
              onRefresh={() =>
                queryClient.invalidateQueries({ queryKey: ["ai-configs"] })
              }
              onEditProvider={
                provider.isCustom
                  ? () => openCustomProviderDialog(provider)
                  : undefined
              }
              onDeleteProvider={
                provider.isCustom
                  ? () => deleteCustomProvider(provider)
                  : undefined
              }
            />
          );
        })}

        <button
          onClick={() => openCustomProviderDialog()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-600 bg-gray-800/50 p-5 text-gray-400 transition hover:border-blue-500 hover:bg-gray-800 hover:text-blue-400"
        >
          <Plus size={20} />
          <span>添加自定义提供商</span>
        </button>
      </div>

      {preference && (
        <div className="mt-8 rounded-xl bg-gray-800 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <Settings size={20} />
            生成策略
          </h2>
          <PreferenceSettings preference={preference} />
        </div>
      )}

      {configDialogOpen && selectedProvider && (
        <ConfigDialog
          provider={selectedProvider}
          existingConfig={editingConfig}
          onClose={() => {
            setConfigDialogOpen(false);
            setSelectedProvider(null);
            setEditingConfig(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["ai-configs"] });
            setConfigDialogOpen(false);
            setSelectedProvider(null);
            setEditingConfig(null);
          }}
        />
      )}

      {customProviderDialogOpen && (
        <CustomProviderDialog
          category={activeCategory}
          existingProvider={editingProvider}
          onClose={() => {
            setCustomProviderDialogOpen(false);
            setEditingProvider(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
            setCustomProviderDialogOpen(false);
            setEditingProvider(null);
          }}
        />
      )}
    </div>
  );
}
