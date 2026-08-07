"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Tema claro / oscuro.
 *
 * La aplicación llevaba `class="dark"` fijo en el `<html>`, así que el modo
 * claro existía en el CSS y era inalcanzable. En una cocina eso no es un capricho
 * estético: una tablet junto a un ventanal a mediodía es ilegible en oscuro, y
 * una a media luz en el pase deslumbra en claro. La decisión la toma quien está
 * delante de la pantalla, y se recuerda por dispositivo.
 *
 * El script que evita el parpadeo inicial vive en el layout raíz: aplica la
 * clase ANTES del primer pintado, leyendo esta misma clave.
 */

const STORAGE_KEY = "restai_theme";

export type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // `color-scheme` hace que los controles nativos (scrollbars, selects del
  // sistema, autocompletado) sigan al tema; sin él quedan blancos sobre oscuro.
  root.style.colorScheme = theme;
}

export function useTheme() {
  // Arranca en "dark" para coincidir con lo que el script del layout ya pintó;
  // el efecto lo corrige de inmediato si el dispositivo guardó otra cosa.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Theme =
      stored === "light" || stored === "dark"
        ? stored
        : document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
