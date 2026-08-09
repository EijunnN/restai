"use client";

import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@restai/types";
import { glassSurface, SPRING, EASE_OUT } from "./glass";

/**
 * El pedido, siempre a la vista.
 *
 * El comensal está confiando su pedido a una conversación, y una conversación no
 * deja rastro: sin verlo, tiene que fiarse de su memoria y de la del agente a la
 * vez. Esto convierte "creo que pedí dos" en "veo que pedí dos".
 *
 * Cada línea lleva su foto. Reconocer un plato por su imagen es inmediato;
 * leerlo, no. Y los modificadores van SIEMPRE visibles bajo el nombre: son
 * justo lo que el comensal duda de haber dicho bien ("¿le dije sin cebolla?").
 */

interface OrderRailProps {
  items: CartItem[];
  total: number;
  /** Foto por id de plato, para la miniatura de cada línea. */
  imageById: Map<string, string | null | undefined>;
  /** Aviso de que la llamada se corta sola por silencio. */
  idleHint?: string;
}

export function OrderRail({ items, total, imageById, idleHint }: OrderRailProps) {
  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.aside
          initial={{ opacity: 0, x: 32, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 32, scale: 0.98 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="absolute right-[4vw] top-8 z-20 w-[19rem] overflow-hidden rounded-[28px]"
          style={glassSurface}
        >
          <header className="flex items-baseline justify-between px-5 pb-3 pt-5">
            <h3 className="text-[0.62rem] uppercase tracking-[0.32em] text-[var(--hueso)]/55">
              Tu pedido
            </h3>
            <span className="text-[0.62rem] tabular-nums text-[var(--hueso)]/35">
              {items.reduce((sum, i) => sum + i.quantity, 0)}
            </span>
          </header>

          <ul className="max-h-[46vh] space-y-1 overflow-y-auto px-3 pb-2">
            <AnimatePresence initial={false}>
              {items.map((line) => (
                <motion.li
                  key={line.lineId}
                  layout
                  initial={{ opacity: 0, x: 20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={SPRING}
                  className="flex items-center gap-3 rounded-2xl px-2 py-2"
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[var(--ceniza)]">
                    {imageById.get(line.menuItemId) ? (
                      <Image
                        src={imageById.get(line.menuItemId) as string}
                        alt=""
                        fill
                        unoptimized
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center">
                        <UtensilsCrossed className="h-4 w-4 text-[var(--hueso)]/25" />
                      </div>
                    )}
                    {line.quantity > 1 && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--aji)] px-1 text-[0.6rem] font-semibold tabular-nums text-[#14100E]">
                        {line.quantity}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] leading-tight text-[var(--hueso)]">
                      {line.name}
                    </p>
                    {line.modifiers.length > 0 && (
                      <p className="truncate text-[0.7rem] leading-tight text-[var(--aji)]/80">
                        {line.modifiers.map((m) => m.name).join(" · ")}
                      </p>
                    )}
                    {line.notes && (
                      <p className="truncate text-[0.7rem] italic leading-tight text-[var(--hueso)]/40">
                        {line.notes}
                      </p>
                    )}
                  </div>

                  <span className="shrink-0 text-[0.78rem] tabular-nums text-[var(--hueso)]/55">
                    {formatCurrency(
                      (line.unitPrice + line.modifiers.reduce((s, m) => s + m.price, 0)) *
                        line.quantity,
                    )}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <footer
            className="flex items-baseline justify-between px-5 py-4"
            style={{ boxShadow: "inset 0 1px 0 rgba(247,241,232,0.1)" }}
          >
            {/* "Estimado" porque esta cuenta la hace el cliente y el servidor
                la revalida al confirmar: prometer un total exacto aquí es
                prometer lo que esta pantalla no decide. */}
            <span className="text-[0.62rem] uppercase tracking-[0.3em] text-[var(--hueso)]/45">
              Total estimado
            </span>
            {/* La cifra se sustituye en el sitio, sin empujar nada: un total que
                salta al sumarse un plato se lee como un error de cálculo. */}
            <span className="relative block h-7 min-w-[5rem] text-right">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={total}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={SPRING}
                  className="absolute inset-0 text-lg font-medium tabular-nums text-[var(--hueso)]"
                >
                  {formatCurrency(total)}
                </motion.span>
              </AnimatePresence>
            </span>
          </footer>

          {/* El corte por silencio existía y nadie lo decía: la conversación se
              evaporaba y la pantalla volvía a la portada sin explicación. */}
          {idleHint && (
            <p className="px-5 pb-4 text-[0.68rem] leading-snug text-[var(--hueso)]/35">
              {idleHint}
            </p>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
