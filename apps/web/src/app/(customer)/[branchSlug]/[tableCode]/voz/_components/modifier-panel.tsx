"use client";

import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ModifierGroup } from "@/lib/voice-tools";
import { glassSurface, glassChip, SPRING, EASE_OUT } from "./glass";

/**
 * Las opciones del plato, mientras el mesero pregunta por ellas.
 *
 * Es la pieza que faltaba en la sincronía voz-pantalla. El agente decía "¿lo
 * quieres con ají extra?" y el comensal tenía que sostener de memoria una lista
 * hablada; ahora la ve. Cuando responde, la opción elegida se marca antes de que
 * el panel se retire: esa confirmación visual es lo que evita el "creo que dije
 * sin cebolla".
 *
 * Las obligatorias se señalan como tales. No es un detalle menor: son las que,
 * si faltan, hacen que el pedido se rechace al final, cuando el comensal ya cree
 * que ha terminado.
 */

interface ModifierPanelProps {
  groups: ModifierGroup[];
  /** Nombres ya elegidos, para marcarlos. */
  chosen: string[];
  visible: boolean;
  /**
   * Lo que el mesero está preguntando ahora mismo.
   *
   * Va aquí y no en los subtítulos porque, con el panel abierto, aquellos se
   * ocultaban: el comensal veía una lista de opciones sin saber qué le habían
   * preguntado. La pregunta y las opciones son la misma cosa.
   */
  question?: string;
  /**
   * Elegir tocando. La voz sigue siendo el camino principal, pero en un
   * comedor ruidoso —o con un nombre que el modelo no coge a la primera— hay
   * que poder resolverlo con el dedo en vez de repetirlo tres veces.
   */
  onChoose?: (groupId: string, modifierName: string) => void;
}

export function ModifierPanel({
  groups,
  chosen,
  visible,
  question,
  onChoose,
}: ModifierPanelProps) {
  const chosenSet = new Set(chosen.map((c) => c.toLowerCase()));

  return (
    <AnimatePresence>
      {visible && groups.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.3 } }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="absolute bottom-[9%] left-[6vw] z-20 w-[min(30rem,46vw)] overflow-hidden rounded-[28px] p-6"
          style={glassSurface}
        >
          {/* La pregunta del mesero encabeza sus propias opciones. */}
          {question && (
            <p className="mb-5 font-display text-[1.35rem] font-light leading-snug text-[var(--hueso)]">
              {question}
            </p>
          )}

          {groups.map((group, groupIndex) => (
            <div key={group.id} className={groupIndex > 0 ? "mt-6" : undefined}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-[0.68rem] uppercase tracking-[0.28em] text-[var(--hueso)]/55">
                  {group.name}
                </h3>
                {group.is_required && (
                  <span className="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--aji)]">
                    Hay que elegir
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {group.modifiers
                  .filter((modifier) => modifier.is_available)
                  .map((modifier, index) => {
                    const isChosen = chosenSet.has(modifier.name.toLowerCase());
                    return (
                      <motion.button
                        key={modifier.id}
                        type="button"
                        onClick={() => onChoose?.(group.id, modifier.name)}
                        aria-pressed={isChosen}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileTap={onChoose ? { scale: 0.96 } : undefined}
                        transition={{ ...SPRING, delay: 0.05 + index * 0.04 }}
                        className="flex items-center gap-2 rounded-full px-4 py-2.5 text-left"
                        style={{
                          ...glassChip,
                          // La elegida se ilumina desde dentro en vez de cambiar
                          // de color: mantiene el material y solo sube la
                          // temperatura, que es como se marca algo sin romper la
                          // armonía de la pantalla.
                          ...(isChosen
                            ? {
                                background: "rgba(242,167,27,0.18)",
                                boxShadow:
                                  "inset 0 1px 0 rgba(247,241,232,0.25), 0 0 0 1px rgba(242,167,27,0.45)",
                              }
                            : null),
                        }}
                      >
                        <AnimatePresence>
                          {isChosen && (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={SPRING}
                            >
                              <Check className="h-3.5 w-3.5 text-[var(--aji)]" strokeWidth={3} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <span
                          className={
                            isChosen
                              ? "text-sm text-[var(--hueso)]"
                              : "text-sm text-[var(--hueso)]/80"
                          }
                        >
                          {modifier.name}
                        </span>
                        {modifier.price > 0 && (
                          <span className="text-xs tabular-nums text-[var(--hueso)]/45">
                            +{formatCurrency(modifier.price)}
                          </span>
                        )}
                        {/* Un círculo vacío dice "esto también se puede elegir".
                            Sin él, las no elegidas parecían texto muerto. */}
                        {!isChosen && (
                          <span className="ml-auto h-[15px] w-[15px] shrink-0 rounded-full border border-[var(--hueso)]/25" />
                        )}
                      </motion.button>
                    );
                  })}
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
