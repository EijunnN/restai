"use client";

import { motion, useReducedMotion } from "motion/react";
import type { VoiceState } from "@/hooks/use-voice-agent";

/**
 * Quién está hablando, sin decirlo con palabras.
 *
 * Dos voces se turnan en esta pantalla y hasta ahora solo una dejaba rastro: la
 * del mesero movía la línea de luz del borde inferior, y mientras hablaba el
 * COMENSAL no se movía absolutamente nada. Hablarle a una pantalla quieta es
 * hablarle a algo que parece apagado, y la reacción natural de cualquiera es
 * repetir más alto, acercarse al micro o rendirse y tocar la carta.
 *
 * Aquí las dos voces comparten el mismo elemento —esa línea— y se distinguen por
 * MATERIA, no por forma:
 *
 * - El mesero es LUZ: la línea se enciende en ámbar y se ensancha con su voz.
 * - El comensal es ALIENTO: un velo tenue en hueso sube desde el borde y respira
 *   con la suya, sin bordes ni brillo.
 *
 * Es deliberado que no haya barras de ecualizador ni un orbe. Un orbe es el
 * cliché del asistente de IA y compite con la comida; unas barras convierten una
 * mesa de restaurante en una app de dictado. Aquí el elemento más brillante de la
 * pantalla sigue siendo el plato.
 *
 * Y un punto ámbar junto a "Te escucho" que late con la voz: el velo es la parte
 * ambiental, el punto es la precisa. Con los dos, la confirmación se ve tanto de
 * reojo como mirando fijamente.
 */

interface VoicePresenceProps {
  state: VoiceState;
  /** Amplitud de la voz del MESERO, 0–1. */
  level: number;
  /** Amplitud de la voz del COMENSAL, 0–1. */
  inputLevel?: number;
}

const STATE_LABEL: Record<VoiceState, string | null> = {
  idle: null,
  connecting: "Conectando",
  listening: "Te escucho",
  thinking: null,
  speaking: null,
  error: null,
};

/**
 * Suelo de ruido.
 *
 * Un comedor nunca está en silencio: cubiertos, música, la mesa de al lado. Sin
 * este umbral la pantalla tiembla sola toda la noche, y una señal que está
 * siempre encendida deja de ser una señal. Por debajo de esto, quieta.
 */
export const SUELO_DE_RUIDO = 0.08;

/**
 * Convierte la amplitud cruda del micro en "cuánta voz hay", 0–1.
 *
 * Reescala en vez de recortar: si se limitara a ignorar lo bajo, la señal
 * arrancaría de golpe en 0,08 y el velo aparecería de un salto. Reescalado,
 * empieza en cero justo donde deja de ser ruido y crece de forma continua.
 */
export function vozDelComensal(nivel: number): number {
  if (!Number.isFinite(nivel) || nivel <= SUELO_DE_RUIDO) return 0;
  return Math.min(1, (nivel - SUELO_DE_RUIDO) / (1 - SUELO_DE_RUIDO));
}

export function VoicePresence({ state, level, inputLevel = 0 }: VoicePresenceProps) {
  const reduceMotion = useReducedMotion();
  const label = STATE_LABEL[state];

  const speaking = state === "speaking";
  const listening = state === "listening";
  const thinking = state === "thinking";

  // Solo cuenta mientras le toca hablar al comensal: durante la respuesta del
  // mesero, el micro sigue abierto y capta su propia voz por el altavoz.
  const voz = listening ? vozDelComensal(inputLevel) : 0;
  const hablando = voz > 0;

  return (
    <>
      {/*
        El aliento. Un degradado sin borde que sube desde abajo con la voz del
        comensal. Va DEBAJO de la línea y con opacidad muy baja: tiene que
        notarse sin que uno sepa decir qué se movió, y sin aclarar la foto.
      */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 origin-bottom"
        aria-hidden="true"
        animate={{
          height: 30 + voz * 130,
          /*
            Raíz cuadrada y no lineal, por dos motivos que se ven en pantalla:
            la percepción del brillo no es lineal —una voz baja tiene que
            notarse, no quedarse en un 0,6 % invisible— y sobre todo así la
            opacidad ARRANCA EN CERO. Con `0,05 + voz` daba un salto al cruzar
            el umbral: el velo aparecía de golpe con la primera sílaba en vez de
            crecer con ella.
          */
          opacity: Math.sqrt(voz) * 0.15,
        }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 120, damping: 26, mass: 0.6 }
        }
        style={{
          background:
            "radial-gradient(120% 100% at 50% 100%, rgba(240,236,228,0.9) 0%, rgba(240,236,228,0.35) 45%, transparent 75%)",
        }}
      />

      {/*
        La línea. Es de los dos: ámbar y ancha cuando habla el mesero, hueso y
        fina cuando habla el comensal. Compartir el elemento mantiene la pantalla
        en calma; cambiar de material dice quién tiene el turno.
      */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 origin-bottom"
        aria-hidden="true"
        animate={{
          height: speaking ? 3 + level * 9 : hablando ? 2 + voz * 3 : listening ? 2 : 1,
          opacity:
            state === "error"
              ? 0.25
              : speaking
                ? 0.85 + level * 0.15
                : hablando
                  ? 0.55 + voz * 0.35
                  : 0.45,
        }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 24 }
        }
        style={{
          background: speaking
            ? "linear-gradient(to right, transparent, var(--aji) 18%, var(--aji) 82%, transparent)"
            : "linear-gradient(to right, transparent, var(--hueso) 22%, var(--hueso) 78%, transparent)",
          boxShadow: speaking
            ? "0 0 24px rgba(242,167,27,0.55)"
            : hablando
              ? "0 0 18px rgba(240,236,228,0.28)"
              : "none",
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-2.5"
        >
          {/*
            El punto. Late despacio mientras el micro está abierto y nadie habla
            —eso ya dice "estoy encendido"— y se agranda con la voz en cuanto la
            hay. Es la parte precisa de la señal: el velo se percibe de reojo,
            esto se lee mirando.
          */}
          {listening && (
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-[var(--aji)]"
              animate={
                hablando
                  ? { scale: 1 + voz * 1.6, opacity: 0.55 + voz * 0.45 }
                  : reduceMotion
                    ? { scale: 1, opacity: 0.5 }
                    : { scale: [1, 1.25, 1], opacity: [0.35, 0.6, 0.35] }
              }
              transition={
                hablando
                  ? { type: "spring", stiffness: 400, damping: 22 }
                  : reduceMotion
                    ? { duration: 0 }
                    : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
              }
            />
          )}
          <span className="text-[0.65rem] uppercase tracking-[0.35em] text-[var(--hueso)]/35">
            {label}
          </span>
        </motion.div>
      )}
    </>
  );
}
