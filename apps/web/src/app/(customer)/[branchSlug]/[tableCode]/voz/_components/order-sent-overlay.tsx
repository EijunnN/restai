"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Ventana para deshacer un pedido cerrado por voz.
 *
 * El pedido se confirma hablando, y hablando pasan cosas: el comensal dice "sí"
 * mientras responde a alguien de su mesa, el agente entiende un asentimiento
 * donde había una duda. Esta pantalla es la última oportunidad de arreglarlo
 * antes de que alguien empiece a cocinar de verdad.
 *
 * No inventa estado nuevo: usa `POST /api/customer/orders/:id/cancel`, que ya
 * existía para la carta táctil y que el propio servidor rechaza con 409 en
 * cuanto la cocina toca la comanda. Es decir, el botón puede fallar — y cuando
 * falla es porque el plato ya se está haciendo, que es exactamente la respuesta
 * correcta.
 */

const UNDO_SECONDS = 20;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface OrderSentOverlayProps {
  order: { id: string; orderNumber: string } | null;
  token: string | null;
  onDismiss: () => void;
  onCancelled: () => void;
}

export function OrderSentOverlay({
  order,
  token,
  onDismiss,
  onCancelled,
}: OrderSentOverlayProps) {
  const [remaining, setRemaining] = useState(UNDO_SECONDS);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!order) return;
    setRemaining(UNDO_SECONDS);
    setCancelling(false);

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Se cierra sola: la tablet tiene que volver a estar lista para el
          // siguiente pedido sin que nadie toque nada.
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [order, onDismiss]);

  async function handleCancel() {
    if (!order || !token) return;
    setCancelling(true);
    try {
      const res = await fetch(`${API_URL}/api/customer/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        // El 409 es el caso importante y merece un mensaje honesto: no es un
        // fallo técnico, es que ya no llega a tiempo.
        toast.error(
          res.status === 409
            ? "La cocina ya empezó tu pedido. Llama a un mozo si necesitas cambiarlo."
            : payload?.error?.message || "No se pudo anular el pedido",
        );
        setCancelling(false);
        return;
      }
      toast.success("Pedido anulado");
      onCancelled();
    } catch {
      toast.error("No se pudo anular el pedido");
      setCancelling(false);
    }
  }

  return (
    <AnimatePresence>
      {order && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 grid place-items-center bg-[rgba(20,16,14,0.93)] backdrop-blur-xl"
        >
          <motion.div
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="w-full max-w-lg px-10 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 16, delay: 0.1 }}
              className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[var(--aji)]/12 ring-1 ring-[var(--aji)]/35"
            >
              <Check className="h-10 w-10 text-[var(--aji)]" strokeWidth={2.5} />
            </motion.div>

            <h2 className="font-display mt-7 text-[clamp(2.25rem,5vw,3.5rem)] font-light leading-tight text-[var(--hueso)]">Pedido enviado</h2>
            <p className="mt-3 text-sm uppercase tracking-[0.3em] text-[var(--hueso)]/40">Comanda {order.orderNumber}</p>

            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="relative mt-10 w-full overflow-hidden rounded-full border border-[var(--hueso)]/25 py-5 text-lg text-[var(--hueso)] transition-colors hover:bg-[var(--hueso)]/8 disabled:opacity-50"
            >
              {/* La barra que se vacía ES el contador: se entiende sin leer. */}
              <motion.span
                className="absolute inset-y-0 left-0 bg-[var(--hueso)]/10"
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: UNDO_SECONDS, ease: "linear" }}
              />
              <span className="relative flex items-center justify-center gap-2">
                {cancelling ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <X className="h-5 w-5" />
                )}
                {cancelling ? "Anulando…" : `Me equivoqué, anular (${remaining})`}
              </span>
            </button>

            <button
              type="button"
              onClick={onDismiss}
              className="mt-5 text-sm text-[var(--hueso)]/40 transition-colors hover:text-[var(--hueso)]/75"
            >
              Todo bien, gracias
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
