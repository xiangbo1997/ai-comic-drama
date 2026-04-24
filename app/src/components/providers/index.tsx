"use client";

import { ReactNode } from "react";
import { SessionProvider } from "./session-provider";
import { QueryProvider } from "./query-provider";

interface Props {
  children: ReactNode;
}

export function Providers({ children }: Props) {
  return (
    <SessionProvider>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
