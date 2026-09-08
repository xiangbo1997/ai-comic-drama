"use client";

/**
 * 用户详情页
 *
 * 头部展示身份与余额，操作栏按权限矩阵（lib/admin-users.ts#canActOn）决定哪些
 * 按钮可见/可用——与服务端同一份判定，前端只是提前告知，不构成防线。
 *
 * 所有写操作成功后同时失效详情与列表两个 query key：管理员改完积分常直接
 * 返回列表，若只失效详情，列表会显示已过期的余额。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@prisma/client";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { adminFetch } from "@/lib/admin-client";
import { canActOn } from "@/lib/admin-users";

import { AdminPageHeader } from "../../components/AdminPageHeader";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CreditsValue, RoleBadge, StatusBadge } from "../UserBadges";
import { formatDateTime, type AdminUserDetailResponse } from "../types";
import {
  CreditsDialog,
  NameDialog,
  PasswordDialog,
  RoleDialog,
} from "./UserActionDialogs";
import {
  AuditTable,
  OrdersTable,
  StatsCards,
  TransactionsTable,
} from "./UserDetailSections";

type TabKey = "transactions" | "orders" | "audit";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "transactions", label: "积分流水" },
  { key: "orders", label: "订单" },
  { key: "audit", label: "审计记录" },
];

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>("transactions");
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);

  const detailKey = ["admin-user", userId];

  const { data, isLoading, error } = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      adminFetch<AdminUserDetailResponse>(`/api/admin/users/${userId}`),
  });

  const user = data?.user;

  /** 写操作成功后的统一收尾：刷新详情与列表，提示成功 */
  const afterWrite = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    toast.success(message);
  };

  const patchMutation = useMutation({
    mutationFn: (body: {
      name?: string | null;
      role?: UserRole;
      status?: "ACTIVE" | "BANNED";
      banReason?: string;
    }) =>
      adminFetch<{ user: { id: string } }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  });

  const creditsMutation = useMutation({
    mutationFn: (body: {
      direction: "grant" | "deduct";
      amount: number;
      note: string;
    }) =>
      adminFetch<{ credits: number }>(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });

  const passwordMutation = useMutation({
    mutationFn: (newPassword: string) =>
      adminFetch<{ ok: true }>(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      }),
  });

  // 权限判定：session 里没有身份时（加载中）一律按「不可操作」渲染，
  // 避免闪现一排随后被禁用的按钮
  const actor =
    session?.user?.id && session.user.role
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null;
  const target = user ? { id: user.id, role: user.role } : null;

  const permit = (
    action: "update" | "role" | "ban" | "credits" | "password"
  ) =>
    actor && target
      ? canActOn(actor, target, action)
      : { allowed: false as const, reason: "加载中" };

  const canCredits = permit("credits").allowed;
  const canRole = permit("role").allowed;
  const canBan = permit("ban").allowed;
  const canPassword = permit("password").allowed;
  const canUpdate = permit("update").allowed;

  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const isBanned = user?.status === "BANNED";

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/admin/users"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition"
        >
          <ArrowLeft className="size-4" />
          返回用户列表
        </Link>
      </div>

      <AdminPageHeader
        title={user?.name || user?.email || "用户详情"}
        description={
          user
            ? `${user.email} · 注册于 ${formatDateTime(user.createdAt)} · 最近登录 ${formatDateTime(user.lastLoginAt)}`
            : "加载中..."
        }
        actions={
          user && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!canCredits}
                title={canCredits ? undefined : permit("credits").reason}
                onClick={() => setCreditsOpen(true)}
              >
                充值 / 扣减
              </Button>
              {canUpdate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNameOpen(true)}
                >
                  修改昵称
                </Button>
              )}
              {isSuperAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canRole}
                  title={canRole ? undefined : permit("role").reason}
                  onClick={() => setRoleOpen(true)}
                >
                  设置角色
                </Button>
              )}
              {isSuperAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPassword}
                  title={canPassword ? undefined : permit("password").reason}
                  onClick={() => setPasswordOpen(true)}
                >
                  重置密码
                </Button>
              )}
              {isSuperAdmin && (
                <Button
                  size="sm"
                  variant={isBanned ? "outline" : "destructive"}
                  disabled={!canBan}
                  title={canBan ? undefined : permit("ban").reason}
                  onClick={() => setBanOpen(true)}
                >
                  {isBanned ? "解封" : "封禁"}
                </Button>
              )}
            </div>
          )
        }
      />

      {error && (
        <p className="text-destructive mb-4 text-sm">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {user && (
        <div className="border-border mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">角色</span>
            <RoleBadge role={user.role} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">状态</span>
            <StatusBadge status={user.status} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">积分</span>
            <CreditsValue value={user.credits} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">邀请码</span>
            <code className="bg-secondary/60 rounded px-1.5 py-0.5 font-mono text-xs">
              {user.inviteCode}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">用户 ID</span>
            <code className="text-muted-foreground font-mono text-xs">
              {user.id}
            </code>
          </div>
          {isBanned && (
            <div className="text-destructive w-full text-xs">
              封禁于 {formatDateTime(user.bannedAt)}
              {user.banReason ? `，原因：${user.banReason}` : ""}
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <StatsCards stats={data?.stats} isLoading={isLoading} />
      </div>

      <div className="border-border mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "border-primary text-foreground -mb-px border-b-2 px-4 py-2 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-4 py-2 text-sm transition"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "transactions" && (
        <TransactionsTable
          rows={data?.recentTransactions ?? []}
          isLoading={isLoading}
        />
      )}
      {tab === "orders" && (
        <OrdersTable rows={data?.recentOrders ?? []} isLoading={isLoading} />
      )}
      {tab === "audit" && (
        <AuditTable rows={data?.recentAuditLogs ?? []} isLoading={isLoading} />
      )}

      {user && (
        <>
          <CreditsDialog
            open={creditsOpen}
            onOpenChange={setCreditsOpen}
            currentCredits={user.credits}
            onSubmit={async (body) => {
              const result = await creditsMutation.mutateAsync(body);
              afterWrite(
                `已${body.direction === "grant" ? "充值" : "扣减"} ${body.amount} 积分，当前余额 ${result.credits}`
              );
            }}
          />

          <NameDialog
            open={nameOpen}
            onOpenChange={setNameOpen}
            currentName={user.name}
            onSubmit={async (name) => {
              await patchMutation.mutateAsync({ name: name || null });
              afterWrite("昵称已更新");
            }}
          />

          <RoleDialog
            open={roleOpen}
            onOpenChange={setRoleOpen}
            currentRole={user.role}
            onSubmit={async (role) => {
              await patchMutation.mutateAsync({ role });
              afterWrite("角色已更新");
            }}
          />

          <PasswordDialog
            open={passwordOpen}
            onOpenChange={setPasswordOpen}
            onSubmit={async (newPassword) => {
              await passwordMutation.mutateAsync(newPassword);
              afterWrite("密码已重置，请通过可靠渠道告知用户");
            }}
          />

          <ConfirmDialog
            open={banOpen}
            onOpenChange={setBanOpen}
            title={isBanned ? "解封该账号？" : "封禁该账号？"}
            description={
              isBanned
                ? `解封后 ${user.email} 可以重新登录并使用全部功能。`
                : `封禁后 ${user.email} 将无法登录，已签发的登录态在角色复查窗口（5 分钟）内失效。此操作会记入审计日志。`
            }
            confirmText={isBanned ? "确认解封" : "确认封禁"}
            confirmVariant={isBanned ? "default" : "destructive"}
            withReason={!isBanned}
            reasonRequired={!isBanned}
            reasonLabel="封禁原因"
            onConfirm={async (reason) => {
              await patchMutation.mutateAsync({
                status: isBanned ? "ACTIVE" : "BANNED",
                ...(isBanned ? {} : { banReason: reason }),
              });
              afterWrite(isBanned ? "账号已解封" : "账号已封禁");
            }}
          />
        </>
      )}
    </div>
  );
}
