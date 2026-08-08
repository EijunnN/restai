import { describe, expect, test } from "bun:test";
import type { TableRow } from "@/hooks/use-tables";
import {
  ALL_SPACES,
  ALL_STATES,
  UNASSIGNED_SPACE,
  computeOccupancy,
  countTables,
  filterTables,
  type FilterInput,
} from "./table-filters";

/**
 * Si estos cálculos fallan, la sala no se rompe: miente. Un mozo deja de ver la
 * mesa que le reclama, o el gerente lee un aforo que no existe.
 */

const SALON = "11111111-1111-1111-1111-111111111111";
const TERRAZA = "22222222-2222-2222-2222-222222222222";

let seq = 0;
function mesa(over: Partial<TableRow> = {}): TableRow {
  seq += 1;
  return {
    id: `t${seq}`,
    branch_id: "b",
    organization_id: "o",
    space_id: SALON,
    number: seq,
    capacity: 4,
    qr_code: `qr${seq}`,
    short_code: `M${seq}`,
    status: "available",
    position_x: 0,
    position_y: 0,
    created_at: "2026-08-07T12:00:00Z",
    active_session: null,
    ...over,
  };
}

function visita(over: Partial<NonNullable<TableRow["active_session"]>> = {}) {
  return {
    session_id: "s1",
    customer_name: "Cliente",
    status: "active" as const,
    started_at: "2026-08-07T12:00:00Z",
    guest_count: 2,
    elapsed_minutes: 10,
    order_count: 1,
    billed: 5000,
    paid: 0,
    remaining: 5000,
    ...over,
  };
}

const base = (): FilterInput => ({
  space: ALL_SPACES,
  stateFilter: ALL_STATES,
  onlyMine: false,
  assignedTableIds: new Set<string>(),
  alertTableIds: new Set<string>(),
});

describe("filterTables", () => {
  test("sin filtros se ve toda la sala", () => {
    const all = [mesa(), mesa({ status: "occupied" }), mesa({ space_id: TERRAZA })];
    expect(filterTables(all, base())).toHaveLength(3);
  });

  test("filtrar por espacio deja solo ese ambiente", () => {
    const all = [mesa(), mesa({ space_id: TERRAZA }), mesa({ space_id: TERRAZA })];
    expect(filterTables(all, { ...base(), space: TERRAZA })).toHaveLength(2);
  });

  test("«sin espacio» son las mesas que nadie asignó a un ambiente", () => {
    const all = [mesa(), mesa({ space_id: null }), mesa({ space_id: null })];
    const r = filterTables(all, { ...base(), space: UNASSIGNED_SPACE });
    expect(r).toHaveLength(2);
    expect(r.every((t) => t.space_id === null)).toBe(true);
  });

  test("filtrar por estado", () => {
    const all = [
      mesa({ status: "available" }),
      mesa({ status: "occupied" }),
      mesa({ status: "occupied" }),
      mesa({ status: "reserved" }),
    ];
    expect(filterTables(all, { ...base(), stateFilter: "occupied" })).toHaveLength(2);
    expect(filterTables(all, { ...base(), stateFilter: "reserved" })).toHaveLength(1);
  });

  test("«con aviso» ignora el estado: una mesa LIBRE que reclama también sale", () => {
    // Es el caso de alguien que escaneó el QR de una mesa vacía y espera que le
    // abran la cuenta. Si el filtro exigiera "ocupada", nadie lo vería.
    const libre = mesa({ status: "available" });
    const ocupada = mesa({ status: "occupied" });
    const r = filterTables([libre, ocupada], {
      ...base(),
      stateFilter: "alerts",
      alertTableIds: new Set([libre.id]),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe(libre.id);
  });

  test("«solo mis mesas» se combina con el espacio", () => {
    const mia = mesa({ space_id: TERRAZA });
    const ajena = mesa({ space_id: TERRAZA });
    const miaOtroEspacio = mesa({ space_id: SALON });
    const r = filterTables([mia, ajena, miaOtroEspacio], {
      ...base(),
      space: TERRAZA,
      onlyMine: true,
      assignedTableIds: new Set([mia.id, miaOtroEspacio.id]),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe(mia.id);
  });

  test("«solo mis mesas» desactivado ignora la asignación", () => {
    const all = [mesa(), mesa()];
    expect(
      filterTables(all, { ...base(), onlyMine: false, assignedTableIds: new Set() }),
    ).toHaveLength(2);
  });
});

describe("countTables", () => {
  test("cuenta cada estado por separado", () => {
    const all = [
      mesa({ status: "available" }),
      mesa({ status: "available" }),
      mesa({ status: "occupied" }),
      mesa({ status: "reserved" }),
      mesa({ status: "maintenance" }),
    ];
    const c = countTables(all, new Set());
    expect(c).toMatchObject({
      total: 5,
      available: 2,
      occupied: 1,
      reserved: 1,
      maintenance: 1,
      alerts: 0,
    });
  });

  test("los avisos se cuentan aunque la mesa esté libre", () => {
    const libre = mesa({ status: "available" });
    const c = countTables([libre, mesa()], new Set([libre.id]));
    expect(c.alerts).toBe(1);
  });

  test("un aviso de una mesa que ya no existe no infla el contador", () => {
    const c = countTables([mesa()], new Set(["mesa-borrada"]));
    expect(c.alerts).toBe(0);
  });
});

describe("computeOccupancy", () => {
  test("suma comensales declarados, no sillas", () => {
    const all = [
      mesa({ capacity: 6, status: "occupied", active_session: visita({ guest_count: 2 }) }),
      mesa({ capacity: 4, status: "occupied", active_session: visita({ guest_count: 3 }) }),
      mesa({ capacity: 2 }),
    ];
    const o = computeOccupancy(all);
    expect(o.seated).toBe(5);
    expect(o.capacity).toBe(12);
    expect(o.unknown).toBe(0);
  });

  test("una visita sin declarar NO cuenta como cero: se informa aparte", () => {
    const all = [
      mesa({ status: "occupied", active_session: visita({ guest_count: null }) }),
      mesa({ status: "occupied", active_session: visita({ guest_count: 4 }) }),
    ];
    const o = computeOccupancy(all);
    expect(o.seated).toBe(4);
    expect(o.unknown).toBe(1);
  });

  test("quien solo escaneó el QR todavía no está sentado", () => {
    // `pending` es "espera que le abran la cuenta". Contarlo inflaría el aforo
    // con gente que aún está de pie en la puerta.
    const all = [
      mesa({ active_session: visita({ status: "pending", guest_count: 5 }) }),
    ];
    const o = computeOccupancy(all);
    expect(o.seated).toBe(0);
    expect(o.unknown).toBe(0);
  });

  test("una sala vacía no rompe la división", () => {
    const o = computeOccupancy([]);
    expect(o).toEqual({ seated: 0, capacity: 0, unknown: 0 });
  });

  test("una mesa ocupada sin sesión no aporta comensales", () => {
    // Ocurre si alguien forzó el estado sin abrir cuenta.
    const o = computeOccupancy([mesa({ status: "occupied", active_session: null })]);
    expect(o.seated).toBe(0);
    expect(o.unknown).toBe(0);
  });
});
