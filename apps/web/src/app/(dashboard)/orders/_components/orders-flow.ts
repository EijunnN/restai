/**
 * El estado de una orden deja de ser una etiqueta y pasa a ser una posición.
 *
 * La pantalla anterior pintaba el estado como una insignia de color y llamaba al
 * botón de avanzar por el ESTADO SIGUIENTE ("Listo"), así que nadie sabía si eso
 * era lo que la orden *es* o lo que *va a ser*. Aquí el ciclo se ve como un riel
 * con seis tramos, el botón se llama por la ACCIÓN ("Marcar lista") y el color
 * queda reservado para lo que exige atención.
 *
 * Todo lo que decide qué es urgente vive aquí y no en los componentes: es lo que
 * se equivoca, y es lo único que se puede probar sin montar la pantalla.
 */

export const ETAPAS = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "completed",
] as const;

export type Etapa = (typeof ETAPAS)[number];
export type EstadoOrden = Etapa | "cancelled";

export const ETIQUETA_ESTADO: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  preparing: "En cocina",
  ready: "Lista",
  served: "Servida",
  completed: "Cobrada",
  cancelled: "Anulada",
};

/**
 * El botón se llama por lo que HACE, no por el estado al que lleva.
 *
 * `cobro: true` significa que ese paso no es un cambio de estado sin más: cerrar
 * una orden servida mueve dinero, así que abre el cobro en vez de marcarla
 * completada a secas. Marcar "completada" sin registrar el pago deja una venta
 * cerrada que no cuadra con la caja.
 */
export interface AccionAvance {
  destino: Etapa;
  etiqueta: string;
  cobro?: boolean;
}

export const ACCION_AVANCE: Partial<Record<EstadoOrden, AccionAvance>> = {
  pending: { destino: "confirmed", etiqueta: "Confirmar" },
  confirmed: { destino: "preparing", etiqueta: "Mandar a cocina" },
  preparing: { destino: "ready", etiqueta: "Marcar lista" },
  ready: { destino: "served", etiqueta: "Marcar servida" },
  served: { destino: "completed", etiqueta: "Cobrar", cobro: true },
};

/**
 * Retroceso de un paso. Réplica EXACTA de lo que admite el servidor
 * (`ORDER_STATUS_TRANSITIONS` en packages/config): ofrecer un movimiento que la
 * API va a rechazar es peor que no ofrecerlo.
 */
export const ACCION_RETROCESO: Partial<Record<EstadoOrden, Etapa>> = {
  confirmed: "pending",
  preparing: "pending",
  ready: "preparing",
  served: "ready",
};

export function indiceEtapa(estado: string): number {
  const i = (ETAPAS as readonly string[]).indexOf(estado);
  return i;
}

/** ¿La orden sigue viva en el servicio? `completed` y `cancelled` ya no. */
export function estaEnCurso(estado: string): boolean {
  return estado !== "completed" && estado !== "cancelled";
}

// ---------------------------------------------------------------------------
// Urgencia
// ---------------------------------------------------------------------------

/**
 * Minutos que una orden LISTA puede esperar antes de que sea un problema.
 *
 * No es un número redondo por gusto: un plato que sale de cocina y no llega a la
 * mesa se enfría, y a los cinco minutos ya no es el plato que se cocinó. Es el
 * fallo más caro de un servicio y el que ninguna pantalla enseñaba.
 */
export const MINUTOS_LISTA_SIN_SERVIR = 5;

/**
 * Minutos que una orden SERVIDA puede quedarse sin cobrar antes de avisar.
 *
 * Más holgado a propósito: el comensal está comiendo. Lo que se vigila es la
 * mesa que ya terminó y nadie ha cerrado, que es dinero parado y una mesa que no
 * rota.
 */
export const MINUTOS_SERVIDA_SIN_COBRAR = 20;

/** Si nadie declaró tiempos de preparación, esto es lo que se supone. */
export const MINUTOS_PREPARACION_POR_DEFECTO = 15;

export interface OrdenParaUrgencia {
  status: string;
  /** ISO. Cuándo entró la orden. */
  created_at: string;
  /** ISO. Desde cuándo lleva en el estado actual (migración 0019). */
  status_changed_at?: string | null;
  /** Minutos previstos de preparación, calculados por el servidor. */
  prep_minutes?: number | null;
  payment_status?: string;
}

export type Grupo = "atencion" | "marcha" | "nuevas";

export interface Urgencia {
  grupo: Grupo;
  /** Minutos desde que entró la orden. */
  minutosTotales: number;
  /** Minutos en el estado actual. */
  minutosEnEstado: number;
  /** Frase corta bajo el reloj: "previsto 18", "lista sin servir"… */
  pista: string;
  /** Pinta el reloj en ámbar. Reservado para lo que de verdad exige actuar. */
  urgente: boolean;
}

function minutosDesde(iso: string | null | undefined, ahora: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora - t) / 60000));
}

/**
 * En qué grupo cae una orden y por qué.
 *
 * Las tres reglas de urgencia son, por orden de gravedad:
 *
 * 1. **Lista sin servir**: cocina terminó y el plato sigue en el pase.
 * 2. **Servida sin cobrar**: la mesa terminó y nadie ha cerrado la cuenta.
 * 3. **Atrasada**: lleva más de lo previsto y aún no ha salido de cocina.
 *
 * Lo que NO es urgente aunque lo parezca: una orden recién entrada, por muy
 * pendiente que esté. Marcarla en ámbar a los treinta segundos convierte el
 * color en ruido, y el color que siempre está encendido no avisa de nada.
 */
export function urgenciaDe(orden: OrdenParaUrgencia, ahora: number = Date.now()): Urgencia {
  const minutosTotales = minutosDesde(orden.created_at, ahora);
  const minutosEnEstado = minutosDesde(orden.status_changed_at ?? orden.created_at, ahora);
  const previsto = orden.prep_minutes ?? MINUTOS_PREPARACION_POR_DEFECTO;

  if (orden.status === "ready") {
    const tarde = minutosEnEstado >= MINUTOS_LISTA_SIN_SERVIR;
    return {
      grupo: tarde ? "atencion" : "marcha",
      minutosTotales,
      minutosEnEstado,
      pista: "lista sin servir",
      urgente: tarde,
    };
  }

  if (orden.status === "served") {
    const cobrada = orden.payment_status === "paid";
    const tarde = !cobrada && minutosEnEstado >= MINUTOS_SERVIDA_SIN_COBRAR;
    return {
      grupo: tarde ? "atencion" : "marcha",
      minutosTotales,
      minutosEnEstado,
      pista: cobrada ? "servida y pagada" : "servida",
      urgente: tarde,
    };
  }

  if (orden.status === "preparing" || orden.status === "confirmed") {
    const tarde = minutosTotales > previsto;
    return {
      grupo: tarde ? "atencion" : "marcha",
      minutosTotales,
      minutosEnEstado,
      pista: `previsto ${previsto}`,
      urgente: tarde,
    };
  }

  // Pendiente: nadie la ha confirmado todavía. Es nueva mientras sea nueva; si
  // lleva parada más de lo previsto, ya no lo es y sube a atención.
  const tarde = minutosTotales > previsto;
  return {
    grupo: tarde ? "atencion" : "nuevas",
    minutosTotales,
    minutosEnEstado,
    pista: tarde ? "sin confirmar" : "recién entrada",
    urgente: tarde,
  };
}

/** "26 min", "1 h 04". Los segundos solo en el primer minuto. */
export function formatearEspera(minutos: number): string {
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${horas} h ${String(resto).padStart(2, "0")}`;
}

export interface Seccion<T> {
  clave: Grupo;
  titulo: string;
  /** Se pinta en ámbar solo el grupo que pide actuar. */
  destacada: boolean;
  ordenes: T[];
}

const TITULOS: Record<Grupo, string> = {
  atencion: "Necesitan acción",
  marcha: "En marcha",
  nuevas: "Recién entradas",
};

/**
 * Agrupa por urgencia y ordena DENTRO de cada grupo por lo más parado primero.
 *
 * El orden por hora de entrada, que es el que traía la pantalla, entierra la
 * orden urgente entre las nuevas: lo que lleva más tiempo esperando es
 * exactamente lo que hay que mirar antes.
 *
 * Las secciones vacías no se devuelven: una cabecera "Necesitan acción" sobre
 * cero filas es la peor forma de decir que todo va bien.
 */
export function agruparPorUrgencia<T extends OrdenParaUrgencia>(
  ordenes: T[],
  ahora: number = Date.now(),
): Seccion<T>[] {
  const grupos: Record<Grupo, { orden: T; u: Urgencia }[]> = {
    atencion: [],
    marcha: [],
    nuevas: [],
  };

  for (const orden of ordenes) {
    const u = urgenciaDe(orden, ahora);
    grupos[u.grupo].push({ orden, u });
  }

  const claves: Grupo[] = ["atencion", "marcha", "nuevas"];

  return claves
    .map((clave) => ({
      clave,
      titulo: TITULOS[clave],
      destacada: clave === "atencion",
      ordenes: grupos[clave]
        .sort((a, b) => b.u.minutosEnEstado - a.u.minutosEnEstado)
        .map((x) => x.orden),
    }))
    .filter((s) => s.ordenes.length > 0);
}

// ---------------------------------------------------------------------------
// Filtros rápidos
// ---------------------------------------------------------------------------

export type ClaveFiltro =
  | "todas"
  | "atrasadas"
  | "listas-sin-servir"
  | "servidas-sin-cobrar"
  | "delivery";

export interface DefinicionFiltro {
  clave: ClaveFiltro;
  label: string;
  punto?: string;
}

export const FILTROS: readonly DefinicionFiltro[] = [
  { clave: "todas", label: "Todas" },
  { clave: "atrasadas", label: "Atrasadas", punto: "ambar" },
  { clave: "listas-sin-servir", label: "Listas sin servir", punto: "verde" },
  { clave: "servidas-sin-cobrar", label: "Servidas sin cobrar", punto: "violeta" },
  { clave: "delivery", label: "Delivery en ruta", punto: "azul" },
];

export function cumpleFiltro(
  orden: OrdenParaUrgencia & { type?: string },
  clave: ClaveFiltro,
  ahora: number = Date.now(),
): boolean {
  switch (clave) {
    case "todas":
      return true;
    case "atrasadas":
      return urgenciaDe(orden, ahora).urgente;
    case "listas-sin-servir":
      return orden.status === "ready";
    case "servidas-sin-cobrar":
      return orden.status === "served" && orden.payment_status !== "paid";
    case "delivery":
      return orden.type === "delivery";
  }
}

export function contarFiltros(
  ordenes: (OrdenParaUrgencia & { type?: string })[],
  ahora: number = Date.now(),
): Record<ClaveFiltro, number> {
  const conteo = {
    todas: 0,
    atrasadas: 0,
    "listas-sin-servir": 0,
    "servidas-sin-cobrar": 0,
    delivery: 0,
  } as Record<ClaveFiltro, number>;

  for (const o of ordenes) {
    for (const { clave } of FILTROS) {
      if (cumpleFiltro(o, clave, ahora)) conteo[clave] += 1;
    }
  }
  return conteo;
}

/** Saldo pendiente de una orden, en céntimos. Nunca negativo. */
export function saldoPendiente(orden: { total?: number; total_paid?: number }): number {
  return Math.max(0, (orden.total ?? 0) - (orden.total_paid ?? 0));
}
