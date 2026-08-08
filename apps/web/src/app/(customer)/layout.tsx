"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWebSocket } from "@/hooks/use-websocket";
import { useHydrated } from "@/hooks/use-hydrated";
import { useCustomerStore } from "@/stores/customer-store";
import { useCartStore } from "@/stores/cart-store";
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
  const bindCartToTable = useCartStore((s) => s.bindToTable);
  const router = useRouter();
  // La cabecera lee datos de sessionStorage, que no existe en el servidor: sin
  // esperar a la hidratación, servidor y cliente pintan cosas distintas aquí.
  const hydrated = useHydrated();
  const hasHandledSessionEndRef = useRef(false);

  /*
    La carta y la ficha de un plato traen SU PROPIA barra superior, con la mesa,
    el buscador y las categorías dentro. Si además se pintara esta, el comensal
    tendría dos cabeceras fijas comiéndose la pantalla justo donde tiene que
    leer la carta. El resto de pantallas del comensal —carrito, estado, perfil—
    sí la usan.
  */
  const pathname = usePathname();
  const ownsItsHeader = /\/menu(\/|$)/.test(pathname ?? "");

  useEffect(() => {
    hasHandledSessionEndRef.current = false;
  }, [sessionId]);

  // El carrito persiste entre recargas, pero atado a ESTA mesa: si el
  // dispositivo se usa luego en otra mesa, no debe arrastrar los platos que
  // eligió el comensal anterior.
  useEffect(() => {
    if (branchSlug && tableCode) {
      bindCartToTable(`${branchSlug}:${tableCode}`);
    }
  }, [branchSlug, tableCode, bindCartToTable]);

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
    toast.info("La sesión de esta mesa terminó.");
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
      {!ownsItsHeader && (
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm pt-4 pb-2 px-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="w-8" />
          {/*
            La cabecera lleva la marca DEL RESTAURANTE, no la nuestra. Antes caía
            en "RestAI" cuando aún no había cargado el nombre de la sede, y el
            local acababa regalando su marca en la pantalla que ve su cliente.
            Mientras carga se muestra un hueco, nunca otra marca.
          */}
          <h1 className="text-lg font-semibold tracking-wide text-foreground truncate">
            {hydrated && branchName ? (
              branchName
            ) : (
              <span className="inline-block h-5 w-32 rounded bg-muted animate-pulse" />
            )}
          </h1>
          {hydrated && token && branchSlug && tableCode ? (
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
      )}
      <main className="max-w-lg mx-auto">{children}</main>
    </div>
  );
}
