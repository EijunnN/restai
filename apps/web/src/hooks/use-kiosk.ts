"use client";

import { useEffect, useRef } from "react";

/**
 * Lo que hace falta para que una tablet aguante un turno entero sola.
 *
 * Son dos problemas distintos y los dos matan la experiencia en silencio:
 *
 *  1. **La pantalla se apaga.** Una tablet colgada en la pared con el salvapantallas
 *     puesto no invita a nadie: parece un aparato roto. El Wake Lock la mantiene
 *     despierta mientras la pestaña está visible, y hay que RE-pedirlo cada vez
 *     que se vuelve de segundo plano porque el navegador lo suelta al ocultar.
 *  2. **La sesión anterior se queda puesta.** Si el comensal se levanta sin
 *     cerrar nada, el siguiente se encuentra la conversación del anterior a
 *     medias. El temporizador de inactividad devuelve la tablet a su estado
 *     inicial.
 */

/**
 * Marca que el comensal llegó desde una tablet de pared y quiere hablar.
 *
 * Sobrevive al flujo de sesión (registro y, si el local lo exige, aprobación
 * del mozo) para que al llegar a la carta se pueda saltar directo a la
 * conversación. Se consume una sola vez: si el comensal vuelve a la carta más
 * tarde, ya no se le secuestra la pantalla.
 */
export const KIOSK_INTENT_KEY = "voice_kiosk_intent";

/** Mantiene la pantalla encendida mientras el componente esté montado. */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return;
    // No todos los navegadores lo soportan (Safari lo añadió tarde). Donde no
    // esté, la tablet se configura con el tiempo de apagado del sistema.
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Se deniega si la pestaña no está visible; el listener lo reintenta.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * Llama a `onIdle` tras `timeoutMs` sin actividad.
 *
 * `reset()` reinicia la cuenta: la pantalla de voz lo llama en cada turno de la
 * conversación, porque hablar ES actividad aunque nadie toque el cristal —y sin
 * eso la tablet se reiniciaría en mitad de un pedido.
 */
export function useIdleTimeout(
  timeoutMs: number,
  onIdle: () => void,
  active = true,
): { reset: () => void } {
  const onIdleRef = useRef(onIdle);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!active) return;
    timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs);
  };

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const handler = () => reset();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    reset();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `reset` se redefine en cada render pero solo lee refs; las dependencias
    // reales son las de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs, active]);

  return { reset };
}
