import { createRoot } from "react-dom/client";
import { ToastProvider } from "@/components/ui/toast";
import { ConfigDialog } from "@/app/(dashboard)/settings/ai-models/components/ConfigDialog";
import type {
  AIProvider,
  UserConfig,
} from "@/app/(dashboard)/settings/ai-models/components/types";
import "@/app/globals.css";
const openai =
  new URLSearchParams(location.search).get("provider") === "openai";
const provider: AIProvider = {
  id: "tts-provider",
  name: openai ? "OpenAI TTS" : "grok",
  slug: openai ? "openai-tts" : "custom-grok",
  category: "TTS",
  description: null,
  baseUrl: openai
    ? "https://chatgpt2api.example/v1"
    : "https://grok2api.example/v1",
  apiProtocol: "openai",
  models: [
    {
      id: openai ? "chatgpt-tts" : "grok-voice-latest",
      name: openai ? "chatgpt-tts" : "grok-voice-latest",
    },
  ],
  configSchema: null,
};
if (new URLSearchParams(location.search).get("provider") === "search") {
  Object.assign(provider, {
    id: "search-provider",
    name: "共用搜索模型",
    slug: "custom-search",
    category: "LLM",
    baseUrl: "https://search.example/v1",
    apiProtocol: "openai",
    models: [{ id: "search-model", name: "搜索模型" }],
  });
}
const config: UserConfig = {
  id: "tts-config",
  providerId: provider.id,
  provider,
  selectedModel: provider.models[0].id,
  customBaseUrl: provider.baseUrl,
  apiProtocol: "openai",
  customModels: null,
  authType: "API_KEY",
  tokenExpiresAt: null,
  isEnabled: true,
  isDefault: true,
  testStatus: "FAILED",
  lastTestedAt: null,
  hasApiKey: true,
  apiKeyMasked: "test****only",
};
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <ConfigDialog
      provider={provider}
      existingConfig={config}
      onClose={() => {}}
      onSuccess={() => {}}
    />
  </ToastProvider>
);
