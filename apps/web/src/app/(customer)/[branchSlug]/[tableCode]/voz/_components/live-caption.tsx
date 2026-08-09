"use client";

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

/**
 * Lo que dice el mesero, sobreimpreso en la comida.
 *
 * Tratado como el subtítulo de una película, no como un bocadillo de chat: sin
 * caja, sin fondo, sin icono. La letra se apoya directamente en la foto y la
 * legibilidad la da el oscurecido del escenario, igual que en cine.
 *
 * Solo se conserva la cola de la frase. Un párrafo entero convierte la pantalla
 * en un teleprónter y el ojo abandona el plato, que es lo único que aquí
 * interesa mirar.
 */

const MAX_WORDS = 16;

interface LiveCaptionProps {
  transcript: string;
}

export function LiveCaption({ transcript }: LiveCaptionProps) {
  const reduceMotion = useReducedMotion();

  const words = useMemo(() => {
    const all = transcript.trim().split(/\s+/).filter(Boolean);
    const tail = all.slice(-MAX_WORDS);
    // El índice absoluto es la clave de animación: sin él, al recortar la cola
    // React reutiliza claves y las palabras ya asentadas vuelven a entrar.
    return tail.map((word, i) => ({ word, key: all.length - tail.length + i }));
  }, [transcript]);

  if (words.length === 0) return null;

  return (
    <p className="pointer-events-none flex max-w-[42ch] flex-wrap items-baseline gap-x-[0.3em] gap-y-1 text-[clamp(1.5rem,2.8vw,2.4rem)] font-light leading-[1.25] text-[var(--hueso)]">
      <AnimatePresence initial={false}>
        {words.map(({ word, key }) => (
          <motion.span
            key={key}
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 10, filter: "blur(6px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 460, damping: 34 }}
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.65)" }}
          >
            {word}
          </motion.span>
        ))}
      </AnimatePresence>
    </p>
  );
}
