"use client";

import { useState } from "react";
import {
  Check,
  X,
  Loader2,
  Settings,
  Trash2,
  TestTube,
  Star,
  Edit3,
  Plus,
  AlertTriangle,
} from "lucide-react";
import type { AIProvider, UserConfig } from "./types";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

interface ProviderCardProps {
  provider: AIProvider;
  config?: UserConfig;
  onConfigure: () => void;
  onRefresh: () => void;
  onEditProvider?: () => void;
  onDeleteProvider?: () => void;
}

export function ProviderCard({
  provider,
  config,
  onConfigure,
  onRefresh,
  onEditProvider,
  onDeleteProvider,
}: ProviderCardProps) {
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  const testConnection = async () => {
    if (!config) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/ai-models/configs/${config.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`连接成功！延迟: ${data.latency}ms`);
      } else {
        toast.error(`连接失败: ${data.message}`);
      }
      onRefresh();
    } catch {
      toast.error("测试失败");
    } finally {
      setTesting(false);
    }
  };

  const setAsDefault = async () => {
    if (!config) return;
    try {
      // 补 res.ok 检查：此前 4xx/5xx 也会弹「已设为默认」的假成功提示
      const res = await fetch(`/api/ai-models/configs/${config.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) throw new Error("设置失败");
      onRefresh();
      toast.success("已设为默认");
    } catch {
      toast.error("设置失败");
    }
  };

  const deleteConfig = async () => {
    if (!config) return;
    // 删默认配置单独告知后果：该分类将失去默认模型，后续生成可能失败
    const ok = await toast.confirm(
      config.isDefault
        ? "此配置是当前分类的默认模型。\n删除后该分类将没有默认配置，相关生成可能失败，需重新指定默认或新建配置。确定删除？"
        : "确定要删除此配置吗？"
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/ai-models/configs/${config.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      onRefresh();
      toast.success("配置已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  return (
    <div className="border-border bg-card rounded-xl border p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-foreground text-lg font-semibold">
              {provider.name}
            </h3>
            {provider.isCustom && (
              // 状态徽章统一走 Badge 语义变体（走 token，替代裸色阶，a4 P1-4）
              <Badge variant="info">自定义</Badge>
            )}
            {config?.isDefault && (
              <Badge variant="warning">
                <Star size={12} fill="currentColor" />
                默认
              </Badge>
            )}
            {config?.testStatus === "SUCCESS" && (
              <Badge variant="success">
                <Check size={12} />
                已连接
              </Badge>
            )}
            {config?.testStatus === "FAILED" && (
              <Badge variant="destructive">
                <X size={12} />
                连接失败
              </Badge>
            )}
            {config?.authType === "CHATGPT_TOKEN" && (
              <Badge variant="warning">ChatGPT Token</Badge>
            )}
          </div>
          {config?.authType === "CHATGPT_TOKEN" &&
            config.tokenExpiresAt &&
            (() => {
              const expires = new Date(config.tokenExpiresAt);
              const now = new Date();
              const daysLeft = Math.ceil(
                (expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
              );
              if (daysLeft <= 0) {
                return (
                  <div className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle size={12} />
                    Token 已过期，请重新获取
                  </div>
                );
              }
              if (daysLeft <= 7) {
                return (
                  <div className="mt-1 flex items-center gap-1 text-xs text-yellow-400">
                    <AlertTriangle size={12} />
                    Token 将在 {daysLeft} 天后过期
                  </div>
                );
              }
              return null;
            })()}
          <p className="text-muted-foreground mb-3 text-sm">
            {provider.description}
          </p>

          {config ? (
            <div className="text-foreground text-sm">
              <span className="text-muted-foreground">API Key: </span>
              <code className="bg-secondary rounded px-2 py-0.5">
                {config.apiKeyMasked}
              </code>
              {config.selectedModel && (
                <span className="ml-4">
                  <span className="text-muted-foreground">模型: </span>
                  {provider.models.find((m) => m.id === config.selectedModel)
                    ?.name || config.selectedModel}
                </span>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">未配置</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {provider.isCustom && (
            <>
              {onEditProvider && (
                <button
                  onClick={onEditProvider}
                  className="text-muted-foreground hover:bg-secondary hover:text-primary rounded-lg p-2 transition"
                  title="编辑提供商"
                >
                  <Edit3 size={18} />
                </button>
              )}
              {onDeleteProvider && (
                <button
                  onClick={onDeleteProvider}
                  className="text-muted-foreground hover:bg-secondary rounded-lg p-2 transition hover:text-red-400"
                  title="删除提供商"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </>
          )}
          {config && (
            <>
              <button
                onClick={testConnection}
                disabled={testing}
                className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg p-2 transition"
                title="测试连接"
              >
                {testing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <TestTube size={18} />
                )}
              </button>
              {!config.isDefault && (
                <button
                  onClick={setAsDefault}
                  className="text-muted-foreground hover:bg-secondary rounded-lg p-2 transition hover:text-yellow-400"
                  title="设为默认"
                >
                  <Star size={18} />
                </button>
              )}
              {!provider.isCustom && (
                <button
                  onClick={deleteConfig}
                  className="text-muted-foreground hover:bg-secondary rounded-lg p-2 transition hover:text-red-400"
                  title="删除配置"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </>
          )}
          <button
            onClick={onConfigure}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 transition ${
              config
                ? "bg-secondary text-foreground hover:bg-secondary/80"
                : "bg-primary text-foreground hover:bg-primary/90"
            }`}
          >
            {config ? (
              <>
                <Settings size={16} />
                修改
              </>
            ) : (
              <>
                <Plus size={16} />
                配置
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
