import { createRoot } from "react-dom/client";
import { ToastProvider } from "@/components/ui/toast";
import { ConfigDialog } from "@/app/(dashboard)/settings/ai-models/components/ConfigDialog";
import type {
  AIProvider,
  UserConfig,
} from "@/app/(dashboard)/settings/ai-models/components/types";
import "@/app/globals.css";
const query = new URLSearchParams(location.search);
const provider: AIProvider = {
  id: "kling-provider",
  name: "可灵 Kling",
  slug: query.has("custom") ? "custom-kling" : "kling",
  category: "VIDEO",
  description: null,
  baseUrl: "https://api-beijing.klingai.com",
  apiProtocol: query.has("custom") ? "kling" : null,
  models: [{ id: "kling-v2-6", name: "可灵 2.6" }],
  // 模拟未同步的旧预设：主密钥旧名称、Secret Key 必填。
  configSchema: {
    fields: [
      {
        key: "accessKey",
        label: "Access Key",
        type: "password",
        required: true,
      },
      {
        key: "secretKey",
        label: "Secret Key",
        type: "password",
        required: true,
      },
    ],
  },
};
const config: UserConfig = {
  id: "kling-config",
  providerId: provider.id,
  provider,
  selectedModel: "kling-v2-6",
  customBaseUrl: null,
  apiProtocol: null,
  customModels: null,
  authType: "API_KEY",
  tokenExpiresAt: null,
  isEnabled: true,
  isDefault: true,
  testStatus: null,
  lastTestedAt: null,
  hasApiKey: true,
  apiKeyMasked: "save****-key",
};
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <ConfigDialog
      provider={provider}
      existingConfig={query.has("edit") ? config : null}
      onClose={() => {}}
      onSuccess={() => {}}
    />
  </ToastProvider>
);
