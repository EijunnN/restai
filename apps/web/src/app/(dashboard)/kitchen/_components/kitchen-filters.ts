/**
 * Filtros del tablero de cocina: por zona del local y por estación.
 *
 * En una sede con varios ambientes y más de una cocina, cada pantalla debe ver
 * SOLO lo suyo: sin esto, el cocinero de la terraza lee las comandas del sótano
 * y ninguno sabe cuáles le tocan. Filtrar, sin embargo, significa que alguien
 * deja de ver trabajo pendiente, así que aquí también se calcula cuánto se está
 * escondiendo (`hiddenCount`) para que la pantalla pueda decirlo en voz alta.
 *
 * Lógica pura, cubierta por `kitchen-filters.test.ts`.
 */

/** Clave de la zona que no filtra nada. */
export const ALL_ZONES = "all";

/** Clave de la estación que no filtra nada. */
export const ALL_STATIONS = "all";

/** Comandas que no se sirven en mesa: para llevar y reparto. */
export const ZONE_NO_TABLE = "__sin_mesa__";

/** Mesas que existen pero no están asignadas a ningún espacio. */
export const ZONE_UNASSIGNED = "__sin_zona__";

/** Estados que el tablero llega a pintar. Define qué cuenta como "oculto". */
const VISIBLE_STATUSES = new Set(["pending", "preparing", "ready"]);

export interface ZoneOption {
  key: string;
  label: string;
  count: number;
  floor: number;
}

/**
 * Zona a la que pertenece una comanda.
 *
 * Sin mesa es para llevar o reparto; con mesa pero sin espacio es una mesa que
 * nadie asignó a un ambiente. Son cosas distintas y se separan a propósito:
 * mezclarlas escondería un fallo de configuración detrás de una etiqueta
 * razonable.
 */
export function zoneKeyOf(order: any): string {
  if (order?.space_id) return String(order.space_id);
  return order?.table_number == null ? ZONE_NO_TABLE : ZONE_UNASSIGNED;
}

/** Ambiente configurado en la sede, tal como llega de `GET /api/kitchen/zones`. */
export interface BranchZone {
  id: string;
  name: string;
  floor_number: number;
}

/**
 * Zonas seleccionables: el catálogo de la sede más los dos casos que no son un
 * espacio (para llevar, y mesas sin ambiente asignado).
 *
 * Se parte del CATÁLOGO y no de lo que hay en el tablero porque la tablet se
 * configura al empezar el turno, con la cocina todavía vacía: una lista que solo
 * existe cuando ya hay comandas llegaría tarde. Los conteos se superponen encima.
 *
 * `activeZone` siempre aparece aunque no esté en el catálogo (un espacio que se
 * borró): si el chip desapareciera, el cocinero se quedaría filtrando por una
 * zona que no puede ver ni cambiar.
 */
export function buildZones(
  orders: any[],
  activeZone: string,
  branchZones: BranchZone[] = [],
): ZoneOption[] {
  const counts = new Map<string, { label: string; floor: number; count: number }>();

  // El catálogo entra primero, a cero: así las zonas sin trabajo siguen siendo
  // elegibles y se ve de un vistazo cuáles están tranquilas.
  for (const z of branchZones) {
    counts.set(z.id, { label: z.name, floor: z.floor_number ?? 0, count: 0 });
  }

  for (const order of orders) {
    const key = zoneKeyOf(order);
    const label =
      key === ZONE_NO_TABLE
        ? "Para llevar y reparto"
        : key === ZONE_UNASSIGNED
          ? "Mesas sin zona"
          : (order.space_name ?? "Zona");
    // Las zonas reales se ordenan por piso; las dos especiales van al final.
    const floor =
      key === ZONE_NO_TABLE
        ? Number.MAX_SAFE_INTEGER
        : key === ZONE_UNASSIGNED
          ? Number.MAX_SAFE_INTEGER - 1
          : (order.floor_number ?? 0);

    const entry = counts.get(key) ?? { label, floor, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  const list = [...counts.entries()]
    .sort(([, a], [, b]) => a.floor - b.floor || a.label.localeCompare(b.label, "es"))
    .map(([key, z]) => ({ key, label: z.label, count: z.count, floor: z.floor }));

  // La preferencia guardada sobrevive incluso a que borren el espacio.
  if (activeZone !== ALL_ZONES && !counts.has(activeZone)) {
    list.push({ key: activeZone, label: "Mi zona", count: 0, floor: Number.MAX_SAFE_INTEGER });
  }

  return [{ key: ALL_ZONES, label: "Todo el local", count: orders.length, floor: -1 }, ...list];
}

/**
 * Aplica zona y estación.
 *
 * Una comanda entra en la estación si tiene AL MENOS una línea de esa categoría:
 * un pedido mixto tiene que verse en las dos partidas que lo cocinan.
 */
export function filterOrders(orders: any[], zone: string, station: string): any[] {
  return orders.filter((o: any) => {
    if (zone !== ALL_ZONES && zoneKeyOf(o) !== zone) return false;
    if (station === ALL_STATIONS) return true;
    return (o.items ?? []).some((it: any) => it.category_name === station);
  });
}

/**
 * Comandas pintables que el filtro está escondiendo.
 *
 * Es la salvaguarda de todo el mecanismo: una pantalla vacía por filtro es
 * indistinguible de "no hay nada que cocinar", y ese equívoco deja platos sin
 * salir.
 */
export function countHidden(allOrders: any[], visibleOrders: any[]): number {
  const pintables = (list: any[]) => list.filter((o: any) => VISIBLE_STATUSES.has(o.status)).length;
  return Math.max(0, pintables(allOrders) - pintables(visibleOrders));
}
