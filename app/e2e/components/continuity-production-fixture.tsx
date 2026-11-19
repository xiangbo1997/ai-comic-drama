import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContinuityCheckDialog } from "@/app/(dashboard)/editor/[id]/components/ContinuityCheckDialog";
import { ToastProvider } from "@/components/ui/toast";
import type { Scene } from "@/types";
import "@/app/globals.css";
const scenes: Scene[] = [0, 1].map((order) => ({
  id: `s${order}`,
  order,
  description: "门厅交接钥匙",
  duration: 3,
  shotType: "近景",
  dialogue: null,
  narration: null,
  emotion: "neutral",
  imageUrl: `https://example.test/${order}.png`,
  videoUrl: null,
  audioUrl: null,
  imageStatus: "COMPLETED",
  videoStatus: "PENDING",
  audioStatus: "PENDING",
}));
function Fixture() {
  const [result, setResult] = useState("");
  return (
    <ToastProvider>
      <main>
        <output aria-label="修复调用">{result}</output>
        <ContinuityCheckDialog
          open
          onClose={() => {}}
          projectId="p1"
          scenes={scenes}
          onIterateScene={async (id, _scene, note, anchor) => {
            setResult(JSON.stringify({ id, note, anchor }));
          }}
        />
      </main>
    </ToastProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
