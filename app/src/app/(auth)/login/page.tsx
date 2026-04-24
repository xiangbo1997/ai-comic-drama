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
  const [mode, setMode] = useState<"login" | "register">("login");

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
        .catch(console.error);
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

        router.push("/projects");
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

        router.push("/projects");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setError("操作失败，请稍后重试");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="mb-8 text-center">
        <Link href="/" className="text-3xl font-bold text-white">
          AI 漫剧
        </Link>
        <p className="mt-2 text-gray-400">一键将小说转化为漫剧视频</p>
      </div>

      {/* Invite Banner */}
      {inviteInfo?.valid && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 p-4">
          <Gift size={24} className="shrink-0 text-white" />
          <div>
            <p className="font-medium text-white">
              {inviteInfo.inviter?.name} 邀请你加入
            </p>
            <p className="text-sm text-purple-100">
              注册即可获得额外 {inviteInfo.reward} 积分奖励！
            </p>
          </div>
        </div>
      )}

      {/* Login/Register Card */}
      <div className="rounded-2xl bg-gray-800 p-8 shadow-xl">
        {/* Tab Switcher */}
        <div className="mb-6 flex rounded-lg bg-gray-700 p-1">
          <button
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              mode === "login"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
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
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            注册
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="mb-1 block text-sm text-gray-400">
                昵称（可选）
              </label>
              <div className="relative">
                <User
                  size={18}
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-500"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入昵称"
                  className="w-full rounded-lg bg-gray-700 py-3 pr-4 pl-10 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm text-gray-400">邮箱</label>
            <div className="relative">
              <Mail
                size={18}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-500"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="输入邮箱地址"
                required
                className="w-full rounded-lg bg-gray-700 py-3 pr-4 pl-10 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">密码</label>
            <div className="relative">
              <Lock
                size={18}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-500"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "register" ? "设置密码（至少6位）" : "输入密码"
                }
                required
                minLength={6}
                className="w-full rounded-lg bg-gray-700 py-3 pr-4 pl-10 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-400/10 py-2 text-center text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="text-center text-sm text-gray-400">注册即可获得：</p>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className="text-green-500">✓</span>
              <span>
                100 积分免费体验
                {inviteInfo?.valid && ` + ${inviteInfo.reward} 邀请奖励`}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className="text-green-500">✓</span>
              <span>作品云端保存</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span className="text-green-500">✓</span>
              <span>角色卡永久保存</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-sm text-gray-500">
        {mode === "login" ? "登录" : "注册"}即表示同意{" "}
        <a href="#" className="text-blue-400 hover:underline">
          服务条款
        </a>{" "}
        和{" "}
        <a href="#" className="text-blue-400 hover:underline">
          隐私政策
        </a>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800 px-4">
      <Suspense
        fallback={
          <div className="flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-gray-400" />
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </div>
  );
}
