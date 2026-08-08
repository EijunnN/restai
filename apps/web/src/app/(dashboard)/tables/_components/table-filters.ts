/**
 * Decisiones de la pantalla de sala: qué mesas se ven, cuántas hay de cada cosa
 * y cuánta gente cabe dentro.
 *
 * Vive aparte del contexto porque es donde se puede equivocar de verdad: un
 * fallo aquí no rompe la pantalla, la deja mintiendo. Cubierto por
 * `table-filters.test.ts`.
 */

import type { TableRow } from "@/hooks/use-tables";

/** Clave del espacio que no filtra nada. */
export const ALL_SPACES = "all";

/** Mesas que no pertenecen a ningún espacio. */
export const UNASSIGNED_SPACE = "unassigned";

/** Clave del filtro de estado que no filtra nada. */
export const ALL_STATES = "all";

export type StateFilter = "all" | "available" | "occupied" | "reserved" | "alerts";

export interface FilterInput {
  space: string;
  stateFilter: StateFilter;
  onlyMine: boolean;
  /** Mesas asignadas a este mozo. Solo cuenta si `onlyMine` está activo. */
  assignedTableIds: Set<string>;
  /** Mesas con un aviso sin atender o alguien esperando entrar. */
  alertTableIds: Set<string>;
}

/** Aplica espacio, estado y "solo mis mesas" en ese orden. */
export function filterTables(all: TableRow[], f: FilterInput): TableRow[] {
  return all.filter((t) => {
    if (f.space === UNASSIGNED_SPACE) {
      if (t.space_id) return false;
    } else if (f.space !== ALL_SPACES && t.space_id !== f.space) {
      return false;
    }
    if (f.onlyMine && !f.assignedTableIds.has(t.id)) return false;
    if (f.stateFilter === "alerts") return f.alertTableIds.has(t.id);
    if (f.stateFilter !== ALL_STATES && t.status !== f.stateFilter) return false;
    return true;
  });
}

export interface RoomCounts {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  alerts: number;
}

/**
 * Contadores de la sala ENTERA, nunca de lo filtrado.
 *
 * Son el pulso del local: si bajaran al mirar solo la terraza, la cabecera
 * diría que hay tres mesas ocupadas cuando en realidad hay veinte.
 */
export function countTables(all: TableRow[], alertTableIds: Set<string>): RoomCounts {
  return {
    total: all.length,
    available: all.filter((t) => t.status === "available").length,
    occupied: all.filter((t) => t.status === "occupied").length,
    reserved: all.filter((t) => t.status === "reserved").length,
    maintenance: all.filter((t) => t.status === "maintenance").length,
    alerts: all.filter((t) => alertTableIds.has(t.id)).length,
  };
}

export interface Occupancy {
  /** Comensales declarados, sumados. */
  seated: number;
  /** Aforo de mobiliario de toda la sala. */
  capacity: number;
  /** Visitas activas que no declararon cuántos son. */
  unknown: number;
}

/**
 * Ocupación real de la sala.
 *
 * Cuenta personas, no sillas: una mesa de seis con dos comensales no llena el
 * local. Las visitas sin dato se informan aparte en vez de contarse como cero,
 * que haría parecer la sala más vacía de lo que está. Las visitas `pending`
 * —alguien escaneó el QR pero nadie le ha abierto la cuenta— todavía no están
 * sentadas y no suman.
 */
export function computeOccupancy(all: TableRow[]): Occupancy {
  let seated = 0;
  let unknown = 0;
  for (const t of all) {
    const s = t.active_session;
    if (!s || s.status !== "active") continue;
    if (typeof s.guest_count === "number") seated += s.guest_count;
    else unknown += 1;
  }
  return {
    seated,
    capacity: all.reduce((n, t) => n + (t.capacity ?? 0), 0),
    unknown,
  };
}
