/**
 * Las cuentas abiertas del local, en una sola lista.
 *
 * El punto de venta trataba igual una mesa que un mostrador, y sobre todo solo
 * sabía de UNA cuenta: la del carrito que tenía delante, en memoria y perdida al
 * recargar. Para saber qué debía la mesa 7 había que irse a otra pantalla.
 *
 * Aquí se componen las dos fuentes que ya existen —las visitas de mesa con su
 * saldo agregado, y los pedidos de mostrador y reparto, que no tienen visita— y
 * se ordenan por lo único que importa en el pase: qué está esperando algo de ti.
 *
 * Todo el dinero en CÉNTIMOS enteros.
 */

export type TipoCuenta = "mesa" | "llevar" | "delivery";

export interface CuentaAbierta {
  /** Clave estable para React y para la selección. */
  clave: string;
  tipo: TipoCuenta;
  /** "Mesa 12", "Llevar #48", "Delivery #22". */
  nombre: string;
  /** Quién la abrió o para quién es. Puede faltar. */
  cliente: string | null;
  /** Minutos desde que se abrió. */
  minutos: number;
  /** Saldo por cobrar, en céntimos. */
  saldo: number;
  /**
   * Ya cobrado y no anulado, en céntimos.
   *
   * Hace falta para ampliar una cuenta que recibió un adelanto: el pendiente
   * después de añadir platos es el total NUEVO menos esto, y no el total nuevo a
   * secas —que le pediría al cliente dinero que ya entregó.
   */
  pagado: number;
  /** Comensales sentados. Nulo = nadie lo declaró; NO es cero. */
  comensales: number | null;
  /** Id de la visita de mesa, si la tiene. */
  sessionId: string | null;
  /** Id de la mesa, si la tiene. */
  tableId: string | null;
  /** Órdenes de esta cuenta que la cocina tiene en cola o está preparando. */
  enCocina: number;
  /** Órdenes terminadas que esperan en el pase a que alguien las lleve. */
  listos: number;
  /** La cuenta ya se pidió: alguien está esperando para pagar. */
  cuentaPedida: boolean;
  /** Ids de las órdenes vivas, la más reciente primero. */
  orderIds: string[];
}

export type GrupoCuenta = "cobro" | "entregar" | "tranquilas";

export interface SeccionCuentas {
  clave: GrupoCuenta;
  titulo: string;
  nota: string;
  cuentas: CuentaAbierta[];
}

const TITULOS: Record<GrupoCuenta, { titulo: string; nota: string }> = {
  cobro: { titulo: "Esperan cobro", nota: "la cuenta ya se pidió" },
  entregar: { titulo: "Listo para entregar", nota: "la comida espera en el pase" },
  tranquilas: {
    titulo: "Nada pendiente",
    nota: "cocina cocinando o mesa consumiendo · no necesitan nada tuyo",
  },
};

/**
 * Estados que están en manos de la cocina.
 *
 * `pending` incluido a propósito: en este sistema una comanda entra en la cola
 * de la cocina en cuanto se crea —la pantalla del pase la muestra junto a las
 * `confirmed`—, así que llamarla "sin mandar" sería mentira, y una mentira que
 * empuja al cajero a mandar dos veces el mismo plato.
 */
const EN_COCINA = new Set(["pending", "confirmed", "preparing"]);
/** Terminado y esperando en el pase a que alguien lo lleve. */
const LISTO = new Set(["ready"]);

export interface OrdenViva {
  id: string;
  status: string;
  type?: string;
  table_session_id?: string | null;
  customer_name?: string | null;
  order_number?: string | null;
  total?: number;
  total_paid?: number;
  created_at: string;
  delivery_address?: string | null;
}

export interface MesaConVisita {
  id: string;
  number: number;
  active_session?: {
    session_id: string;
    /**
     * `pending` = el comensal escaneó el QR y espera que el mozo lo acepte.
     * Todavía no ha pedido nada: no es una cuenta, es una solicitud, y se
     * atiende desde el plano del salón.
     */
    status?: "active" | "pending";
    customer_name?: string | null;
    guest_count?: number | null;
    elapsed_minutes?: number | null;
    remaining?: number | null;
    /** Ya cobrado de la visita, en céntimos. */
    paid?: number | null;
  } | null;
}

function minutosDesde(iso: string, ahora: number): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora - t) / 60000));
}

/** Saldo de una orden suelta. Nunca negativo. */
export function saldoDeOrden(orden: OrdenViva): number {
  return Math.max(0, (orden.total ?? 0) - (orden.total_paid ?? 0));
}

/**
 * Compone la lista de cuentas abiertas.
 *
 * Las mesas salen de su agregado —que ya suma TODAS las órdenes de la visita y
 * resta lo cobrado sin anular—, y los pedidos sin mesa de la lista de órdenes
 * vivas. Mezclar los dos saldos sería contar dos veces: por eso las órdenes con
 * `table_session_id` se descartan aquí, ya vienen dentro del saldo de su mesa.
 *
 * @param mesasConCuentaPedida ids de mesa con un aviso de "la cuenta, por favor"
 *        abierto. Es lo que separa "esperan cobro" de "siguen comiendo".
 */
export function componerCuentas({
  mesas,
  ordenes,
  mesasConCuentaPedida = new Set<string>(),
  ahora = Date.now(),
}: {
  mesas: MesaConVisita[];
  ordenes: OrdenViva[];
  mesasConCuentaPedida?: Set<string>;
  ahora?: number;
}): CuentaAbierta[] {
  const cuentas: CuentaAbierta[] = [];

  const porSesion = new Map<string, OrdenViva[]>();
  const sueltas: OrdenViva[] = [];
  for (const o of ordenes) {
    if (o.table_session_id) {
      porSesion.set(o.table_session_id, [...(porSesion.get(o.table_session_id) ?? []), o]);
    } else {
      sueltas.push(o);
    }
  }

  for (const mesa of mesas) {
    const visita = mesa.active_session;
    if (!visita) continue;
    // Una visita pendiente de aceptar no ha pedido nada todavía.
    if (visita.status === "pending") continue;

    const suyas = porSesion.get(visita.session_id) ?? [];
    cuentas.push({
      clave: `mesa:${visita.session_id}`,
      tipo: "mesa",
      nombre: `Mesa ${mesa.number}`,
      cliente: visita.customer_name || null,
      minutos: visita.elapsed_minutes ?? 0,
      saldo: visita.remaining ?? 0,
      pagado: visita.paid ?? 0,
      comensales: visita.guest_count ?? null,
      sessionId: visita.session_id,
      tableId: mesa.id,
      enCocina: suyas.filter((o) => EN_COCINA.has(o.status)).length,
      listos: suyas.filter((o) => LISTO.has(o.status)).length,
      cuentaPedida: mesasConCuentaPedida.has(mesa.id),
      orderIds: suyas.map((o) => o.id),
    });
  }

  for (const o of sueltas) {
    const esDelivery = o.type === "delivery";
    cuentas.push({
      clave: `orden:${o.id}`,
      tipo: esDelivery ? "delivery" : "llevar",
      nombre: `${esDelivery ? "Delivery" : "Llevar"} ${o.order_number ?? ""}`.trim(),
      cliente: o.customer_name || null,
      minutos: minutosDesde(o.created_at, ahora),
      saldo: saldoDeOrden(o),
      pagado: o.total_paid ?? 0,
      comensales: null,
      sessionId: null,
      tableId: null,
      enCocina: EN_COCINA.has(o.status) ? 1 : 0,
      listos: LISTO.has(o.status) ? 1 : 0,
      // Un pedido de mostrador servido y sin pagar es exactamente alguien
      // esperando en la barra a que le cobren.
      cuentaPedida: o.status === "served" && saldoDeOrden(o) > 0,
      orderIds: [o.id],
    });
  }

  return cuentas;
}

/**
 * En qué grupo cae una cuenta.
 *
 * El orden de las preguntas ES la prioridad, y la pregunta que ordena todo es
 * "¿esto espera algo de una persona, o de la cocina?". Primero cobrar, porque
 * hay alguien de pie con la tarjeta en la mano; después entregar, porque hay
 * comida terminada enfriándose en el pase; y el resto lo tiene la cocina, que no
 * necesita nada del mostrador.
 *
 * Una cuenta con comida en el pase Y la cuenta pedida va a cobro: el que espera
 * de pie lleva más rato esperando que el plato.
 */
export function grupoDe(cuenta: CuentaAbierta): GrupoCuenta {
  if (cuenta.cuentaPedida && cuenta.saldo > 0) return "cobro";
  if (cuenta.listos > 0) return "entregar";
  return "tranquilas";
}

/** Frase que explica el estado de la cuenta sin obligar a abrirla. */
export function estadoDe(cuenta: CuentaAbierta): string {
  if (cuenta.cuentaPedida && cuenta.saldo > 0) {
    return cuenta.tipo === "mesa" ? "Cuenta pedida" : "Listo en barra, sin cobrar";
  }
  if (cuenta.listos > 0) {
    return `${cuenta.listos} ${cuenta.listos === 1 ? "pedido listo en el pase" : "pedidos listos en el pase"}`;
  }
  if (cuenta.enCocina > 0) {
    return `${cuenta.enCocina} ${cuenta.enCocina === 1 ? "pedido en cocina" : "pedidos en cocina"}`;
  }
  if (cuenta.comensales) {
    return `${cuenta.comensales} comensales · consumo abierto`;
  }
  return "Abierta";
}

/**
 * Agrupa y ordena. Dentro de cada grupo, lo que lleva más tiempo esperando va
 * primero: es lo que se olvida.
 *
 * Las secciones vacías no se devuelven — una cabecera "Esperan cobro" sobre cero
 * filas es la peor forma posible de decir que todo va bien.
 */
export function agruparCuentas(cuentas: CuentaAbierta[]): SeccionCuentas[] {
  const orden: GrupoCuenta[] = ["cobro", "entregar", "tranquilas"];
  const cubos: Record<GrupoCuenta, CuentaAbierta[]> = {
    cobro: [],
    entregar: [],
    tranquilas: [],
  };

  for (const c of cuentas) cubos[grupoDe(c)].push(c);

  return orden
    .map((clave) => ({
      clave,
      titulo: TITULOS[clave].titulo,
      nota: TITULOS[clave].nota,
      cuentas: cubos[clave].sort((a, b) => b.minutos - a.minutos),
    }))
    .filter((s) => s.cuentas.length > 0);
}

// ---------------------------------------------------------------------------
// La acción principal se invierte con el tipo de cuenta
// ---------------------------------------------------------------------------

export interface AccionPrincipal {
  clave: "enviar" | "cobrar";
  etiqueta: string;
  /** Debajo del botón, lo que va a pasar de verdad. */
  detalle?: string;
}

/**
 * Qué hace el botón grande.
 *
 * Es la tesis del rediseño: en salón se manda a cocina y se cobra al final; en
 * mostrador se cobra y ya está, porque el cliente está delante esperando su
 * bolsa. Tratar los dos igual obliga a uno de los dos a dar un rodeo cada vez,
 * y el rodeo se da cincuenta veces por servicio.
 */
export function accionPrincipal({
  tipo,
  platosPorEnviar,
  totalCentimos,
  formatearImporte,
}: {
  tipo: TipoCuenta;
  platosPorEnviar: number;
  totalCentimos: number;
  formatearImporte: (centimos: number) => string;
}): AccionPrincipal | null {
  if (platosPorEnviar === 0 && totalCentimos === 0) return null;

  if (tipo === "mesa") {
    if (platosPorEnviar === 0) {
      return { clave: "cobrar", etiqueta: `Cobrar ${formatearImporte(totalCentimos)}` };
    }
    return {
      clave: "enviar",
      etiqueta: `Enviar ${platosPorEnviar} ${platosPorEnviar === 1 ? "plato" : "platos"} a cocina`,
    };
  }

  // Mostrador y reparto: se cobra, y la comanda va incluida en el cobro. Un
  // botón, no dos.
  return {
    clave: "cobrar",
    etiqueta: `Cobrar ${formatearImporte(totalCentimos)}`,
    detalle:
      platosPorEnviar > 0 ? "manda la comanda y cierra la cuenta" : "cierra la cuenta",
  };
}
