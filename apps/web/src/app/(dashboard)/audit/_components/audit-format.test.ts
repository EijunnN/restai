import { describe, expect, test } from "bun:test";
import { buildChanges, formatValue, labelFor, wasTruncated } from "./audit-format";

/**
 * La auditoría la lee el dueño del restaurante. Si una fila dice "2596" en vez
 * de "S/ 25.96", la pantalla miente sobre cuánto dinero se perdonó. Estas
 * pruebas fijan las traducciones que no se pueden romper.
 */

describe("formatValue", () => {
  test("los importes en céntimos salen como soles", () => {
    expect(formatValue("forgiven_amount", 2596)).toBe("S/ 25.96");
    expect(formatValue("amount", 0)).toBe("S/ 0.00");
    expect(formatValue("difference", -450)).toBe("-S/ 4.50");
    expect(formatValue("total", 100000)).toBe("S/ 1000.00");
  });

  test("los contadores NO se confunden con dinero", () => {
    expect(formatValue("completed_orders", 4)).toBe("4");
    expect(formatValue("payment_count", 12)).toBe("12");
    expect(formatValue("points_reversed", 150)).toBe("150");
  });

  test("el IGV se guarda en puntos básicos y sale como porcentaje", () => {
    expect(formatValue("tax_rate", 1800)).toBe("18 %");
    expect(formatValue("tax_rate", 1050)).toBe("10.5 %");
  });

  test("los booleanos se dicen en español", () => {
    expect(formatValue("is_available", true)).toBe("Sí");
    expect(formatValue("is_available", false)).toBe("No");
  });

  test("la ausencia de dato se nombra, no se deja en blanco", () => {
    expect(formatValue("name", null)).toBe("sin definir");
    expect(formatValue("name", undefined)).toBe("sin definir");
    expect(formatValue("name", "")).toBe("sin definir");
  });

  test("los estados y medios de pago se traducen", () => {
    expect(formatValue("status", "preparing")).toBe("En preparación");
    expect(formatValue("order_status", "cancelled")).toBe("Cancelada");
    expect(formatValue("method", "cash")).toBe("Efectivo");
    expect(formatValue("method", "yape")).toBe("Yape");
    expect(formatValue("sunat_status", "accepted")).toBe("Aceptado");
    expect(formatValue("type", "takeout")).toBe("Para llevar");
  });

  test("el día de operación se lee como fecha, no como cadena ISO", () => {
    expect(formatValue("business_date", "2026-08-07")).toBe("07/08/2026");
  });

  test("los identificadores internos se acortan", () => {
    expect(formatValue("cash_session_id", "3f2a1b8c-1111-2222-3333-444455556666")).toBe("#3f2a1b8c");
  });

  test("las listas se resumen en vez de volcarse", () => {
    expect(formatValue("sources", [])).toBe("ninguno");
    expect(formatValue("sources", ["qr", "pos"])).toBe("qr, pos");
    expect(formatValue("orders", [{ id: 1 }, { id: 2 }])).toBe("2 elementos");
    expect(formatValue("orders", [{ id: 1 }])).toBe("1 elemento");
  });

  test("un objeto con nombre propio se muestra por su nombre", () => {
    expect(formatValue("item", { name: "Papa a la Huancaína", qty: 1 })).toBe(
      "Papa a la Huancaína",
    );
  });

  test("un campo desconocido no se rompe: se humaniza", () => {
    expect(labelFor("campo_nuevo_sin_traducir")).toBe("Campo nuevo sin traducir");
    expect(formatValue("campo_nuevo_sin_traducir", "hola")).toBe("hola");
  });
});

describe("buildChanges", () => {
  test("un alta (sin estado previo) lista los datos registrados", () => {
    // Traza real de `table.free`, la del pantallazo que mostraba JSON crudo.
    const rows = buildChanges(null, {
      paid: 0,
      billed: 0,
      forgiven_amount: 0,
      completed_orders: 0,
    });
    const porEtiqueta = Object.fromEntries(rows.map((r) => [r.label, r.after]));
    expect(porEtiqueta["Importe perdonado"]).toBe("S/ 0.00");
    expect(porEtiqueta["Cobrado"]).toBe("S/ 0.00");
    expect(porEtiqueta["Facturado"]).toBe("S/ 0.00");
    expect(porEtiqueta["Órdenes completadas"]).toBe("0");
  });

  test("solo se marcan como cambiados los campos que de verdad cambiaron", () => {
    const rows = buildChanges(
      { name: "Mi Resto", ruc: "20123456789", legal_name: "Mi Resto SAC" },
      { name: "Mi Resto Cevichería", ruc: "20123456789", legal_name: "Mi Resto SAC" },
    );
    const cambiados = rows.filter((r) => r.changed);
    expect(cambiados).toHaveLength(1);
    expect(cambiados[0]!.label).toBe("Nombre");
    expect(cambiados[0]!.before).toBe("Mi Resto");
    expect(cambiados[0]!.after).toBe("Mi Resto Cevichería");
  });

  test("los cambios reales van primero", () => {
    const rows = buildChanges({ a_igual: "x", status: "pending" }, { a_igual: "x", status: "ready" });
    expect(rows[0]!.changed).toBe(true);
    expect(rows[0]!.label).toBe("Estado");
  });

  test("nulo, ausente y vacío significan lo mismo: no hay cambio fantasma", () => {
    const rows = buildChanges({ phone: null }, { phone: "" });
    expect(rows.filter((r) => r.changed)).toHaveLength(0);
  });

  test("un campo que aparece de nuevas se lee como 'sin definir' → valor", () => {
    const rows = buildChanges({ name: "Sede Centro" }, { name: "Sede Centro", phone: "987654321" });
    const cambiados = rows.filter((r) => r.changed);
    expect(cambiados).toHaveLength(1);
    expect(cambiados[0]!.before).toBe("sin definir");
    expect(cambiados[0]!.after).toBe("987654321");
  });

  test("un campo que deja de informarse NO se anuncia como vaciado", () => {
    // Caso real de `order_item.cancel`: el "antes" trae el total del plato y el
    // "después" solo estado y motivo. Decir "S/ 18.00 → sin definir" afirmaría
    // un borrado que nunca ocurrió.
    const rows = buildChanges(
      { item: { status: "pending", total: 1800 } },
      { item: { status: "cancelled", reason: "Se acabó" } },
    );
    const cambiados = rows.filter((r) => r.changed);
    expect(cambiados.map((r) => r.label).sort()).toEqual([
      "Plato › Estado",
      "Plato › Motivo",
    ]);
    expect(cambiados.find((r) => r.label === "Plato › Motivo")!.after).toBe("Se acabó");
  });

  test("los objetos anidados se aplanan con su ruta legible", () => {
    const rows = buildChanges(
      { settings: { tax_rate: 1800 } },
      { settings: { tax_rate: 1000 } },
    );
    const cambiados = rows.filter((r) => r.changed);
    expect(cambiados).toHaveLength(1);
    expect(cambiados[0]!.label).toBe("Configuración › Tasa de IGV");
    expect(cambiados[0]!.before).toBe("18 %");
    expect(cambiados[0]!.after).toBe("10 %");
  });

  test("el aplanado no recurre sin fin", () => {
    const hondo = { a: { b: { c: { d: { e: 1 } } } } };
    expect(() => buildChanges(null, hondo)).not.toThrow();
    expect(buildChanges(null, hondo).length).toBeGreaterThan(0);
  });

  test("no hay filas cuando no hay payload", () => {
    expect(buildChanges(null, null)).toHaveLength(0);
  });
});

describe("wasTruncated", () => {
  test("detecta el payload recortado por el backend", () => {
    expect(wasTruncated({ _truncated: true, preview: "..." })).toBe(true);
    expect(wasTruncated({ paid: 0 })).toBe(false);
    expect(wasTruncated(null)).toBe(false);
  });
});
