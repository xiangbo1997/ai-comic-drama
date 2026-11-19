import { createRoot } from "react-dom/client";
import { ShortVideoWorkbench } from "@/components/short-video/workbench";
import "@/app/globals.css";
const params = new URLSearchParams(location.search);
const mode = (params.get("mode") || "detail") as
  | "detail"
  | "videos"
  | "trends"
  | "accounts"
  | "publications";
createRoot(document.getElementById("root")!).render(
  <main className="p-4">
    <ShortVideoWorkbench
      mode={mode}
      id={mode === "detail" ? "video-1" : undefined}
    />
  </main>
);
