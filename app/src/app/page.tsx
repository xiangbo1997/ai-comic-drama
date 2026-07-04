import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function Home() {
  // 未登录点「开始创作」此前要经 /projects → proxy 302 → 登录页绕一圈；
  // 服务端判一次 session 直达正确入口（新访客直达注册 Tab）
  const session = await auth();
  const isLoggedIn = Boolean(session?.user?.id);
  const startHref = isLoggedIn ? "/projects" : "/login?mode=register";

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Hero */}
      <div className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mb-6 text-5xl font-bold">AI 漫剧工作台</h1>
          <p className="text-muted-foreground mb-8 text-xl">
            一键将小说转化为漫剧视频。输入故事，AI
            自动生成分镜、图像、视频和配音。
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href={startHref}
              className="bg-primary hover:bg-primary/90 rounded-lg px-8 py-3 font-medium transition"
            >
              开始创作
            </Link>
            {isLoggedIn ? (
              <Link
                href="/projects"
                className="bg-secondary hover:bg-secondary/80 rounded-lg px-8 py-3 font-medium transition"
              >
                我的项目
              </Link>
            ) : (
              <Link
                href="/login"
                className="bg-secondary hover:bg-secondary/80 rounded-lg px-8 py-3 font-medium transition"
              >
                登录
              </Link>
            )}
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 grid gap-8 md:grid-cols-3">
          <div className="bg-card/50 rounded-xl p-6">
            <div className="mb-4 text-3xl">📝</div>
            <h3 className="mb-2 text-xl font-semibold">智能剧本拆解</h3>
            <p className="text-muted-foreground">
              输入小说文本，AI 自动拆解为分镜脚本，提取角色和场景
            </p>
          </div>
          <div className="bg-card/50 rounded-xl p-6">
            <div className="mb-4 text-3xl">🎨</div>
            <h3 className="mb-2 text-xl font-semibold">角色一致性</h3>
            <p className="text-muted-foreground">
              创建角色卡，确保同一角色在所有分镜中保持一致外貌
            </p>
          </div>
          <div className="bg-card/50 rounded-xl p-6">
            <div className="mb-4 text-3xl">🎬</div>
            <h3 className="mb-2 text-xl font-semibold">一键生成视频</h3>
            <p className="text-muted-foreground">
              自动生成图像、视频、配音，合成完整漫剧视频
            </p>
          </div>
        </div>

        {/* Workflow */}
        <div className="mt-20">
          <h2 className="mb-10 text-center text-2xl font-bold">工作流程</h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {[
              { step: "1", label: "输入文本" },
              { step: "2", label: "拆解分镜" },
              { step: "3", label: "设定角色" },
              { step: "4", label: "生成图像" },
              { step: "5", label: "生成视频" },
              { step: "6", label: "配音合成" },
              { step: "7", label: "导出成片" },
            ].map((item, i) => (
              <div key={item.step} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="bg-primary flex h-10 w-10 items-center justify-center rounded-full font-bold">
                    {item.step}
                  </div>
                  <span className="text-muted-foreground mt-2 text-sm">
                    {item.label}
                  </span>
                </div>
                {i < 6 && <div className="bg-secondary mx-2 h-0.5 w-8" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-border mt-20 border-t py-8">
        <div className="text-muted-foreground container mx-auto px-4 text-center">
          <p>AI Comic Drama © 2026</p>
        </div>
      </footer>
    </div>
  );
}
