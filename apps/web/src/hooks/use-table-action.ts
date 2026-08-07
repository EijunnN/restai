"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Avisos de mesa ("Pedir la cuenta" / "Llamar al mozo") con UN SOLO
 * comportamiento en toda la app del comensal.
 *
 * Antes cada pantalla lo resolvía a su manera: en la carta el botón quedaba
 * DESHABILITADO PARA SIEMPRE tras el primer envío (si el mozo no venía, el
 * comensal no tenía forma de insistir) y en el estado del pedido había un
 * enfriamiento visible de 30 segundos. Dos productos distintos para el mismo
 * gesto, en dos pantallas contiguas.
 *
 * Reglas únicas:
 *  - 30 segundos de enfriamiento, con cuenta atrás visible, persistido en
 *    sessionStorage por mesa (sobrevive a recargas y a cambios de pantalla).
 *  - El servidor es idempotente: si ya hay un aviso pendiente responde 200 con
 *    `alreadyPending: true` y un mensaje redactado ("Ya avisamos al mozo, está
 *    en camino"). Eso NO es un error: se muestra tal cual, sin fingir que se
 *    envió otro aviso.
 *  - El mensaje siempre queda también en línea (no solo en un toast, que se va
 *    en 4 segundos y en móvil se pierde bajo el teclado o el pulgar).
 */

export type TableAction = "request_bill" | "call_waiter";

export interface TableActionNotice {
  /** "info" = el aviso ya existía; no es un fallo. */
  kind: "success" | "info" | "error";
  message: string;
}

export const TABLE_ACTION_COOLDOWN_MS = 30_000;
const COOLDOWN_STORAGE_KEY = "customer_table_action_cooldown";

type CooldownMap = Record<TableAction, number>;

const EMPTY_COOLDOWN: CooldownMap = { request_bill: 0, call_waiter: 0 };

function readStoredCooldown(storageKey: string): CooldownMap {
  if (typeof window === "undefined") return EMPTY_COOLDOWN;
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return EMPTY_COOLDOWN;
  try {
    const parsed = JSON.parse(raw) as Partial<CooldownMap>;
    return {
      request_bill: typeof parsed.request_bill === "number" ? parsed.request_bill : 0,
      call_waiter: typeof parsed.call_waiter === "number" ? parsed.call_waiter : 0,
    };
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return EMPTY_COOLDOWN;
  }
}

const DEFAULT_SUCCESS: Record<TableAction, string> = {
  request_bill: "Pedimos tu cuenta. El mozo ya está avisado.",
  call_waiter: "Avisamos al mozo. Viene en camino.",
};

export const TABLE_ACTION_LABELS: Record<TableAction, string> = {
  request_bill: "Pedir la cuenta",
  call_waiter: "Llamar al mozo",
};

interface UseTableActionOptions {
  /**
   * Mensaje a mostrar (como información, no como error) cuando el servidor
   * responde 403 SESSION_ENDED porque la visita todavía no está confirmada.
   * Lo usa la pantalla de espera: allí el aviso no se puede registrar aún, pero
   * el personal YA tiene la solicitud de mesa en su bandeja.
   */
  inactiveSessionMessage?: string;
}

export function useTableAction(
  branchSlug: string,
  tableCode: string,
  options: UseTableActionOptions = {},
) {
  const { inactiveSessionMessage } = options;
  const storageKey = `${COOLDOWN_STORAGE_KEY}:${branchSlug}:${tableCode}`;

  const [cooldownUntil, setCooldownUntil] = useState<CooldownMap>(EMPTY_COOLDOWN);
  const [now, setNow] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState<TableAction | null>(null);
  const [notice, setNotice] = useState<TableActionNotice | null>(null);

  // Rehidratar el enfriamiento guardado (una sola vez por mesa).
  useEffect(() => {
    setCooldownUntil(readStoredCooldown(storageKey));
    setNow(Date.now());
  }, [storageKey]);

  // Persistir para que cambiar de pantalla no regale otro envío inmediato.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (cooldownUntil.request_bill === 0 && cooldownUntil.call_waiter === 0) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(cooldownUntil));
  }, [cooldownUntil, storageKey]);

  // Reloj de 1 s solo mientras haya cuenta atrás viva.
  useEffect(() => {
    const active = Object.values(cooldownUntil).some((ts) => ts > Date.now());
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const remainingSeconds = useCallback(
    (action: TableAction) => Math.max(0, Math.ceil((cooldownUntil[action] - now) / 1000)),
    [cooldownUntil, now],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const send = useCallback(
    async (action: TableAction) => {
      const token =
        typeof window !== "undefined" ? window.sessionStorage.getItem("customer_token") : null;
      const sessionId =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("customer_session_id")
          : null;

      if (!token || !sessionId) {
        const message = "Tu sesión de mesa no está activa. Vuelve a escanear el código QR.";
        setNotice({ kind: "error", message });
        toast.error(message);
        return;
      }

      const waitMs = cooldownUntil[action] - Date.now();
      if (waitMs > 0) {
        setNotice({
          kind: "info",
          message: `Ya enviamos tu aviso. Puedes insistir en ${Math.ceil(waitMs / 1000)} s.`,
        });
        return;
      }

      setPendingAction(action);
      try {
        const res = await fetch(`${API_URL}/api/customer/table-action`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action, tableSessionId: sessionId }),
        });
        const result = await res.json();

        if (!res.ok || !result?.success) {
          const code = result?.error?.code;

          // La visita todavía no está aprobada: el aviso no se puede registrar,
          // pero la solicitud de mesa ya está en la pantalla del personal.
          if (code === "SESSION_ENDED" && inactiveSessionMessage) {
            const start = Date.now();
            setNow(start);
            setCooldownUntil((prev) => ({
              ...prev,
              [action]: start + TABLE_ACTION_COOLDOWN_MS,
            }));
            setNotice({ kind: "info", message: inactiveSessionMessage });
            return;
          }

          // El servidor puede pedir una espera concreta (límite de peticiones).
          const retryAfterSec = result?.data?.retryAfterSec;
          if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
            const start = Date.now();
            setNow(start);
            setCooldownUntil((prev) => ({
              ...prev,
              [action]: start + retryAfterSec * 1000,
            }));
          }

          const message =
            result?.error?.message || "No pudimos enviar tu aviso. Inténtalo de nuevo.";
          setNotice({ kind: "error", message });
          toast.error(message);
          return;
        }

        const start = Date.now();
        setNow(start);
        setCooldownUntil((prev) => ({
          ...prev,
          [action]: start + TABLE_ACTION_COOLDOWN_MS,
        }));

        const alreadyPending = result.data?.alreadyPending === true;
        const message: string = result.data?.message || DEFAULT_SUCCESS[action];
        setNotice({ kind: alreadyPending ? "info" : "success", message });
        if (alreadyPending) {
          toast.info(message);
        } else {
          toast.success(message);
        }
      } catch {
        const message = "No hay conexión. Revisa tu red e inténtalo de nuevo.";
        setNotice({ kind: "error", message });
        toast.error(message);
      } finally {
        setPendingAction(null);
      }
    },
    [cooldownUntil, inactiveSessionMessage],
  );

  return {
    send,
    /** Acción en vuelo, o null. */
    pendingAction,
    /** Segundos que faltan para poder volver a insistir (0 = disponible). */
    remainingSeconds,
    notice,
    dismissNotice,
  };
}
