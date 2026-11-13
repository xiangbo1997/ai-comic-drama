import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProducerWizardDialog } from "@/app/(dashboard)/projects/components/ProducerWizardDialog";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
export function ProducerFixture() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <main>
        <button onClick={() => setOpen(true)}>打开制片人向导</button>
        {open && <ProducerWizardDialog onClose={() => setOpen(false)} />}
      </main>
    </QueryClientProvider>
  );
}
