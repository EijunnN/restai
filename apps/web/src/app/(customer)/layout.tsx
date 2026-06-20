"use client";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWebSocket } from "@/hooks/use-websocket";
import { useCustomerStore } from "@/stores/customer-store";
import type { WsMessage } from "@restai/types";
import { User } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const ACTION_COOLDOWN_STORAGE_KEY = "customer_table_action_cooldown";

interface SessionEndedPayload {
  sessionId: string;
}

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branchName = useCustomerStore((s) => s.branchName);
  const branchSlug = useCustomerStore((s) => s.branchSlug);
  const tableCode = useCustomerStore((s) => s.tableCode);
  const token = useCustomerStore((s) => s.token);
  const sessionId = useCustomerStore((s) => s.sessionId);
  const clearSession = useCustomerStore((s) => s.clear);
  const router = useRouter();
  const hasHandledSessionEndRef = useRef(false);

  useEffect(() => {
    hasHandledSessionEndRef.current = false;
  }, [sessionId]);

  const handleSessionEnded = useCallback(() => {
    if (!branchSlug || !tableCode || hasHandledSessionEndRef.current) {
      return;
    }

    hasHandledSessionEndRef.current = true;
    const redirectUrl = `/${branchSlug}/${tableCode}`;

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(`${ACTION_COOLDOWN_STORAGE_KEY}:${branchSlug}:${tableCode}`);
    }

    clearSession();
    toast.info("La sesion de esta mesa termino.");
    router.replace(redirectUrl);
  }, [branchSlug, tableCode, clearSession, router]);

  useWebSocket(
    token && sessionId ? [`session:${sessionId}`] : [],
    (msg: WsMessage) => {
      if (msg.type !== "session:ended") {
        return;
      }

      const payload = msg.payload as SessionEndedPayload;

      if (payload.sessionId === sessionId) {
        handleSessionEnded();
      }
    },
    token || undefined,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm pt-4 pb-2 px-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="w-8" />
          <h1 className="text-lg font-semibold tracking-wide text-foreground truncate">
            {branchName || "RestAI"}
          </h1>
          {token && branchSlug && tableCode ? (
            <Link
              href={`/${branchSlug}/${tableCode}/profile`}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted-foreground/30 overflow-hidden border border-border transition-colors hover:bg-muted-foreground/40"
            >
              <User className="h-4 w-4 text-foreground" />
            </Link>
          ) : (
            <div className="w-8" />
          )}
        </div>
      </header>
      <main className="max-w-lg mx-auto">{children}</main>
    </div>
  );
}
