"use client";

import { useState } from "react";
import {
  resolveAiDisclosure,
  type AiDisclosure,
  type ResolvedAiDisclosure,
} from "@/lib/ai-disclosure";
import { AiDisclosurePanel } from "./export-dialog/AiDisclosurePanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AiDisclosureDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue?: AiDisclosure;
  onSave: (value: ResolvedAiDisclosure) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => resolveAiDisclosure(initialValue));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>AI 标识设置</DialogTitle>
          <DialogDescription>
            调整全片标识，保存后同步预览和导出。
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={pending} className="min-w-0">
          <AiDisclosurePanel
            disclosure={draft}
            credentials={{}}
            onDisclosureChange={setDraft}
            onCredentialsChange={() => {}}
            showCredentials={false}
          />
        </fieldset>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await onSave(draft);
                onClose();
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "保存失败，请重试"
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "保存中…" : "保存设置"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
