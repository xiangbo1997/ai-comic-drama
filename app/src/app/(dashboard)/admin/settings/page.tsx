"use client";

/**
 * 系统设置页
 *
 * 按分组（积分 / 定价 / 上限 / 功能开关）列出全部配置项，行内编辑并逐项保存。
 * 校验分两道：客户端先用 min/max/type 做即时反馈，服务端 setSystemConfig 再校
 * 验一次（客户端校验只是体验，不是防线）。
 *
 * 保存需要超级管理员；普通管理员进来只读，编辑控件禁用并给出说明。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-client";

import { AdminPageHeader } from "../components/AdminPageHeader";

interface ConfigItem {
  key: string;
  value: number | string | boolean;
  default: number | string | boolean;
  type: "int" | "number" | "string" | "boolean";
  label: string;
  group: "credits" | "pricing" | "limits" | "feature";
  description: string;
  min?: number;
  max?: number;
  updatedAt: string | null;
}

/** 分组展示顺序与中文名 */
const GROUP_LABELS: Array<{ key: ConfigItem["group"]; label: string }> = [
  { key: "credits", label: "积分与激励" },
  { key: "pricing", label: "生成定价" },
  { key: "limits", label: "上限" },
  { key: "feature", label: "功能开关" },
];

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();

  // 行内编辑草稿：key → 输入框当前值。未编辑的项不在其中，直接显示服务端值。
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-system-config"],
    queryFn: () =>
      adminFetch<{ items: ConfigItem[] }>("/api/admin/system-config"),
  });

  const mutation = useMutation({
    mutationFn: (vars: { key: string; value: string }) =>
      adminFetch<{ item: ConfigItem }>("/api/admin/system-config", {
        method: "PUT",
        body: JSON.stringify({ key: vars.key, value: vars.value }),
      }),
    onSuccess: (_result, vars) => {
      // 保存成功后丢弃草稿，回到「显示服务端值」状态
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.key];
        return next;
      });
      setRowError((prev) => {
        const next = { ...prev };
        delete next[vars.key];
        return next;
      });
      setSavedKey(vars.key);
      void queryClient.invalidateQueries({ queryKey: ["admin-system-config"] });
    },
    onError: (err, vars) => {
      setRowError((prev) => ({
        ...prev,
        [vars.key]: err instanceof Error ? err.message : "保存失败",
      }));
    },
  });

  /** 客户端预校验：与服务端 validateSystemConfigValue 同规则，仅为即时反馈 */
  const validate = (item: ConfigItem, raw: string): string | null => {
    if (item.type === "boolean") {
      return raw === "true" || raw === "false" ? null : "必须是 true / false";
    }
    if (item.type === "string") return null;

    if (raw.trim() === "") return "不能为空";
    const num = Number(raw);
    if (!Number.isFinite(num)) return "必须是有效数字";
    if (item.type === "int" && !Number.isInteger(num)) return "必须是整数";
    if (item.min !== undefined && num < item.min) return `不能小于 ${item.min}`;
    if (item.max !== undefined && num > item.max) return `不能大于 ${item.max}`;
    return null;
  };

  const handleSave = (item: ConfigItem) => {
    const raw = drafts[item.key];
    if (raw === undefined) return;
    const message = validate(item, raw);
    if (message) {
      setRowError((prev) => ({ ...prev, [item.key]: message }));
      return;
    }
    setSavedKey(null);
    mutation.mutate({ key: item.key, value: raw });
  };

  const handleChange = (key: string, raw: string) => {
    setDrafts((prev) => ({ ...prev, [key]: raw }));
    setRowError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSavedKey(null);
  };

  const items = data?.items ?? [];

  return (
    <div>
      <AdminPageHeader
        title="系统设置"
        description="运营期可调的数值：注册赠送、签到与邀请奖励、各类生成单价。留空的项使用代码内默认值。"
      />

      {!isSuperAdmin && (
        <p className="border-border text-muted-foreground mb-4 rounded-lg border px-4 py-3 text-sm">
          你的角色为普通管理员，此页只读。修改系统配置需要超级管理员权限。
        </p>
      )}

      {isLoading && <p className="text-muted-foreground text-sm">加载中...</p>}

      {error && (
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {!isLoading && !error && (
        <div className="space-y-8">
          {GROUP_LABELS.map(({ key: group, label }) => {
            const groupItems = items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;

            return (
              <section key={group}>
                <h2 className="mb-3 text-lg font-medium">{label}</h2>
                <div className="border-border divide-border divide-y rounded-lg border">
                  {groupItems.map((item) => {
                    const draft = drafts[item.key];
                    const current = String(item.value);
                    const shown = draft ?? current;
                    const dirty = draft !== undefined && draft !== current;
                    const isDefault = item.value === item.default;
                    const saving =
                      mutation.isPending &&
                      mutation.variables?.key === item.key;

                    return (
                      <div
                        key={item.key}
                        className="flex flex-wrap items-start gap-4 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-foreground text-sm font-medium">
                              {item.label}
                            </span>
                            <code className="text-muted-foreground bg-secondary/60 rounded px-1.5 py-0.5 font-mono text-[11px]">
                              {item.key}
                            </code>
                            {!isDefault && (
                              <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 text-[10px]">
                                已改（默认 {String(item.default)}）
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {item.description}
                          </p>
                          {rowError[item.key] && (
                            <p className="text-destructive mt-1 text-xs">
                              {rowError[item.key]}
                            </p>
                          )}
                          {savedKey === item.key && !rowError[item.key] && (
                            <p className="mt-1 text-xs text-green-600">
                              已保存
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {item.type === "boolean" ? (
                            <select
                              value={shown}
                              disabled={!isSuperAdmin || saving}
                              onChange={(e) =>
                                handleChange(item.key, e.target.value)
                              }
                              className="border-border bg-input text-foreground focus:border-primary focus:ring-primary/40 w-28 rounded-lg border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              type={item.type === "string" ? "text" : "number"}
                              value={shown}
                              min={item.min}
                              max={item.max}
                              step={item.type === "int" ? 1 : "any"}
                              disabled={!isSuperAdmin || saving}
                              onChange={(e) =>
                                handleChange(item.key, e.target.value)
                              }
                              className="border-border bg-input text-foreground focus:border-primary focus:ring-primary/40 w-28 rounded-lg border px-2 py-1.5 text-sm tabular-nums focus:ring-2 focus:outline-none disabled:opacity-50"
                            />
                          )}

                          {dirty && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="撤销修改"
                              disabled={saving}
                              onClick={() => handleChange(item.key, current)}
                            >
                              <RotateCcw />
                            </Button>
                          )}

                          <Button
                            size="sm"
                            disabled={!isSuperAdmin || !dirty || saving}
                            onClick={() => handleSave(item)}
                          >
                            {saving && <Loader2 className="animate-spin" />}
                            保存
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
