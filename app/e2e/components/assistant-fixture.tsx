import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectAssistantButton } from "@/components/project-assistant/ProjectAssistantButton";
import "@/app/globals.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Fixture() {
  const [projectId, setProjectId] = useState("project-a");
  return (
    <main className="p-6">
      <button onClick={() => setProjectId("project-b")}>切换到乙剧</button>
      <ProjectAssistantButton
        projectId={projectId}
        title={projectId === "project-a" ? "甲剧" : "乙剧"}
      />
      <ProjectAssistantButton
        seriesId="series-a"
        title="系列甲"
        label="系列助手"
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Fixture />
  </QueryClientProvider>
);
