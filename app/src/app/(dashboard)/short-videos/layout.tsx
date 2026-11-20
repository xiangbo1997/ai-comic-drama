import { Clapperboard } from "lucide-react";
import { ShortVideoNavigation } from "@/components/short-video/navigation";
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
        <div className="border-border bg-card space-y-3 rounded-2xl border p-6">
          <Clapperboard
            className="text-muted-foreground size-8"
            aria-hidden="true"
          />
          <h1 className="text-xl font-semibold">抽象短视频暂未开放</h1>
          <p className="text-muted-foreground text-sm">
            请联系管理员为当前账号启用功能。
          </p>
        </div>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 md:p-6 lg:p-8">
      <header className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary hidden rounded-xl p-3 sm:block">
          <Clapperboard className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">AI 抽象短视频</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            从一个有趣的梗出发，完成原创改编、视频制作和审核发布。
          </p>
        </div>
      </header>
      <ShortVideoNavigation />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
