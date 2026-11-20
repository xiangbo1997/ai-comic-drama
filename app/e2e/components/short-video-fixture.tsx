import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShortVideoWorkbench } from "@/components/short-video/workbench";
import { ShortVideoNavigation } from "@/components/short-video/navigation";
import "@/app/globals.css";
const params = new URLSearchParams(location.search);
const mode = (params.get("mode") || "detail") as
  | "detail"
  | "videos"
  | "trends"
  | "accounts"
  | "publications";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <main className="mx-auto max-w-6xl space-y-6 p-4">
      <ShortVideoNavigation />
      <ShortVideoWorkbench
        mode={mode}
        id={mode === "detail" ? "video-1" : undefined}
      />
    </main>
  </QueryClientProvider>
);
