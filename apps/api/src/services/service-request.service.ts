import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";

/**
 * Avisos de mesa persistentes ("llamar al mozo" / "pedir la cuenta").
 *
 * Antes esto era un `realtime.publish` y nada más: si en ese instante nadie
 * tenía la pantalla abierta, el aviso no había existido nunca. Aquí se persiste
 * sobre `service_requests`, con lo que sobrevive a un refresco, a un cambio de
 * turno y a una caída del proceso, y además deja medir el tiempo de respuesta.
 *
 * Tres reglas de diseño gobiernan todo el archivo:
 *
 * 1. El ANTISPAM lo hace la base de datos. El índice único parcial
 *    `uq_service_requests_open_per_table_type` (mesa, tipo) WHERE status='pending'
 *    impide un segundo aviso pendiente. Por eso se INSERTA y se captura el 23505
 *    en vez de hacer SELECT-y-luego-INSERT, que es una carrera abierta cuando el
 *    comensal pulsa el botón dos veces seguidas.
 *
 * 2. Toda transición de estado es un compare-and-swap atómico
 *    (`UPDATE ... WHERE status IN (<estados legales>) RETURNING`). Dos mozos
 *    pueden pulsar "voy" a la vez desde dos tablets: solo uno gana y el otro
 *    recibe un 409 en vez de pisar el sello del primero.
 *
 * 3. TODA consulta —incluidos los JOIN de adorno— va acotada por
 *    `organization_id` y, cuando aplica, por `branch_id`. Un JOIN sin acotar
 *    filtra el número de mesa o el nombre del comensal de otro local si algún
 *    día una fila queda apuntando fuera de su sede.
 */

// ── Tipos y códigos de error ────────────────────────────────────────

export type ServiceRequestType = "call_waiter" | "request_bill";
export type ServiceRequestStatus =
  | "pending"
  | "acknowledged"
  | "resolved"
  | "cancelled";

/** Ámbito multi-tenant obligatorio en toda consulta. */
export interface TenantScope {
  organizationId: string;
  branchId: string;
}

export type ServiceRequestRow = typeof schema.serviceRequests.$inferSelect;

/**
 * Fila tal como la ve el llamador: con el NÚMERO de mesa ya resuelto, el nombre
 * del comensal, quién lo atendió y los tiempos en segundos. El tipo se deriva de
 * la propia consulta para que no pueda desincronizarse del SELECT.
 */
export type ServiceRequestDetail = Awaited<
  ReturnType<typeof listServiceRequests>
>[number];

/** Alias histórico: la fila siempre trae `table_number`. */
export type ServiceRequestWithTable = ServiceRequestDetail;

/** El aviso no existe (o no pertenece a esta sede). */
export const SERVICE_REQUEST_NOT_FOUND = "SERVICE_REQUEST_NOT_FOUND";
/** El aviso existe pero ya no está en el estado que la transición exigía. */
export const SERVICE_REQUEST_ALREADY_HANDLED = "SERVICE_REQUEST_ALREADY_HANDLED";
/** La mesa no existe en esta organización/sede. */
export const TABLE_NOT_FOUND = "TABLE_NOT_FOUND";
/** La sesión indicada no pertenece a esa mesa/sede. */
export const SESSION_TABLE_MISMATCH = "SESSION_TABLE_MISMATCH";

/** Estados "vivos": lo que el mozo tiene que ver en su bandeja. */
export const OPEN_STATUSES: ServiceRequestStatus[] = ["pending", "acknowledged"];

/** Longitud máxima de la nota del comensal; el resto se recorta. */
const NOTE_MAX_LENGTH = 280;

/** Reintentos del insert cuando el pendiente que provocó el 23505 desaparece. */
const CREATE_MAX_ATTEMPTS = 3;

/** Tope de filas por defecto de la bandeja. */
const DEFAULT_LIMIT = 200;

// ── Utilidades internas ─────────────────────────────────────────────

/**
 * ¿Es una violación del índice único de "un solo pendiente por mesa y tipo"?
 *
 * postgres-js expone el SQLSTATE en `.code`; drizzle a veces lo envuelve bajo
 * `.cause`. El nombre de la restricción viaja como `constraint_name` o
 * `constraint` según el driver; si no llega ninguno se asume que sí, porque
 * `service_requests` no tiene ningún otro índice único.
 */
function isPendingUniqueViolation(err: unknown): boolean {
  const e = err as Record<string, any> | null;
  const code = e?.code ?? e?.cause?.code;
  if (code !== "23505") return false;

  const constraint = String(
    e?.constraint_name ??
      e?.constraint ??
      e?.cause?.constraint_name ??
      e?.cause?.constraint ??
      "",
  );

  return constraint === "" || constraint.includes("service_requests");
}

/**
 * Consulta base de la bandeja, ya acotada por organización.
 *
 * Los JOIN son LEFT a propósito: `table_id` y `table_session_id` son
 * ON DELETE SET NULL, y un aviso huérfano tiene que seguir viéndose. Pero cada
 * JOIN lleva además su propio `organization_id` en la condición: si una fila
 * apuntara fuera del tenant, el JOIN devuelve NULL en vez de filtrar el dato.
 */
function detailQuery(organizationId: string) {
  return db
    .select({
      id: schema.serviceRequests.id,
      type: schema.serviceRequests.type,
      status: schema.serviceRequests.status,
      note: schema.serviceRequests.note,
      table_id: schema.serviceRequests.table_id,
      table_number: schema.tables.number,
      table_session_id: schema.serviceRequests.table_session_id,
      customer_name: schema.tableSessions.customer_name,
      acknowledged_by: schema.serviceRequests.acknowledged_by,
      acknowledged_by_name: schema.users.name,
      acknowledged_at: schema.serviceRequests.acknowledged_at,
      resolved_at: schema.serviceRequests.resolved_at,
      created_at: schema.serviceRequests.created_at,
      /**
       * Segundos desde que el comensal avisó. Se calcula en la base de datos
       * (mismo reloj que sella `created_at`) para que no dependa del desfase
       * del proceso que responde.
       */
      elapsed_seconds: sql<number>`EXTRACT(EPOCH FROM (now() - ${schema.serviceRequests.created_at}))::int`,
      /** Segundos que tardó alguien en decir "voy". Null si nadie lo hizo aún. */
      response_seconds: sql<number | null>`CASE
        WHEN ${schema.serviceRequests.acknowledged_at} IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (${schema.serviceRequests.acknowledged_at} - ${schema.serviceRequests.created_at}))::int
      END`,
    })
    .from(schema.serviceRequests)
    .leftJoin(
      schema.tables,
      and(
        eq(schema.serviceRequests.table_id, schema.tables.id),
        eq(schema.tables.organization_id, organizationId),
      ),
    )
    .leftJoin(
      schema.tableSessions,
      and(
        eq(schema.serviceRequests.table_session_id, schema.tableSessions.id),
        eq(schema.tableSessions.organization_id, organizationId),
      ),
    )
    .leftJoin(
      schema.users,
      and(
        eq(schema.serviceRequests.acknowledged_by, schema.users.id),
        eq(schema.users.organization_id, organizationId),
      ),
    );
}

/**
 * Relee un aviso por id, siempre acotado al tenant. Devuelve `undefined` si no
 * existe en esa organización/sede.
 */
export async function getServiceRequestById(
  id: string,
  tenant: TenantScope,
): Promise<ServiceRequestDetail | undefined> {
  const [row] = await detailQuery(tenant.organizationId)
    .where(
      and(
        eq(schema.serviceRequests.id, id),
        eq(schema.serviceRequests.organization_id, tenant.organizationId),
        eq(schema.serviceRequests.branch_id, tenant.branchId),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Construye la fila enriquecida a partir de una fila cruda cuando la relectura
 * no está disponible. Los campos que salen de un JOIN quedan a null: es
 * preferible un nombre ausente a inventarse uno.
 */
function fallbackDetail(row: ServiceRequestRow): ServiceRequestDetail {
  const createdAt = row.created_at ?? new Date();
  const elapsed = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000));

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    note: row.note,
    table_id: row.table_id,
    table_number: null,
    table_session_id: row.table_session_id,
    customer_name: null,
    acknowledged_by: row.acknowledged_by,
    acknowledged_by_name: null,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    created_at: createdAt,
    elapsed_seconds: elapsed,
    response_seconds: row.acknowledged_at
      ? Math.max(
          0,
          Math.floor((row.acknowledged_at.getTime() - createdAt.getTime()) / 1000),
        )
      : null,
  };
}

/**
 * Relee el aviso para adjuntarle los datos de JOIN (número de mesa, nombre del
 * comensal, nombre del mozo) pero conserva como autoritativos los valores que
 * devolvió el propio UPDATE. Así, si entre el UPDATE y la relectura otro
 * cambiara el estado, se responde el resultado real de ESTA transición y no un
 * estado ajeno.
 */
async function enrich(
  row: ServiceRequestRow,
  tenant: TenantScope,
): Promise<ServiceRequestDetail> {
  const detail = await getServiceRequestById(row.id, tenant);
  if (!detail) return fallbackDetail(row);

  return {
    ...detail,
    status: row.status,
    acknowledged_by: row.acknowledged_by,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
  };
}

/**
 * Transición con compare-and-swap. Devuelve la fila actualizada o lanza:
 * `SERVICE_REQUEST_NOT_FOUND` (404) si el aviso no existe en esta sede, o
 * `SERVICE_REQUEST_ALREADY_HANDLED` (409) si otro ya lo atendió.
 */
async function applyTransition(params: {
  id: string;
  tenant: TenantScope;
  /** Estados desde los que la transición es legal. */
  from: ServiceRequestStatus[];
  values: Partial<typeof schema.serviceRequests.$inferInsert>;
}): Promise<ServiceRequestDetail> {
  const [updated] = await db
    .update(schema.serviceRequests)
    .set(params.values)
    .where(
      and(
        eq(schema.serviceRequests.id, params.id),
        eq(schema.serviceRequests.organization_id, params.tenant.organizationId),
        eq(schema.serviceRequests.branch_id, params.tenant.branchId),
        inArray(schema.serviceRequests.status, params.from),
      ),
    )
    .returning();

  if (updated) return enrich(updated, params.tenant);

  // El UPDATE no tocó nada: hay que distinguir "no existe" de "llegaste tarde".
  const [existing] = await db
    .select({ id: schema.serviceRequests.id })
    .from(schema.serviceRequests)
    .where(
      and(
        eq(schema.serviceRequests.id, params.id),
        eq(schema.serviceRequests.organization_id, params.tenant.organizationId),
        eq(schema.serviceRequests.branch_id, params.tenant.branchId),
      ),
    )
    .limit(1);

  throw new Error(
    existing ? SERVICE_REQUEST_ALREADY_HANDLED : SERVICE_REQUEST_NOT_FOUND,
  );
}

// ── Crear aviso ─────────────────────────────────────────────────────

/**
 * Crea un aviso de mesa.
 *
 * Si ya hay uno pendiente de ese mismo tipo para esa mesa NO crea otro: devuelve
 * el existente con `alreadyPending: true`. El llamador decide si eso es un 200
 * idempotente (lo natural para el comensal, que solo quiere saber que su aviso
 * está en marcha) o un aviso al usuario.
 */
export async function createServiceRequest(params: {
  organizationId: string;
  branchId: string;
  tableId: string;
  tableSessionId?: string | null;
  type: ServiceRequestType;
  note?: string | null;
}): Promise<{ request: ServiceRequestDetail; alreadyPending: boolean }> {
  const tenant: TenantScope = {
    organizationId: params.organizationId,
    branchId: params.branchId,
  };

  // La mesa acota el tenant: sin esta comprobación un token podría colgar
  // avisos en la mesa de otra sede.
  const [table] = await db
    .select({ id: schema.tables.id, number: schema.tables.number })
    .from(schema.tables)
    .where(
      and(
        eq(schema.tables.id, params.tableId),
        eq(schema.tables.organization_id, params.organizationId),
        eq(schema.tables.branch_id, params.branchId),
      ),
    )
    .limit(1);

  if (!table) {
    throw new Error(TABLE_NOT_FOUND);
  }

  // La sesión, si se indica, tiene que ser de ESA mesa: evita que un token de
  // otra mesa cuelgue avisos donde no le corresponde.
  if (params.tableSessionId) {
    const [session] = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, params.tableSessionId),
          eq(schema.tableSessions.table_id, params.tableId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.organization_id, params.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      throw new Error(SESSION_TABLE_MISMATCH);
    }
  }

  const note = params.note?.trim().slice(0, NOTE_MAX_LENGTH) || null;

  for (let attempt = 1; attempt <= CREATE_MAX_ATTEMPTS; attempt++) {
    try {
      const [created] = await db
        .insert(schema.serviceRequests)
        .values({
          organization_id: params.organizationId,
          branch_id: params.branchId,
          table_id: params.tableId,
          table_session_id: params.tableSessionId ?? null,
          type: params.type,
          status: "pending",
          note,
        })
        .returning();

      return {
        request: await enrich(created, tenant),
        alreadyPending: false,
      };
    } catch (err) {
      if (!isPendingUniqueViolation(err)) throw err;

      // Ya había un pendiente idéntico: se devuelve ese mismo. El filtro lleva
      // organization_id además de branch_id porque el índice único es solo por
      // (table_id, type) y una lectura sin tenant es una fuga en potencia.
      const [pending] = await db
        .select()
        .from(schema.serviceRequests)
        .where(
          and(
            eq(schema.serviceRequests.organization_id, params.organizationId),
            eq(schema.serviceRequests.branch_id, params.branchId),
            eq(schema.serviceRequests.table_id, params.tableId),
            eq(schema.serviceRequests.type, params.type),
            eq(schema.serviceRequests.status, "pending"),
          ),
        )
        .limit(1);

      if (pending) {
        return {
          request: await enrich(pending, tenant),
          alreadyPending: true,
        };
      }

      // Carrera poco probable pero real: entre el 23505 y este SELECT el mozo
      // atendió el aviso, así que ya no hay pendiente y el insert vuelve a ser
      // legal. Se reintenta; si aun así no cuadra, se propaga el error original.
      if (attempt === CREATE_MAX_ATTEMPTS) throw err;
    }
  }

  // Inalcanzable: el bucle sale por return o por throw.
  throw new Error(SERVICE_REQUEST_NOT_FOUND);
}

// ── Transiciones ────────────────────────────────────────────────────

/**
 * "Voy": el mozo se hace cargo del aviso. pending -> acknowledged.
 * Sella quién y cuándo, que es lo que después permite medir cuánto tardó.
 */
export async function acknowledgeServiceRequest(
  id: string,
  userId: string,
  tenant: TenantScope,
): Promise<ServiceRequestDetail> {
  return applyTransition({
    id,
    tenant,
    from: ["pending"],
    values: {
      status: "acknowledged",
      acknowledged_by: userId,
      acknowledged_at: new Date(),
    },
  });
}

/**
 * Aviso resuelto. Se admite tanto desde `acknowledged` como directamente desde
 * `pending`: lo normal en sala es que el mozo pase por la mesa y lo dé por
 * cerrado sin haber pulsado antes "voy".
 */
export async function resolveServiceRequest(
  id: string,
  tenant: TenantScope,
): Promise<ServiceRequestDetail> {
  return applyTransition({
    id,
    tenant,
    from: ["pending", "acknowledged"],
    values: { status: "resolved", resolved_at: new Date() },
  });
}

/**
 * El comensal se arrepiente. Se admite desde `pending` y desde `acknowledged`
 * (el mozo dijo "voy" pero el cliente decidió seguir pidiendo): cancelar libera
 * además el índice de antispam, así que puede volver a avisar enseguida.
 *
 * `resolved_at` se sella también aquí porque es la única columna de cierre que
 * tiene la tabla; el estado (`cancelled`) es lo que distingue "lo atendieron"
 * de "se arrepintió", así que ninguna métrica los confunde.
 */
export async function cancelServiceRequest(
  id: string,
  tenant: TenantScope,
): Promise<ServiceRequestDetail> {
  return applyTransition({
    id,
    tenant,
    from: ["pending", "acknowledged"],
    values: { status: "cancelled", resolved_at: new Date() },
  });
}

// ── Listado ─────────────────────────────────────────────────────────

/**
 * Bandeja de avisos de la sede.
 *
 * Devuelve el NÚMERO de mesa (no el uuid), el nombre del comensal de la sesión
 * y el tiempo transcurrido en segundos, que es lo que la campana necesita para
 * pintar la urgencia. El orden es el del servicio real: primero lo pendiente,
 * luego lo ya atendido, y dentro de cada grupo lo más viejo arriba.
 *
 * Sobre la ventana temporal: `from`/`to` son OPCIONALES y no se aplica ningún
 * rango por defecto. Un aviso pendiente creado a las 23:55 sigue pendiente a
 * las 00:05, y filtrar "por hoy" lo haría desaparecer de la campana justo en el
 * caso que esta tabla existe para evitar. Quien quiera acotar por día que pase
 * el rango explícitamente.
 */
export async function listServiceRequests(params: {
  organizationId: string;
  branchId: string;
  /**
   * Estados a incluir. Por defecto, los vivos (pendiente + atendido).
   * Un array VACÍO significa "todos los estados", no "ninguno".
   */
  status?: ServiceRequestStatus[];
  tableId?: string;
  type?: ServiceRequestType;
  /** Inicio de la ventana temporal (inclusivo). */
  from?: Date;
  /** Fin de la ventana temporal (EXCLUSIVO). */
  to?: Date;
  limit?: number;
}) {
  const conditions = [
    eq(schema.serviceRequests.organization_id, params.organizationId),
    eq(schema.serviceRequests.branch_id, params.branchId),
  ];

  const statuses = params.status ?? OPEN_STATUSES;
  if (statuses.length > 0) {
    conditions.push(inArray(schema.serviceRequests.status, statuses));
  }
  if (params.tableId) {
    conditions.push(eq(schema.serviceRequests.table_id, params.tableId));
  }
  if (params.type) {
    conditions.push(eq(schema.serviceRequests.type, params.type));
  }
  if (params.from) {
    conditions.push(gte(schema.serviceRequests.created_at, params.from));
  }
  if (params.to) {
    conditions.push(lt(schema.serviceRequests.created_at, params.to));
  }

  // Lo pendiente primero: es lo único que exige acción inmediata.
  const statusRank = sql<number>`CASE ${schema.serviceRequests.status}
    WHEN 'pending' THEN 0
    WHEN 'acknowledged' THEN 1
    ELSE 2 END`;

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), 500);

  return detailQuery(params.organizationId)
    .where(and(...conditions))
    .orderBy(statusRank, asc(schema.serviceRequests.created_at))
    .limit(limit);
}

/**
 * Los avisos vivos de una mesa concreta. Lo usa la vista del comensal para
 * saber si su llamada sigue en pie (y poder cancelarla) sin traerse la bandeja
 * entera de la sede.
 */
export async function listOpenRequestsForTable(params: {
  organizationId: string;
  branchId: string;
  tableId: string;
}): Promise<ServiceRequestDetail[]> {
  return listServiceRequests({
    organizationId: params.organizationId,
    branchId: params.branchId,
    tableId: params.tableId,
    status: OPEN_STATUSES,
    limit: 20,
  });
}
