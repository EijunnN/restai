import { describe, it, expect } from "bun:test";
import { generateShortCode, normalizeShortCode } from "../../lib/id";
import { peruCivilDayStart, peruCivilDayEnd, peruCivilDate, peruStartOfDay } from "../../lib/timezone";

/**
 * Código corto de mesa: el plan B cuando el comensal no puede escanear el QR.
 *
 * Lo que se prueba es que sea DICTABLE: si el mozo lo lee por teléfono y la
 * persona teclea otra cosa, no sirve de nada.
 */
describe("lib/id — código corto de mesa", () => {
  const AMBIGUOS = ["I", "L", "O", "U", "0", "1"];

  it("nunca usa caracteres ambiguos", () => {
    // 500 muestras: si algún ambiguo estuviera en el alfabeto, saldría seguro.
    for (let i = 0; i < 500; i++) {
      const code = generateShortCode();
      for (const ch of AMBIGUOS) {
        expect(code).not.toContain(ch);
      }
    }
  });

  it("tiene la longitud pedida y solo mayúsculas y dígitos", () => {
    expect(generateShortCode()).toHaveLength(5);
    expect(generateShortCode(8)).toHaveLength(8);
    expect(generateShortCode(6)).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("no repite en un volumen realista de mesas", () => {
    // Un local grande no pasa de ~200 mesas; con 30^5 combinaciones la colisión
    // debe ser anecdótica. (La unicidad REAL la garantiza el índice único de la
    // BD; esto solo comprueba que el generador tiene entropía suficiente para no
    // provocar reintentos constantes.)
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateShortCode());
    expect(codes.size).toBeGreaterThan(990);
  });

  it("normaliza lo que la gente teclea de verdad", () => {
    expect(normalizeShortCode(" nxnv2 ")).toBe("NXNV2");
    expect(normalizeShortCode("NX-NV2")).toBe("NXNV2");
    expect(normalizeShortCode("nx nv2")).toBe("NXNV2");
    expect(normalizeShortCode("NX.NV2")).toBe("NXNV2");
    expect(normalizeShortCode("nx_nv2")).toBe("NXNV2");
  });

  it("no inventa correcciones para caracteres imposibles", () => {
    // Deliberado: como el alfabeto excluye los ambiguos, un 0 o una O en la
    // entrada no tienen lectura alternativa válida. Adivinar daría el código de
    // OTRA mesa, y sentar a alguien en la mesa equivocada es peor que fallar.
    expect(normalizeShortCode("0BCDE")).toBe("0BCDE");
    expect(normalizeShortCode("IBCDE")).toBe("IBCDE");
  });

  it("acota la longitud para que una entrada larga no llegue a la consulta", () => {
    expect(normalizeShortCode("A".repeat(200))).toHaveLength(8);
  });
});

/**
 * Fechas civiles peruanas.
 *
 * El defecto que motivó estos helpers: `peruStartOfDay(new Date("2026-08-07"))`
 * devolvía la ventana del 6 de agosto, así que "Hoy" en los reportes mostraba
 * las ventas de ayer y S/ 0.00 de hoy.
 */
describe("lib/timezone — fechas civiles de Lima", () => {
  it("peruCivilDayStart interpreta la fecha como día de LIMA, no como UTC", () => {
    // Medianoche del 7 de agosto en Lima = 05:00 UTC del mismo día.
    expect(peruCivilDayStart("2026-08-07").toISOString()).toBe("2026-08-07T05:00:00.000Z");
  });

  it("peruCivilDayEnd es exclusivo: la medianoche del día siguiente", () => {
    expect(peruCivilDayEnd("2026-08-07").toISOString()).toBe("2026-08-08T05:00:00.000Z");
  });

  it("el rango de un solo día dura exactamente 24 horas", () => {
    const start = peruCivilDayStart("2026-08-07");
    const end = peruCivilDayEnd("2026-08-07");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("una venta a las 21:00 de Lima cae en el día correcto", () => {
    // 21:00 en Lima del 7 de agosto = 02:00 UTC del 8. Con el bug antiguo, esta
    // venta se contaba en el día equivocado.
    const venta = new Date("2026-08-08T02:00:00.000Z");
    expect(peruCivilDate(venta)).toBe("2026-08-07");
    expect(venta >= peruCivilDayStart("2026-08-07")).toBe(true);
    expect(venta < peruCivilDayEnd("2026-08-07")).toBe(true);
  });

  it("una venta a las 00:30 de Lima cae en el día nuevo", () => {
    // 00:30 en Lima del 8 de agosto = 05:30 UTC del 8.
    const venta = new Date("2026-08-08T05:30:00.000Z");
    expect(peruCivilDate(venta)).toBe("2026-08-08");
    expect(venta >= peruCivilDayEnd("2026-08-07")).toBe(true);
  });

  it("peruStartOfDay sigue funcionando con un INSTANTE (no con una fecha civil)", () => {
    const instante = new Date("2026-08-07T18:00:00.000Z"); // 13:00 en Lima
    expect(peruStartOfDay(instante).toISOString()).toBe("2026-08-07T05:00:00.000Z");
  });
});
