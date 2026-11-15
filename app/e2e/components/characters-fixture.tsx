import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import CharactersPage from "@/app/(dashboard)/characters/page";
import "@/app/globals.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <ToastProvider>
      <CharactersPage />
    </ToastProvider>
  </QueryClientProvider>
);
