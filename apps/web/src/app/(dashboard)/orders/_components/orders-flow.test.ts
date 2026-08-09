import { describe, expect, test } from "bun:test";
import {
  ACCION_AVANCE,
  ACCION_RETROCESO,
  ETAPAS,
  MINUTOS_LISTA_SIN_SERVIR,
  MINUTOS_SERVIDA_SIN_COBRAR,
  agruparPorUrgencia,
  contarFiltros,
  cumpleFiltro,
  estaEnCurso,
  formatearEspera,
  indiceEtapa,
  saldoPendiente,
  urgenciaDe,
} from "./orders-flow";

/**
 * Si esto se equivoca, un plato listo se enfría en el pase sin que nadie lo vea,
 * o el color de urgencia se enciende tanto que deja de significar algo.
 */

const AHORA = new Date("2026-08-09T20:40:00Z").getTime();

function haceMinutos(m: number): string {
  return new Date(AHORA - m * 60000).toISOString();
}

function orden(sobre: Record<string, unknown> = {}) {
  return {
    status: "preparing",
    created_at: haceMinutos(10),
    status_changed_at: haceMinutos(5),
    prep_minutes: 15,
    payment_status: "unpaid",
    ...sobre,
  } as any;
}

describe("el riel de estados", () => {
  test("son seis tramos y `cancelled` no está en ninguno", () => {
    expect(ETAPAS).toHaveLength(6);
    expect(indiceEtapa("preparing")).toBe(2);
    expect(indiceEtapa("cancelled")).toBe(-1);
  });

  test("solo `completed` y `cancelled` salen del servicio", () => {
    expect(estaEnCurso("ready")).toBe(true);
    expect(estaEnCurso("completed")).toBe(false);
    expect(estaEnCurso("cancelled")).toBe(false);
  });

  test("el botón se llama por la ACCIÓN, nunca por el estado destino", () => {
    // Es el fallo que el rediseño viene a arreglar: el botón decía "Listo", que
    // es un adjetivo, y nadie sabía si era lo que la orden ES o lo que VA A SER.
    expect(ACCION_AVANCE.preparing?.etiqueta).toBe("Marcar lista");
    expect(ACCION_AVANCE.pending?.etiqueta).toBe("Confirmar");
    expect(ACCION_AVANCE.ready?.etiqueta).toBe("Marcar servida");
  });

  test("cerrar una orden servida es COBRAR, no un cambio de estado más", () => {
    // Marcarla completada sin registrar el pago deja una venta cerrada que no
    // cuadra con la caja.
    expect(ACCION_AVANCE.served?.cobro).toBe(true);
    expect(ACCION_AVANCE.preparing?.cobro).toBeUndefined();
  });

  test("no hay avance desde los estados terminales", () => {
    expect(ACCION_AVANCE.completed).toBeUndefined();
    expect(ACCION_AVANCE.cancelled).toBeUndefined();
  });

  test("el retroceso ofrece SOLO lo que el servidor admite", () => {
    // Réplica de ORDER_STATUS_TRANSITIONS. Ofrecer un movimiento que la API va
    // a rechazar con un 400 es peor que no ofrecerlo.
    expect(ACCION_RETROCESO.ready).toBe("preparing");
    expect(ACCION_RETROCESO.served).toBe("ready");
    expect(ACCION_RETROCESO.pending).toBeUndefined();
    expect(ACCION_RETROCESO.completed).toBeUndefined();
  });
});

describe("urgencia", () => {
  test("una orden lista recién salida NO es urgente", () => {
    const u = urgenciaDe(orden({ status: "ready", status_changed_at: haceMinutos(1) }), AHORA);
    expect(u.urgente).toBe(false);
    expect(u.grupo).toBe("marcha");
  });

  test("una orden lista que lleva parada en el pase SÍ lo es", () => {
    const u = urgenciaDe(
      orden({ status: "ready", status_changed_at: haceMinutos(MINUTOS_LISTA_SIN_SERVIR + 1) }),
      AHORA,
    );
    expect(u.urgente).toBe(true);
    expect(u.grupo).toBe("atencion");
    expect(u.pista).toBe("lista sin servir");
  });

  test("el reloj de una orden lista cuenta desde que se puso lista, no desde que entró", () => {
    // Es la diferencia entre la pantalla vieja y esta: con `created_at` una
    // orden de las 20:14 lleva "26 minutos" tanto si acaba de salir de cocina
    // como si lleva media hora enfriándose.
    const u = urgenciaDe(
      orden({ status: "ready", created_at: haceMinutos(40), status_changed_at: haceMinutos(2) }),
      AHORA,
    );
    expect(u.minutosTotales).toBe(40);
    expect(u.minutosEnEstado).toBe(2);
    expect(u.urgente).toBe(false);
  });

  test("una servida y pagada nunca es urgente, por mucho que lleve", () => {
    const u = urgenciaDe(
      orden({
        status: "served",
        status_changed_at: haceMinutos(MINUTOS_SERVIDA_SIN_COBRAR + 30),
        payment_status: "paid",
      }),
      AHORA,
    );
    expect(u.urgente).toBe(false);
  });

  test("una servida sin cobrar que se pasa de tiempo sube a atención", () => {
    const u = urgenciaDe(
      orden({
        status: "served",
        status_changed_at: haceMinutos(MINUTOS_SERVIDA_SIN_COBRAR + 1),
        payment_status: "unpaid",
      }),
      AHORA,
    );
    expect(u.grupo).toBe("atencion");
  });

  test("en cocina, tarde es haber pasado del tiempo previsto de SUS platos", () => {
    const aTiempo = urgenciaDe(orden({ created_at: haceMinutos(10), prep_minutes: 15 }), AHORA);
    const tarde = urgenciaDe(orden({ created_at: haceMinutos(20), prep_minutes: 15 }), AHORA);
    expect(aTiempo.urgente).toBe(false);
    expect(tarde.urgente).toBe(true);
    expect(tarde.pista).toBe("previsto 15");
  });

  test("sin tiempos declarados se usa un previsto por defecto, no cero", () => {
    // Con cero, TODA orden estaría atrasada desde el primer segundo y el ámbar
    // dejaría de significar nada.
    const u = urgenciaDe(orden({ created_at: haceMinutos(3), prep_minutes: null }), AHORA);
    expect(u.urgente).toBe(false);
  });

  test("una orden recién entrada es nueva, no urgente", () => {
    const u = urgenciaDe(orden({ status: "pending", created_at: haceMinutos(1) }), AHORA);
    expect(u.grupo).toBe("nuevas");
    expect(u.urgente).toBe(false);
    expect(u.pista).toBe("recién entrada");
  });

  test("una pendiente que nadie confirma deja de ser nueva", () => {
    const u = urgenciaDe(
      orden({ status: "pending", created_at: haceMinutos(40), prep_minutes: 15 }),
      AHORA,
    );
    expect(u.grupo).toBe("atencion");
    expect(u.pista).toBe("sin confirmar");
  });

  test("sin status_changed_at cae en created_at y no revienta", () => {
    // Órdenes anteriores a la migración 0019, o cualquier respuesta parcial.
    const u = urgenciaDe(
      { status: "ready", created_at: haceMinutos(9), status_changed_at: null } as any,
      AHORA,
    );
    expect(u.minutosEnEstado).toBe(9);
    expect(u.urgente).toBe(true);
  });

  test("una fecha ilegible cuenta como cero, no como NaN", () => {
    const u = urgenciaDe({ status: "ready", created_at: "no-es-una-fecha" } as any, AHORA);
    expect(u.minutosTotales).toBe(0);
    expect(u.minutosEnEstado).toBe(0);
  });
});

describe("agrupación", () => {
  test("las secciones vacías no se devuelven", () => {
    // Una cabecera "Necesitan acción" sobre cero filas es la peor forma posible
    // de decir que todo va bien.
    const secciones = agruparPorUrgencia([orden({ status: "pending", created_at: haceMinutos(1) })], AHORA);
    expect(secciones.map((s) => s.clave)).toEqual(["nuevas"]);
  });

  test("dentro de cada grupo manda lo más parado, no lo más nuevo", () => {
    const secciones = agruparPorUrgencia(
      [
        orden({ status: "preparing", created_at: haceMinutos(6), status_changed_at: haceMinutos(2) }),
        orden({ status: "preparing", created_at: haceMinutos(8), status_changed_at: haceMinutos(7) }),
        orden({ status: "preparing", created_at: haceMinutos(7), status_changed_at: haceMinutos(4) }),
      ],
      AHORA,
    );
    const marcha = secciones.find((s) => s.clave === "marcha")!;
    expect(marcha.ordenes.map((o: any) => o.status_changed_at)).toEqual([
      haceMinutos(7),
      haceMinutos(4),
      haceMinutos(2),
    ]);
  });

  test("el orden de las secciones es siempre el mismo", () => {
    const secciones = agruparPorUrgencia(
      [
        orden({ status: "pending", created_at: haceMinutos(1) }),
        orden({ status: "ready", status_changed_at: haceMinutos(30) }),
        orden({ status: "preparing", created_at: haceMinutos(2) }),
      ],
      AHORA,
    );
    expect(secciones.map((s) => s.clave)).toEqual(["atencion", "marcha", "nuevas"]);
    expect(secciones[0]!.destacada).toBe(true);
    expect(secciones[1]!.destacada).toBe(false);
  });

  test("sin órdenes no hay secciones", () => {
    expect(agruparPorUrgencia([], AHORA)).toEqual([]);
  });
});

describe("filtros rápidos", () => {
  const lista = [
    orden({ status: "ready", status_changed_at: haceMinutos(30) }),
    orden({ status: "served", payment_status: "partial", status_changed_at: haceMinutos(2) }),
    orden({ status: "preparing", type: "delivery", created_at: haceMinutos(2) }),
    orden({ status: "pending", created_at: haceMinutos(1) }),
  ];

  test("cada filtro atrapa lo suyo", () => {
    expect(lista.filter((o) => cumpleFiltro(o, "listas-sin-servir", AHORA))).toHaveLength(1);
    expect(lista.filter((o) => cumpleFiltro(o, "servidas-sin-cobrar", AHORA))).toHaveLength(1);
    expect(lista.filter((o) => cumpleFiltro(o, "delivery", AHORA))).toHaveLength(1);
    expect(lista.filter((o) => cumpleFiltro(o, "todas", AHORA))).toHaveLength(4);
  });

  test("una servida YA pagada no cuenta como pendiente de cobro", () => {
    const pagada = orden({ status: "served", payment_status: "paid" });
    expect(cumpleFiltro(pagada, "servidas-sin-cobrar", AHORA)).toBe(false);
  });

  test("los recuentos se cruzan: una orden puede caer en varios", () => {
    const conteo = contarFiltros(
      [orden({ status: "ready", type: "delivery", status_changed_at: haceMinutos(30) })],
      AHORA,
    );
    expect(conteo.todas).toBe(1);
    expect(conteo.atrasadas).toBe(1);
    expect(conteo["listas-sin-servir"]).toBe(1);
    expect(conteo.delivery).toBe(1);
    expect(conteo["servidas-sin-cobrar"]).toBe(0);
  });
});

describe("formato y dinero", () => {
  test("los minutos se dicen en minutos y las horas en horas", () => {
    expect(formatearEspera(0)).toBe("ahora");
    expect(formatearEspera(26)).toBe("26 min");
    expect(formatearEspera(64)).toBe("1 h 04");
    expect(formatearEspera(120)).toBe("2 h 00");
  });

  test("el saldo nunca es negativo aunque se haya cobrado de más", () => {
    expect(saldoPendiente({ total: 10500, total_paid: 4000 })).toBe(6500);
    expect(saldoPendiente({ total: 10500, total_paid: 12000 })).toBe(0);
    expect(saldoPendiente({})).toBe(0);
  });
});
