"use client";

import { useEffect, useState } from "react";

/**
 * `false` durante el render del servidor y en el PRIMER render del cliente;
 * `true` a partir de ahí.
 *
 * ── Para qué ─────────────────────────────────────────────────────────────────
 * Los datos de sesión del comensal (`useCustomerStore`) salen de
 * `sessionStorage`, que en el servidor no existe. Eso hace que el servidor
 * pinte un hueco y el cliente pinte "Sede Principal" en el mismo sitio: React
 * detecta que el HTML no coincide, descarta ese árbol y lo vuelve a construir.
 *
 * El daño no es solo el aviso en consola —que tapa errores de verdad—: es que
 * el trabajo de hidratación se tira y se rehace, justo en la primera pantalla
 * que ve el comensal.
 *
 * Con esto, ambos lados renderizan lo MISMO en el primer pase y el valor real
 * entra después, ya en el cliente.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
