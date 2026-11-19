import { ShortVideoWorkbench } from "@/components/short-video/workbench";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ShortVideoWorkbench mode="detail" id={(await params).id} />;
}
