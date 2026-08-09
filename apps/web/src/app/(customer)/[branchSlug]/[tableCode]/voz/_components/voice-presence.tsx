"use client";

import { motion, useReducedMotion } from "motion/react";
import type { VoiceState } from "@/hooks/use-voice-agent";

/**
 * La presencia del mesero, sin avatar.
 *
 * Sustituye al orbe con degradado que había antes. Un orbe es el cliché del
 * asistente de IA y, peor aún, compite con la comida: en una pantalla cuyo
 * trabajo es dar hambre, el elemento más brillante no puede ser una bola.
 *
 * Aquí la presencia es una línea de luz en el borde inferior que se ensancha
 * con la voz. Ocupa el sitio de una sombra, se entiende sin explicación y deja
 * el plato intacto.
 */

interface VoicePresenceProps {
  state: VoiceState;
  /** Amplitud instantánea de la voz, 0–1. */
  level: number;
}

const STATE_LABEL: Record<VoiceState, string | null> = {
  idle: null,
  connecting: "Conectando",
  listening: "Te escucho",
  thinking: null,
  speaking: null,
  error: null,
};

export function VoicePresence({ state, level }: VoicePresenceProps) {
  const reduceMotion = useReducedMotion();
  const label = STATE_LABEL[state];

  const speaking = state === "speaking";
  const listening = state === "listening";
  const thinking = state === "thinking";

  return (
    <>
      {/* Línea de voz. En reposo es un hilo; al hablar se ensancha y se enciende
          al ritmo real de la voz. */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 origin-bottom"
        aria-hidden="true"
        animate={{
          height: speaking ? 3 + level * 9 : listening ? 2 : 1,
          opacity: state === "error" ? 0.25 : speaking ? 0.85 + level * 0.15 : 0.45,
        }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        style={{
          background:
            "linear-gradient(to right, transparent, var(--aji) 18%, var(--aji) 82%, transparent)",
          boxShadow: "0 0 24px rgba(242,167,27,0.55)",
        }}
      />

      {/* Tres puntos mientras piensa: el único momento en que no hay ni voz ni
          transcripción, y sin señal la pantalla parecería colgada. */}
      {thinking && !reduceMotion && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--aji)]"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
            />
          ))}
        </div>
      )}

      {label && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 text-[0.65rem] uppercase tracking-[0.35em] text-[var(--hueso)]/35"
        >
          {label}
        </motion.p>
      )}
    </>
  );
}
