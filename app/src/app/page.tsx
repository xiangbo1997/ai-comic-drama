import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      {/* Hero */}
      <div className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mb-6 text-5xl font-bold">AI 漫剧工作台</h1>
          <p className="mb-8 text-xl text-gray-300">
            一键将小说转化为漫剧视频。输入故事，AI
            自动生成分镜、图像、视频和配音。
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/projects"
              className="rounded-lg bg-blue-600 px-8 py-3 font-medium transition hover:bg-blue-700"
            >
              开始创作
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-gray-700 px-8 py-3 font-medium transition hover:bg-gray-600"
            >
              登录
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 grid gap-8 md:grid-cols-3">
          <div className="rounded-xl bg-gray-800/50 p-6">
            <div className="mb-4 text-3xl">📝</div>
            <h3 className="mb-2 text-xl font-semibold">智能剧本拆解</h3>
            <p className="text-gray-400">
              输入小说文本，AI 自动拆解为分镜脚本，提取角色和场景
            </p>
          </div>
          <div className="rounded-xl bg-gray-800/50 p-6">
            <div className="mb-4 text-3xl">🎨</div>
            <h3 className="mb-2 text-xl font-semibold">角色一致性</h3>
            <p className="text-gray-400">
              创建角色卡，确保同一角色在所有分镜中保持一致外貌
            </p>
          </div>
          <div className="rounded-xl bg-gray-800/50 p-6">
            <div className="mb-4 text-3xl">🎬</div>
            <h3 className="mb-2 text-xl font-semibold">一键生成视频</h3>
            <p className="text-gray-400">
              自动生成图像、视频、配音，合成完整漫剧作品
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
              { step: "7", label: "导出作品" },
            ].map((item, i) => (
              <div key={item.step} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold">
                    {item.step}
                  </div>
                  <span className="mt-2 text-sm text-gray-400">
                    {item.label}
                  </span>
                </div>
                {i < 6 && <div className="mx-2 h-0.5 w-8 bg-gray-600" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-20 border-t border-gray-700 py-8">
        <div className="container mx-auto px-4 text-center text-gray-500">
          <p>AI Comic Drama © 2026</p>
        </div>
      </footer>
    </div>
  );
}
