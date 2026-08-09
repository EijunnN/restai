"use client";

import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { formatCurrency } from "@/lib/utils";
import type { VoiceMenuItem } from "@/lib/voice-tools";

/**
 * El escenario: la comida ocupa la pantalla entera.
 *
 * ── Por qué no hay un avatar del asistente ───────────────────────────────────
 * La versión anterior ponía en el centro un orbe con degradado: el cliché exacto
 * del "asistente de IA", que además no tiene nada que ver con comer. Aquí el
 * protagonista es el plato, a sangre y sin marco, como el plano de apertura de
 * un documental gastronómico. Lo que el mesero dice se sobreimprime encima; su
 * "presencia" es la voz y el movimiento de la imagen, no un muñeco.
 *
 * ── El movimiento ────────────────────────────────────────────────────────────
 * Dos gestos, y solo dos:
 *  - un travelling lentísimo sobre la foto (12 s) para que la imagen fija no se
 *    lea como una imagen fija;
 *  - un barrido lateral al cambiar de plato, en vez de un fundido. El fundido es
 *    invisible y no dice nada; el barrido tiene dirección, y la dirección se lee
 *    como "pasamos a otra cosa".
 */

interface DishStageProps {
  items: VoiceMenuItem[];
  focusedId: string | null;
  title?: string;
  onSelect?: (itemId: string) => void;
}

/** Curva de salida larga: el movimiento entra rápido y se posa. */
const CINEMATIC = [0.16, 1, 0.3, 1] as const;

export function DishStage({ items, focusedId, title, onSelect }: DishStageProps) {
  const reduceMotion = useReducedMotion();
  if (items.length === 0) return null;

  const focused = focusedId ? items.find((i) => i.id === focusedId) : null;
  // Sin plato enfocado, manda el primero: la pantalla nunca se queda en negro
  // esperando a que el mesero se decida.
  const hero = focused ?? items[0];
  const rest = items.filter((item) => item.id !== hero.id).slice(0, 3);

  return (
    <div className="absolute inset-0">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={hero.id}
          className="absolute inset-0"
          initial={reduceMotion ? { opacity: 0 } : { clipPath: "inset(0 0 0 100%)" }}
          animate={reduceMotion ? { opacity: 1 } : { clipPath: "inset(0 0 0 0%)" }}
          exit={reduceMotion ? { opacity: 0 } : { clipPath: "inset(0 100% 0 0)" }}
          transition={{ duration: 0.9, ease: CINEMATIC }}
        >
          <DishFrame item={hero} reduceMotion={reduceMotion} />
        </motion.div>
      </AnimatePresence>

      {/* Oscurecido inferior: sostiene la tipografía sobre cualquier foto, por
          clara que sea. Va aquí y no dentro del marco para que no lo arrastre
          el barrido. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(20,16,14,0.96) 0%, rgba(20,16,14,0.72) 26%, rgba(20,16,14,0.08) 55%, rgba(20,16,14,0.35) 100%)",
        }}
      />

      {/* Nombre del plato. Es el elemento con el que se recuerda la pantalla:
          todo lo demás está deliberadamente callado. */}
      <div className="absolute inset-x-0 top-[14%] px-[6vw]">
        <AnimatePresence mode="wait">
          <motion.div
            key={hero.id}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.7, ease: CINEMATIC, delay: reduceMotion ? 0 : 0.18 }}
          >
            {title && (
              <p className="mb-3 text-[0.7rem] uppercase tracking-[0.32em] text-[var(--aji)]">
                {title}
              </p>
            )}
            <h2
              className="font-display max-w-[14ch] text-[clamp(2.75rem,7.5vw,6.5rem)] font-light leading-[0.92] tracking-[-0.02em] text-[var(--hueso)]"
              style={{ fontVariationSettings: "'SOFT' 40, 'WONK' 1, 'opsz' 144" }}
            >
              {hero.name}
            </h2>
            <div className="mt-5 flex items-center gap-5">
              <span className="text-xl tabular-nums text-[var(--hueso)]/70">
                {formatCurrency(hero.price)}
              </span>
              {!hero.is_available && (
                <span className="rounded-full bg-[var(--rocoto)]/20 px-3 py-1 text-xs uppercase tracking-widest text-[var(--rocoto)] ring-1 ring-[var(--rocoto)]/40">
                  Hoy no queda
                </span>
              )}
              {hero.dietary_tags?.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="text-xs uppercase tracking-[0.2em] text-[var(--hueso)]/45"
                >
                  {tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Los demás platos de los que habla. Van ABAJO Y EN HORIZONTAL, no en el
          lateral derecho: ahí vive el pedido, y dos columnas apiladas en el
          mismo borde acaban solapándose en cuanto el carrito crece. */}
      <div className="absolute bottom-[9%] right-[4vw] hidden items-end gap-3 md:flex">
        <AnimatePresence mode="popLayout">
          {rest.map((item, index) => (
            <motion.button
              key={item.id}
              type="button"
              layout
              onClick={() => onSelect?.(item.id)}
              initial={{ opacity: 0, y: 28, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.94 }}
              transition={{
                duration: 0.6,
                ease: CINEMATIC,
                delay: reduceMotion ? 0 : 0.1 + index * 0.08,
              }}
              whileTap={{ scale: 0.96 }}
              className="group relative h-24 w-24 overflow-hidden rounded-[20px]"
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(247,241,232,0.18), 0 12px 32px -12px rgba(0,0,0,0.7)",
              }}
            >
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt={item.name}
                  fill
                  unoptimized
                  sizes="96px"
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                />
              ) : (
                <div className="h-full w-full bg-[var(--ceniza)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(20,16,14,0.92)] via-transparent to-transparent" />
              <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 text-left text-[0.65rem] leading-tight text-[var(--hueso)]/90">
                {item.name}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DishFrame({
  item,
  reduceMotion,
}: {
  item: VoiceMenuItem;
  reduceMotion: boolean | null;
}) {
  if (!item.image_url) {
    // Sin foto no se finge una: se compone con color y textura para que el hueco
    // no parezca un error de carga.
    return (
      <div className="absolute inset-0 bg-[var(--ceniza)]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 30% 20%, rgba(242,167,27,0.22), transparent 60%)",
          }}
        />
      </div>
    );
  }

  return (
    <motion.div
      className="absolute inset-0"
      // Travelling muy lento. Nadie lo mira directamente; lo que se nota es que
      // la pantalla está viva.
      animate={reduceMotion ? {} : { scale: [1, 1.07] }}
      transition={{ duration: 12, ease: "linear" }}
    >
      <Image
        src={item.image_url}
        alt={item.name}
        fill
        unoptimized
        priority
        sizes="100vw"
        className="object-cover"
      />
    </motion.div>
  );
}
