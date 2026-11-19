import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessShortVideo } from "@/lib/short-video/config";
export default async function ShortVideoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, role: true, status: true },
      })
    : null;
  if (!user || !canAccessShortVideo(user))
    return (
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-bold">抽象短视频暂未开放</h1>
        <p>请联系管理员为当前账号启用功能。</p>
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-bold">AI 抽象短视频</h1>
        <p className="text-muted-foreground mt-2">
          原创改编 → 制作 → 审核 → 计划提交。当前平台接入状态请以账号能力为准。
        </p>
      </header>
      <nav aria-label="短视频导航" className="flex flex-wrap gap-4">
        {[
          ["/short-videos", "作品"],
          ["/short-videos/trends", "热点与导入"],
          ["/short-videos/publications", "发布中心"],
          ["/short-videos/accounts", "发布账号"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="text-primary underline">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
