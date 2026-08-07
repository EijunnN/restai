"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Alertas del Kitchen Display.
 *
 * El KDS era completamente mudo: el cocinero se giraba a la plancha, entraban
 * tres comandas y se enteraba cuando el mozo venía a preguntar. El aviso sonoro
 * es el requisito número uno de cualquier cocina real.
 *
 * Decisiones:
 * - El sonido se SINTETIZA con WebAudio en vez de cargar un .mp3: no añade una
 *   petición de red que pueda fallar en la tablet de la cocina, y suena idéntico
 *   sin depender de ficheros estáticos.
 * - Los navegadores bloquean el audio hasta que hay una interacción del usuario.
 *   Por eso se expone `needsUnlock`: la pantalla puede mostrar "Toca para activar
 *   el sonido" en lugar de fallar en silencio, que sería peor que no tenerlo.
 * - Wake Lock evita que la tablet se apague en pleno servicio. Se re-solicita al
 *   volver de segundo plano, porque el navegador lo libera solo.
 */

const SOUND_PREF_KEY = "restai_kitchen_sound";

export function useKitchenAlerts() {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Preferencia persistida: el cocinero decide una vez y se respeta entre turnos.
  useEffect(() => {
    const stored = window.localStorage.getItem(SOUND_PREF_KEY);
    if (stored !== null) setSoundEnabled(stored === "1");
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      window.localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0");
      if (next) void unlockAudio();
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  /** Debe llamarse desde un gesto del usuario (click/tap) para levantar el bloqueo. */
  const unlockAudio = useCallback(async () => {
    const ctx = getContext();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      setNeedsUnlock(ctx.state !== "running");
    } catch {
      setNeedsUnlock(true);
    }
  }, [getContext]);

  /**
   * Dos tonos ascendentes, cortos y limpios. Se oye por encima del ruido de una
   * cocina sin ser estridente a la décima vez.
   */
  const playChime = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      setNeedsUnlock(true);
      return;
    }

    const now = ctx.currentTime;
    const tones = [
      { freq: 880, start: 0, dur: 0.18 },
      { freq: 1320, start: 0.16, dur: 0.26 },
    ];

    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.freq;
      // Envolvente suave: un gain constante produce un "click" al cortar.
      gain.gain.setValueAtTime(0.0001, now + tone.start);
      gain.gain.exponentialRampToValueAtTime(0.35, now + tone.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + tone.start);
      osc.stop(now + tone.start + tone.dur + 0.02);
    }
  }, [getContext]);

  /** Aviso de comanda nueva: sonido + vibración en dispositivos que la soportan. */
  const notifyNewOrder = useCallback(() => {
    if (!soundEnabled) return;
    playChime();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.([120, 60, 120]);
    }
  }, [soundEnabled, playChime]);

  // Wake Lock: la pantalla de la cocina no debe apagarse en pleno servicio.
  useEffect(() => {
    let cancelled = false;

    const request = async () => {
      try {
        const wl = (navigator as any)?.wakeLock;
        if (!wl?.request) return;
        const lock = await wl.request("screen");
        if (cancelled) {
          void lock.release?.();
          return;
        }
        wakeLockRef.current = lock;
      } catch {
        // Sin wake lock (no soportado o denegado) el KDS sigue funcionando.
      }
    };

    void request();

    // El navegador libera el bloqueo al pasar a segundo plano: se re-solicita.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void wakeLockRef.current?.release?.();
      wakeLockRef.current = null;
    };
  }, []);

  return { soundEnabled, toggleSound, notifyNewOrder, needsUnlock, unlockAudio };
}
