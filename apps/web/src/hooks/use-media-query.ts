"use client";

import { useEffect, useState } from "react";

/**
 * ¿Se cumple esta media query ahora mismo?
 *
 * Existe porque hay decisiones que las clases de Tailwind NO pueden tomar:
 * esconder con `xl:hidden` el contenido de un diálogo deja igualmente montado
 * su fondo oscuro y su captura de foco, así que en pantalla ancha la página se
 * oscurecía entera y dejaba de responder sin que se viera nada. Cuando lo que
 * hay que decidir es si un componente se MONTA —y no solo si se ve—, hace falta
 * saberlo en JavaScript.
 *
 * Devuelve `false` en el primer render (el servidor no tiene ventana) y se
 * corrige tras montar. Quien lo use debe tolerar ese primer `false`: es seguro
 * mientras sirva para NO abrir algo, nunca para abrirlo.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** Ancho a partir del cual la sala muestra su panel lateral fijo (Tailwind `xl`). */
export const XL_QUERY = "(min-width: 1280px)";
