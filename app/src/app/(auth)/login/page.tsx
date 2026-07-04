"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Gift, Loader2, Mail, Lock, User } from "lucide-react";

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 支持 /login?mode=register 直达注册 Tab（营销落地/邀请链接用）
  const [mode, setMode] = useState<"login" | "register">(() =>
    searchParams.get("mode") === "register" ? "register" : "login"
  );

  // 表单数据
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [inviteInfo, setInviteInfo] = useState<{
    valid: boolean;
    inviter?: { name: string };
    reward?: number;
  } | null>(null);

  const inviteCode = searchParams.get("invite");

  // 中间件把未登录用户踢来登录页时带上了 callbackUrl，此前登录成功
  // 一律硬跳 /projects，深链（分享的编辑器链接等）与会话续期全部丢现场。
  // 仅接受站内相对路径（排除 "//evil.com" 协议相对形式），防开放重定向。
  const callbackUrl = searchParams.get("callbackUrl");
  const redirectTarget =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/projects";

  // 验证邀请码
  useEffect(() => {
    if (inviteCode) {
      document.cookie = `invite_code=${inviteCode}; path=/; max-age=86400`;

      fetch("/api/user/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setInviteInfo(data);
          }
        })
        .catch(() => {
          // 邀请码校验失败仅不展示奖励横幅，不阻塞注册流程
        });
    }
  }, [inviteCode]);

  // 验证邮箱格式
  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 前端验证
    if (!email.trim()) {
      setError("请输入邮箱地址");
      return;
    }

    if (!validateEmail(email)) {
      setError("邮箱格式不正确");
      return;
    }

    if (!password) {
      setError("请输入密码");
      return;
    }

    if (password.length < 6) {
      setError("密码至少需要6个字符");
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "register") {
        // 注册
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "注册失败");
          setIsLoading(false);
          return;
        }

        // 注册成功后自动登录
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (result?.error) {
          setError("登录失败，请重试");
          setIsLoading(false);
          return;
        }

        router.push(redirectTarget);
      } else {
        // 登录
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (result?.error) {
          setError("邮箱或密码错误");
          setIsLoading(false);
          return;
        }

        router.push(redirectTarget);
      }
    } catch {
      setError("操作失败，请稍后重试");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="mb-8 text-center">
        <Link href="/" className="text-foreground text-3xl font-bold">
          AI 漫剧<span className="text-primary">工作台</span>
        </Link>
        <p className="text-muted-foreground mt-2">一键将小说转化为漫剧视频</p>
      </div>

      {/* Invite Banner */}
      {inviteInfo?.valid && (
        <div className="border-primary/30 bg-primary/10 mb-6 flex items-center gap-3 rounded-xl border p-4">
          <Gift size={24} className="text-primary shrink-0" />
          <div>
            <p className="text-foreground font-medium">
              {inviteInfo.inviter?.name} 邀请你加入
            </p>
            <p className="text-muted-foreground text-sm">
              注册即可获得额外 {inviteInfo.reward} 积分奖励！
            </p>
          </div>
        </div>
      )}

      {/* Login/Register Card */}
      <div className="border-border bg-card rounded-2xl border p-8 shadow-xl">
        {/* Tab Switcher（分段控件） */}
        <div className="bg-secondary mb-6 flex rounded-lg p-1">
          <button
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              mode === "login"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            登录
          </button>
          <button
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              mode === "register"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            注册
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                昵称（可选）
              </label>
              <div className="relative">
                <User
                  size={18}
                  className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入昵称"
                  className="border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border py-3 pr-4 pl-10 transition focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              邮箱
            </label>
            <div className="relative">
              <Mail
                size={18}
                className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@studio.com"
                required
                className="border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border py-3 pr-4 pl-10 transition focus:ring-2 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground text-sm">密码</label>
              {mode === "login" && (
                // 暂无自助找回功能：给出真实出路而非 href="#" 死链
                <span className="text-muted-foreground text-xs">
                  忘记密码？请联系客服 support@aicomic.com
                </span>
              )}
            </div>
            <div className="relative">
              <Lock
                size={18}
                className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "register" ? "设置密码（至少6位）" : "请输入密码"
                }
                required
                minLength={6}
                className="border-border bg-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary/40 w-full rounded-lg border py-3 pr-4 pl-10 transition focus:ring-2 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg py-2 text-center text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {mode === "register" ? "注册中..." : "登录中..."}
              </>
            ) : mode === "register" ? (
              "注册"
            ) : (
              "登录"
            )}
          </button>
        </form>

        {/* Benefits */}
        {mode === "register" && (
          <div className="mt-6 space-y-2">
            <p className="text-muted-foreground text-center text-sm">
              注册即可获得：
            </p>
            {[
              `100 积分免费体验${
                inviteInfo?.valid ? ` + ${inviteInfo.reward} 邀请奖励` : ""
              }`,
              "项目云端保存",
              "角色卡永久保存",
            ].map((b) => (
              <div
                key={b}
                className="text-foreground/80 flex items-center gap-2 text-sm"
              >
                <span className="text-primary">✓</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-muted-foreground mt-6 text-center text-sm">
        {mode === "login" ? "登录" : "注册"}即表示同意{" "}
        <Link href="/terms" className="text-primary hover:underline">
          服务条款
        </Link>{" "}
        和{" "}
        <Link href="/privacy" className="text-primary hover:underline">
          隐私政策
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="flex items-center justify-center">
            <Loader2 size={32} className="text-muted-foreground animate-spin" />
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </div>
  );
}
