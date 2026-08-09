/**
 * El reloj del estado de una orden.
 *
 * `orders.status_changed_at` existe para responder "¿cuánto lleva esto parado
 * donde está?", que es la pregunta que ordena el trabajo del salón: un plato
 * LISTO doce minutos en el pase es el fallo más caro de un servicio, y con solo
 * `created_at` es invisible.
 *
 * El problema práctico es que el estado de una orden se escribe desde CUATRO
 * sitios distintos —la transición manual, el cobro que cierra, la anulación del
 * comensal y el cierre de la visita— y basta que uno olvide la marca para que la
 * pantalla mienta justo en el caso urgente. Este helper es el único sitio donde
 * se decide qué acompaña a un cambio de estado.
 *
 * No es un disparador de base de datos a propósito: el flujo de desarrollo del
 * repositorio usa `drizzle-kit push`, que no gestiona disparadores, así que una
 * base recién levantada se quedaría sin él y la columna se llenaría de valores
 * silenciosamente falsos. Un helper se ve en el código y se cubre con pruebas.
 */

export type EstadoOrden =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "completed"
  | "cancelled";

/**
 * Lo que SIEMPRE acompaña a un cambio de estado. Úsalo en el `.set()` de
 * cualquier UPDATE que toque `orders.status`.
 */
export function camposDeCambioDeEstado(estado: EstadoOrden, ahora: Date = new Date()) {
  return {
    status: estado,
    status_changed_at: ahora,
    updated_at: ahora,
  } as const;
}
