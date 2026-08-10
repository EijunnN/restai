import { describe, expect, test } from "bun:test";
import {
  accionPrincipal,
  agruparCuentas,
  componerCuentas,
  estadoDe,
  grupoDe,
  saldoDeOrden,
  type CuentaAbierta,
} from "./pos-accounts";

/**
 * Las cuentas abiertas del local.
 *
 * Si esto se equivoca, o se cobra dos veces el mismo dinero —una mesa cuenta su
 * saldo y además el de cada una de sus órdenes— o una mesa que lleva veinte
 * minutos pidiendo la cuenta queda enterrada al final de la lista.
 */

const AHORA = new Date("2026-08-09T21:00:00Z").getTime();
const haceMinutos = (m: number) => new Date(AHORA - m * 60000).toISOString();

const soles = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

function mesa(numero: number, visita: Record<string, unknown> | null) {
  return {
    id: `t${numero}`,
    number: numero,
    active_session: visita as any,
  };
}

function cuenta(sobre: Partial<CuentaAbierta> = {}): CuentaAbierta {
  return {
    clave: "x",
    tipo: "mesa",
    nombre: "Mesa 1",
    cliente: null,
    minutos: 10,
    saldo: 5000,
    pagado: 0,
    comensales: null,
    sessionId: "s1",
    tableId: "t1",
    enCocina: 0,
    listos: 0,
    cuentaPedida: false,
    orderIds: [],
    ...sobre,
  };
}

describe("componer las cuentas", () => {
  test("una mesa con visita entra con el saldo YA agregado de la visita", () => {
    const cuentas = componerCuentas({
      mesas: [
        mesa(12, {
          session_id: "s12",
          customer_name: "Sofía R.",
          guest_count: 4,
          elapsed_minutes: 78,
          remaining: 22656,
        }),
      ],
      ordenes: [],
      ahora: AHORA,
    });

    expect(cuentas).toHaveLength(1);
    expect(cuentas[0]!.nombre).toBe("Mesa 12");
    expect(cuentas[0]!.saldo).toBe(22656);
    expect(cuentas[0]!.minutos).toBe(78);
    expect(cuentas[0]!.comensales).toBe(4);
  });

  test("las órdenes de una mesa NO suman su saldo aparte", () => {
    // Es el error que duplicaría el dinero del salón: el agregado de la visita
    // ya suma todas sus órdenes y resta lo cobrado sin anular.
    const cuentas = componerCuentas({
      mesas: [mesa(12, { session_id: "s12", elapsed_minutes: 30, remaining: 10000 })],
      ordenes: [
        {
          id: "o1",
          status: "preparing",
          table_session_id: "s12",
          total: 10000,
          total_paid: 0,
          created_at: haceMinutos(30),
        },
      ],
      ahora: AHORA,
    });

    expect(cuentas).toHaveLength(1);
    expect(cuentas[0]!.saldo).toBe(10000);
  });

  test("una mesa sin visita no es una cuenta abierta", () => {
    const cuentas = componerCuentas({ mesas: [mesa(3, null)], ordenes: [], ahora: AHORA });
    expect(cuentas).toEqual([]);
  });

  test("una visita pendiente de aceptar tampoco", () => {
    // El comensal escaneó y espera que el mozo lo acepte: no ha pedido nada, y
    // el cajero no puede hacer nada con eso desde el punto de venta.
    const cuentas = componerCuentas({
      mesas: [mesa(4, { session_id: "s4", status: "pending", elapsed_minutes: 1, remaining: 0 })],
      ordenes: [],
      ahora: AHORA,
    });
    expect(cuentas).toEqual([]);
  });

  test("un pedido de mostrador es su propia cuenta", () => {
    const cuentas = componerCuentas({
      mesas: [],
      ordenes: [
        {
          id: "o9",
          status: "pending",
          type: "takeout",
          order_number: "#48",
          customer_name: "Julio",
          total: 5664,
          total_paid: 0,
          created_at: haceMinutos(4),
        },
      ],
      ahora: AHORA,
    });

    expect(cuentas[0]!.tipo).toBe("llevar");
    expect(cuentas[0]!.nombre).toBe("Llevar #48");
    expect(cuentas[0]!.minutos).toBe(4);
    expect(cuentas[0]!.saldo).toBe(5664);
  });

  test("un reparto se distingue de un para llevar", () => {
    const cuentas = componerCuentas({
      mesas: [],
      ordenes: [
        {
          id: "o1",
          status: "preparing",
          type: "delivery",
          order_number: "#22",
          total: 6200,
          created_at: haceMinutos(2),
        },
      ],
      ahora: AHORA,
    });
    expect(cuentas[0]!.tipo).toBe("delivery");
    expect(cuentas[0]!.enCocina).toBe(1);
  });

  test("separa lo que tiene la cocina de lo que espera en el pase", () => {
    const cuentas = componerCuentas({
      mesas: [mesa(7, { session_id: "s7", elapsed_minutes: 34, remaining: 31240 })],
      ordenes: [
        { id: "a", status: "pending", table_session_id: "s7", created_at: haceMinutos(5) },
        { id: "b", status: "confirmed", table_session_id: "s7", created_at: haceMinutos(4) },
        { id: "c", status: "preparing", table_session_id: "s7", created_at: haceMinutos(20) },
        { id: "d", status: "ready", table_session_id: "s7", created_at: haceMinutos(25) },
        { id: "e", status: "served", table_session_id: "s7", created_at: haceMinutos(30) },
      ],
      ahora: AHORA,
    });

    // `pending` cuenta como cocina: en este sistema la comanda entra en la cola
    // del pase en cuanto se crea, así que "sin mandar" no existe como estado.
    expect(cuentas[0]!.enCocina).toBe(3);
    expect(cuentas[0]!.listos).toBe(1);
    expect(cuentas[0]!.orderIds).toHaveLength(5);
  });

  test("cero comensales declarados es NULO, no cero", () => {
    // El comensal que entra por QR nunca lo declara: el nulo es el caso normal
    // y tratarlo como cero hace parecer el local más vacío de lo que está.
    const cuentas = componerCuentas({
      mesas: [mesa(1, { session_id: "s1", guest_count: null, elapsed_minutes: 5, remaining: 0 })],
      ordenes: [],
      ahora: AHORA,
    });
    expect(cuentas[0]!.comensales).toBeNull();
  });
});

describe("lo ya cobrado viaja con la cuenta", () => {
  test("una cuenta de mostrador con adelanto recuerda cuánto entregó el cliente", () => {
    // Sin esto, ampliar la cuenta y cobrarla le pediría al cliente el total
    // nuevo entero, incluyendo los 20 soles que ya había dejado.
    const cuentas = componerCuentas({
      mesas: [],
      ordenes: [
        {
          id: "o1",
          status: "preparing",
          type: "takeout",
          order_number: "#7",
          total: 5000,
          total_paid: 2000,
          created_at: haceMinutos(3),
        },
      ],
      ahora: AHORA,
    });
    expect(cuentas[0]!.saldo).toBe(3000);
    expect(cuentas[0]!.pagado).toBe(2000);
  });

  test("la mesa toma lo cobrado del agregado de su visita", () => {
    const cuentas = componerCuentas({
      mesas: [mesa(5, { session_id: "s5", elapsed_minutes: 12, remaining: 4000, paid: 1500 })],
      ordenes: [],
      ahora: AHORA,
    });
    expect(cuentas[0]!.pagado).toBe(1500);
  });
});

describe("saldo de una orden suelta", () => {
  test("es lo facturado menos lo cobrado", () => {
    expect(saldoDeOrden({ id: "x", status: "served", created_at: haceMinutos(1), total: 10000, total_paid: 4000 })).toBe(6000);
  });

  test("nunca es negativo aunque se haya cobrado de más", () => {
    expect(saldoDeOrden({ id: "x", status: "served", created_at: haceMinutos(1), total: 10000, total_paid: 12000 })).toBe(0);
  });
});

describe("grupos", () => {
  test("la cuenta pedida con saldo manda sobre todo lo demás", () => {
    // El que espera de pie con la tarjeta en la mano lleva más rato esperando
    // que el plato que está en el pase.
    expect(grupoDe(cuenta({ cuentaPedida: true, saldo: 100, listos: 2 }))).toBe("cobro");
  });

  test("la cuenta pedida SIN saldo ya no espera nada", () => {
    expect(grupoDe(cuenta({ cuentaPedida: true, saldo: 0 }))).toBe("tranquilas");
  });

  test("con comida terminada en el pase, hay que llevarla", () => {
    expect(grupoDe(cuenta({ listos: 1 }))).toBe("entregar");
  });

  test("lo que tiene la cocina no necesita nada del mostrador", () => {
    // Que la cocina esté cocinando no es una tarea de nadie más: meterlo en un
    // grupo de acción llenaría la lista de filas que no se pueden atender.
    expect(grupoDe(cuenta({ enCocina: 3 }))).toBe("tranquilas");
    expect(grupoDe(cuenta({}))).toBe("tranquilas");
  });

  test("dentro del grupo manda lo que lleva más tiempo esperando", () => {
    const secciones = agruparCuentas([
      cuenta({ clave: "a", minutos: 5, listos: 1 }),
      cuenta({ clave: "b", minutos: 40, listos: 1 }),
      cuenta({ clave: "c", minutos: 20, listos: 1 }),
    ]);
    expect(secciones[0]!.cuentas.map((c) => c.clave)).toEqual(["b", "c", "a"]);
  });

  test("las secciones vacías no se devuelven", () => {
    const secciones = agruparCuentas([cuenta({ enCocina: 1 })]);
    expect(secciones.map((s) => s.clave)).toEqual(["tranquilas"]);
  });

  test("el orden de las secciones es siempre el mismo", () => {
    const secciones = agruparCuentas([
      cuenta({ clave: "t", enCocina: 1 }),
      cuenta({ clave: "c", cuentaPedida: true, saldo: 500 }),
      cuenta({ clave: "e", listos: 1 }),
    ]);
    expect(secciones.map((s) => s.clave)).toEqual(["cobro", "entregar", "tranquilas"]);
  });
});

describe("estado legible", () => {
  test("dice lo que hay que hacer sin abrir la cuenta", () => {
    expect(estadoDe(cuenta({ cuentaPedida: true, saldo: 100 }))).toBe("Cuenta pedida");
    expect(estadoDe(cuenta({ listos: 1 }))).toBe("1 pedido listo en el pase");
    expect(estadoDe(cuenta({ listos: 3 }))).toBe("3 pedidos listos en el pase");
    expect(estadoDe(cuenta({ enCocina: 2 }))).toBe("2 pedidos en cocina");
    expect(estadoDe(cuenta({ comensales: 8 }))).toBe("8 comensales · consumo abierto");
    expect(estadoDe(cuenta({}))).toBe("Abierta");
  });
});

describe("la acción principal se invierte con el tipo", () => {
  const base = { totalCentimos: 22656, formatearImporte: soles };

  test("en salón se manda a cocina: cobrar espera su turno", () => {
    const a = accionPrincipal({ ...base, tipo: "mesa", platosPorEnviar: 2 })!;
    expect(a.clave).toBe("enviar");
    expect(a.etiqueta).toBe("Enviar 2 platos a cocina");
  });

  test("en salón sin nada que mandar, el botón grande pasa a cobrar", () => {
    const a = accionPrincipal({ ...base, tipo: "mesa", platosPorEnviar: 0 })!;
    expect(a.clave).toBe("cobrar");
  });

  test("en mostrador se cobra, y la comanda va incluida", () => {
    // El cliente está delante esperando su bolsa: dos botones son un rodeo que
    // se da cincuenta veces por servicio.
    const a = accionPrincipal({ ...base, tipo: "llevar", platosPorEnviar: 2 })!;
    expect(a.clave).toBe("cobrar");
    expect(a.detalle).toBe("manda la comanda y cierra la cuenta");
  });

  test("el reparto se comporta como el mostrador", () => {
    expect(accionPrincipal({ ...base, tipo: "delivery", platosPorEnviar: 1 })!.clave).toBe("cobrar");
  });

  test("sin nada que mandar ni que cobrar no hay botón", () => {
    expect(
      accionPrincipal({ tipo: "mesa", platosPorEnviar: 0, totalCentimos: 0, formatearImporte: soles }),
    ).toBeNull();
  });

  test("el singular y el plural concuerdan", () => {
    expect(accionPrincipal({ ...base, tipo: "mesa", platosPorEnviar: 1 })!.etiqueta).toBe(
      "Enviar 1 plato a cocina",
    );
  });
});
