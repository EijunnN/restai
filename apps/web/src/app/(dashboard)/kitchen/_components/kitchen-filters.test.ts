import { describe, expect, test } from "bun:test";
import {
  ALL_STATIONS,
  ALL_ZONES,
  ZONE_NO_TABLE,
  ZONE_UNASSIGNED,
  buildZones,
  countHidden,
  filterOrders,
  zoneKeyOf,
} from "./kitchen-filters";

/**
 * Si estos filtros se equivocan, un cocinero deja de ver platos que tiene que
 * cocinar y nadie se entera hasta que el comensal reclama. La forma de los datos
 * es la que devuelve `GET /api/kitchen/orders`.
 */

const TERRAZA = "11111111-1111-1111-1111-111111111111";
const SALON = "22222222-2222-2222-2222-222222222222";

const enMesa = (space_id: string, space_name: string, floor_number: number, extra: any = {}) => ({
  status: "pending",
  type: "dine_in",
  table_number: 8,
  space_id,
  space_name,
  floor_number,
  items: [],
  ...extra,
});

const paraLlevar = (extra: any = {}) => ({
  status: "pending",
  type: "takeout",
  table_number: null,
  space_id: null,
  space_name: null,
  floor_number: null,
  items: [],
  ...extra,
});

describe("zoneKeyOf", () => {
  test("una comanda en mesa pertenece a su espacio", () => {
    expect(zoneKeyOf(enMesa(TERRAZA, "Terraza", 1))).toBe(TERRAZA);
  });

  test("sin mesa es para llevar o reparto, no una zona", () => {
    expect(zoneKeyOf(paraLlevar())).toBe(ZONE_NO_TABLE);
    expect(zoneKeyOf({ type: "delivery", table_number: null, space_id: null })).toBe(ZONE_NO_TABLE);
  });

  test("con mesa pero sin espacio es un fallo de configuración, y se nombra aparte", () => {
    expect(zoneKeyOf({ table_number: 3, space_id: null })).toBe(ZONE_UNASSIGNED);
  });

  test("la mesa 0 no se confunde con 'sin mesa'", () => {
    // `table_number: 0` es falsy: comprobarlo con `!order.table_number` mandaría
    // esa mesa al cajón de "para llevar" y su comanda desaparecería de la zona.
    expect(zoneKeyOf({ table_number: 0, space_id: null })).toBe(ZONE_UNASSIGNED);
  });
});

describe("filterOrders", () => {
  const tablero = [
    enMesa(TERRAZA, "Terraza", 2),
    enMesa(SALON, "Salon", 1),
    enMesa(SALON, "Salon", 1),
    paraLlevar(),
  ];

  test("sin filtros se ve todo", () => {
    expect(filterOrders(tablero, ALL_ZONES, ALL_STATIONS)).toHaveLength(4);
  });

  test("filtrar por zona deja solo esa zona", () => {
    expect(filterOrders(tablero, SALON, ALL_STATIONS)).toHaveLength(2);
    expect(filterOrders(tablero, TERRAZA, ALL_STATIONS)).toHaveLength(1);
  });

  test("las comandas para llevar NO se cuelan en una zona de mesas", () => {
    // Es el error que haría que la terraza cocinara los pedidos de reparto.
    const soloTerraza = filterOrders(tablero, TERRAZA, ALL_STATIONS);
    expect(soloTerraza.every((o) => o.type === "dine_in")).toBe(true);
  });

  test("las comandas para llevar tienen su propia zona y no se pierden", () => {
    expect(filterOrders(tablero, ZONE_NO_TABLE, ALL_STATIONS)).toHaveLength(1);
  });

  test("un pedido mixto aparece en las dos estaciones que lo cocinan", () => {
    const mixto = enMesa(SALON, "Salon", 1, {
      items: [{ category_name: "Parrilla" }, { category_name: "Postres" }],
    });
    expect(filterOrders([mixto], ALL_ZONES, "Parrilla")).toHaveLength(1);
    expect(filterOrders([mixto], ALL_ZONES, "Postres")).toHaveLength(1);
    expect(filterOrders([mixto], ALL_ZONES, "Frios")).toHaveLength(0);
  });

  test("zona y estación se combinan", () => {
    const orders = [
      enMesa(TERRAZA, "Terraza", 2, { items: [{ category_name: "Parrilla" }] }),
      enMesa(SALON, "Salon", 1, { items: [{ category_name: "Parrilla" }] }),
    ];
    expect(filterOrders(orders, TERRAZA, "Parrilla")).toHaveLength(1);
    expect(filterOrders(orders, TERRAZA, "Postres")).toHaveLength(0);
  });
});

describe("buildZones", () => {
  test("incluye 'Todo el local' primero, con el total", () => {
    const zones = buildZones([enMesa(TERRAZA, "Terraza", 1), paraLlevar()], ALL_ZONES);
    expect(zones[0]!.key).toBe(ALL_ZONES);
    expect(zones[0]!.count).toBe(2);
  });

  test("ordena las zonas por piso y deja 'para llevar' al final", () => {
    const zones = buildZones(
      [
        paraLlevar(),
        enMesa(TERRAZA, "Terraza", 3),
        enMesa(SALON, "Salon", 1),
      ],
      ALL_ZONES,
    );
    expect(zones.map((z) => z.label)).toEqual([
      "Todo el local",
      "Salon",
      "Terraza",
      "Para llevar y reparto",
    ]);
  });

  test("cuenta las comandas de cada zona", () => {
    const zones = buildZones(
      [enMesa(SALON, "Salon", 1), enMesa(SALON, "Salon", 1), paraLlevar()],
      ALL_ZONES,
    );
    expect(zones.find((z) => z.key === SALON)!.count).toBe(2);
    expect(zones.find((z) => z.key === ZONE_NO_TABLE)!.count).toBe(1);
  });

  test("la zona elegida sigue en la lista aunque se quede sin comandas", () => {
    // Cocina vacía entre servicios: si el chip desapareciera, el cocinero de la
    // terraza no tendría forma de volver a su zona.
    const zones = buildZones([], TERRAZA);
    expect(zones.some((z) => z.key === TERRAZA)).toBe(true);
    expect(zones.find((z) => z.key === TERRAZA)!.count).toBe(0);
  });

  test("no se duplica la zona activa cuando sí tiene comandas", () => {
    const zones = buildZones([enMesa(TERRAZA, "Terraza", 1)], TERRAZA);
    expect(zones.filter((z) => z.key === TERRAZA)).toHaveLength(1);
  });

  test("con la cocina vacía se pueden elegir todas las zonas de la sede", () => {
    // Preconfigurar la tablet al empezar el turno: sin catálogo, el selector
    // estaría vacío justo cuando hace falta.
    const catalogo = [
      { id: SALON, name: "Salon", floor_number: 1 },
      { id: TERRAZA, name: "Terraza", floor_number: 2 },
    ];
    const zones = buildZones([], ALL_ZONES, catalogo);
    expect(zones.map((z) => z.label)).toEqual(["Todo el local", "Salon", "Terraza"]);
    expect(zones.every((z) => z.count === 0)).toBe(true);
  });

  test("los conteos se superponen sobre el catálogo sin duplicar zonas", () => {
    const catalogo = [
      { id: SALON, name: "Salon", floor_number: 1 },
      { id: TERRAZA, name: "Terraza", floor_number: 2 },
    ];
    const zones = buildZones([enMesa(SALON, "Salon", 1), paraLlevar()], ALL_ZONES, catalogo);
    expect(zones.filter((z) => z.key === SALON)).toHaveLength(1);
    expect(zones.find((z) => z.key === SALON)!.count).toBe(1);
    expect(zones.find((z) => z.key === TERRAZA)!.count).toBe(0);
    // "Para llevar" no está en el catálogo de espacios, pero debe aparecer.
    expect(zones.find((z) => z.key === ZONE_NO_TABLE)!.count).toBe(1);
  });

  test("una zona del catálogo respeta el orden por piso", () => {
    const catalogo = [
      { id: TERRAZA, name: "Terraza", floor_number: 3 },
      { id: SALON, name: "Salon", floor_number: 1 },
    ];
    const zones = buildZones([], ALL_ZONES, catalogo);
    expect(zones.map((z) => z.label)).toEqual(["Todo el local", "Salon", "Terraza"]);
  });
});

describe("countHidden", () => {
  const tablero = [
    enMesa(TERRAZA, "Terraza", 2),
    enMesa(SALON, "Salon", 1),
    paraLlevar(),
  ];

  test("sin filtro no hay nada oculto", () => {
    const visibles = filterOrders(tablero, ALL_ZONES, ALL_STATIONS);
    expect(countHidden(tablero, visibles)).toBe(0);
  });

  test("cuenta lo que el filtro esconde", () => {
    const visibles = filterOrders(tablero, TERRAZA, ALL_STATIONS);
    expect(countHidden(tablero, visibles)).toBe(2);
  });

  test("solo cuenta lo que el tablero pintaría", () => {
    // `confirmed` y `served` no tienen columna: contarlos como ocultos haría
    // saltar la alarma permanentemente y la gente dejaría de leerla.
    const conInvisibles = [
      ...tablero,
      { ...paraLlevar(), status: "confirmed" },
      { ...paraLlevar(), status: "served" },
    ];
    const visibles = filterOrders(conInvisibles, ALL_ZONES, ALL_STATIONS);
    expect(countHidden(conInvisibles, visibles)).toBe(0);
  });

  test("nunca es negativo", () => {
    expect(countHidden([], tablero)).toBe(0);
  });
});
