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
import { useToast } from "@/components/ui/toast";

export default function AIModelsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
    const ok = await toast.confirm(
      `确定要删除自定义提供商「${provider.name}」吗？相关配置也会被删除。`
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/ai-models/providers/${provider.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      queryClient.invalidateQueries({ queryKey: ["ai-configs"] });
      toast.success("提供商已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  if (providersLoading || configsLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-foreground mb-2 text-2xl font-bold">AI 模型配置</h1>
        <p className="text-muted-foreground">
          配置你的 AI 服务 API Key，选择默认模型
        </p>
      </div>

      <div className="bg-card mb-6 flex w-fit gap-2 rounded-lg p-1">
        {(["LLM", "IMAGE", "VIDEO", "TTS"] as const).map((category) => {
          const Icon = categoryIcons[category];
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 transition ${
                isActive
                  ? "bg-primary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
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
          className="border-border bg-card/50 text-muted-foreground hover:border-primary hover:bg-card hover:text-primary flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition"
        >
          <Plus size={20} />
          <span>添加自定义提供商</span>
        </button>
      </div>

      {preference && (
        <div className="bg-card mt-8 rounded-xl p-6">
          <h2 className="text-foreground mb-4 flex items-center gap-2 text-lg font-semibold">
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
