import { eq, and, desc, gte, lt, ne, inArray, notInArray, isNull, sql } from "drizzle-orm";
import { decode } from "hono/jwt";
import { db, schema, type DbOrTx } from "@restai/db";
import { camposDeCambioDeEstado } from "./order-status.js";
import { signCustomerToken } from "../lib/jwt.js";
import { logger } from "../lib/logger.js";
import { peruCivilDayStart, peruCivilDayEnd } from "../lib/timezone.js";

// TTL constants
export const PENDING_TTL_MINUTES = 10;
export const ACTIVE_TTL_HOURS = 8;

/**
 * Estados de una visita "viva": la mesa está tomada por ella.
 *
 * Es el conjunto CANÓNICO. Todo camino que responda a la pregunta "¿qué debe
 * esta mesa?" —el diálogo de cobro, el guard de «Liberar», el histórico— tiene
 * que partir de las MISMAS sesiones; si cada uno elige las suyas, el mozo ve un
 * saldo en pantalla y un 409 que lo contradice.
 */
export const LIVE_SESSION_STATUSES = ["active", "pending"] as const;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/**
 * Bloquea la fila de una mesa con FOR UPDATE.
 *
 * ORDEN DE BLOQUEO DEL MÓDULO: la fila de `tables` SIEMPRE primero, antes de
 * tocar `table_sessions` u `orders`. Es la regla que hace imposible el ciclo:
 * todo camino que altere la cuenta de una mesa (liberar, cerrar la visita,
 * aprobar un ingreso, sentar, mover, juntar, y también el alta de sesión del
 * comensal y el pedido de staff) empieza tomando este candado, de modo que dos
 * operaciones sobre la MISMA mesa quedan serializadas aquí y ya nunca pueden
 * pedirse candados en orden opuesto más abajo. Cuando hay varias mesas en juego
 * se toman por id ascendente (ver `lockTables`).
 *
 * Ojo: por debajo de este candado el orden entre `table_sessions` y `orders` NO
 * es uniforme (`freeTable` bloquea órdenes antes de cerrar sesiones, `moveSession`
 * al revés) y no hace falta que lo sea, precisamente porque la exclusión mutua ya
 * la garantiza la fila de `tables`.
 */
async function lockTable(
  tx: DbOrTx,
  params: { tableId: string; branchId: string; organizationId?: string },
): Promise<{ id: string; number: number; status: string } | null> {
  const conditions = [
    eq(schema.tables.id, params.tableId),
    eq(schema.tables.branch_id, params.branchId),
  ];
  if (params.organizationId) {
    conditions.push(eq(schema.tables.organization_id, params.organizationId));
  }

  const [row] = await tx
    .select({
      id: schema.tables.id,
      number: schema.tables.number,
      status: schema.tables.status,
    })
    .from(schema.tables)
    .where(and(...conditions))
    .limit(1)
    .for("update");

  return row ?? null;
}

/**
 * Las visitas vivas de una mesa, la principal primero (activa antes que
 * pendiente y, a igualdad, la más reciente).
 *
 * Esta es la ÚNICA definición de "las sesiones de esta mesa". La usan
 * `freeTable` para calcular el saldo y `GET /tables/:id/active-session` para
 * pintarlo: así el número de la pantalla y el del guard salen del mismo
 * conjunto de filas por construcción, no por coincidencia.
 */
export async function getLiveTableSessions(
  txOrDb: DbOrTx,
  params: { tableId: string; branchId: string; organizationId?: string },
): Promise<
  Array<{
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    status: string;
    started_at: Date | null;
  }>
> {
  const conditions = [
    eq(schema.tableSessions.table_id, params.tableId),
    eq(schema.tableSessions.branch_id, params.branchId),
    inArray(schema.tableSessions.status, [...LIVE_SESSION_STATUSES]),
  ];
  if (params.organizationId) {
    conditions.push(eq(schema.tableSessions.organization_id, params.organizationId));
  }

  return await txOrDb
    .select({
      id: schema.tableSessions.id,
      customer_name: schema.tableSessions.customer_name,
      customer_phone: schema.tableSessions.customer_phone,
      status: schema.tableSessions.status,
      started_at: schema.tableSessions.started_at,
    })
    .from(schema.tableSessions)
    .where(and(...conditions))
    // Activa antes que pendiente: la cuenta viva manda sobre una solicitud de
    // ingreso todavía sin aprobar.
    .orderBy(
      sql`CASE WHEN ${schema.tableSessions.status} = 'active' THEN 0 ELSE 1 END`,
      desc(schema.tableSessions.started_at),
    );
}

// ── Create Session ──────────────────────────────────────────────────

export async function createSession(params: {
  /**
   * Optional explicit row id. The customer JWT is signed with `sub = <this id>`
   * BEFORE the row exists (the token is then stored on the row), so the caller
   * must pin the row id to that same value. Otherwise the DB defaultRandom() id
   * diverges from token.sub and every requireActiveSession lookup
   * (tableSessions.id == token.sub) fails with SESSION_ENDED.
   */
  id?: string;
  tableId: string;
  branchId: string;
  organizationId: string;
  customerName: string;
  customerPhone?: string;
  /** Comensales sentados. Solo lo sabe el mozo; el flujo por QR lo deja sin declarar. */
  guests?: number;
  token: string;
  status?: "active" | "pending";
},
/**
 * Transacción opcional. La alta asistida por el mozo tiene que ocupar la mesa y
 * crear la sesión de forma atómica: si se pasa la transacción, el insert entra
 * en ella y comparte su destino.
 */
txOrDb: DbOrTx = db) {
  const now = new Date();
  const status = params.status ?? "pending";
  const expires_at = status === "pending"
    ? addMinutes(now, PENDING_TTL_MINUTES)
    : addHours(now, ACTIVE_TTL_HOURS);

  const [session] = await txOrDb
    .insert(schema.tableSessions)
    .values({
      ...(params.id ? { id: params.id } : {}),
      table_id: params.tableId,
      branch_id: params.branchId,
      organization_id: params.organizationId,
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      guest_count: params.guests ?? null,
      token: params.token,
      status,
      expires_at,
    })
    .returning();

  return session;
}

// ── Approve Session ─────────────────────────────────────────────────

/**
 * La mesa ya tiene una cuenta abierta: aprobar el ingreso pendiente abriría una
 * SEGUNDA visita activa sobre la misma mesa, y a partir de ahí el saldo que
 * pinta el diálogo de cobro y el que calcula «Liberar» dejan de coincidir.
 */
export class TableAlreadyActiveError extends Error {
  readonly code = "TABLE_ALREADY_ACTIVE";
  constructor(readonly activeSessionId: string) {
    super("La mesa ya tiene una cuenta abierta");
    this.name = "TableAlreadyActiveError";
  }
}

export async function approveSession(params: {
  sessionId: string;
  branchId: string;
  organizationId?: string;
}) {
  const now = new Date();

  // Update session + table status in a single transaction using a
  // compare-and-swap so concurrent approvals can't both succeed.
  const result = await db.transaction(async (tx) => {
    // Localizar la mesa de la solicitud para poder bloquearla ANTES de tocar
    // ninguna sesión (orden de bloqueo del módulo: tables -> table_sessions).
    const [pending] = await tx
      .select({ table_id: schema.tableSessions.table_id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "pending"),
        ),
      )
      .limit(1);

    if (!pending) return null;

    // Candado de la mesa: serializa esta aprobación con «sentar walk-in», con
    // el alta de sesión del comensal y con el pedido de staff, que son los
    // otros tres caminos capaces de abrir una visita activa. Todos toman este
    // mismo candado primero, así que la comprobación de abajo no tiene carrera.
    await lockTable(tx, {
      tableId: pending.table_id,
      branchId: params.branchId,
      organizationId: params.organizationId,
    });

    // Una mesa solo puede tener UNA visita activa. Si ya la hay (p. ej. el mozo
    // cantó un pedido en esa mesa mientras el comensal esperaba aprobación),
    // aprobar partiría la cuenta en dos y el saldo dejaría de cuadrar.
    const [alreadyActive] = await tx
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, pending.table_id),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "active"),
          ne(schema.tableSessions.id, params.sessionId),
        ),
      )
      .limit(1);

    if (alreadyActive) {
      throw new TableAlreadyActiveError(alreadyActive.id);
    }

    // Compare-and-swap: only a still-pending, not-yet-expired session in this
    // branch flips to active. Folding the expiry check into the WHERE keeps the
    // transition atomic — no read-then-write race window.
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "active", expires_at: addHours(now, ACTIVE_TTL_HOURS) })
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "pending"),
          gte(schema.tableSessions.expires_at, now),
        ),
      )
      .returning();

    if (!updated) return null;

    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, updated.table_id));

    return { session: updated, tableId: updated.table_id };
  });

  if (result) return result;

  // Approval failed. Distinguish "expired" from "not found / not pending" and
  // auto-reject a pending-but-expired session so the table is freed up. This
  // runs OUTSIDE the approval transaction on purpose: throwing inside the tx
  // would roll the rejection back, leaving the dead session stuck as pending.
  const [expired] = await db
    .update(schema.tableSessions)
    .set({ status: "rejected", ended_at: now })
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
        lt(schema.tableSessions.expires_at, now),
      ),
    )
    .returning();

  if (expired) {
    throw new Error("SESSION_EXPIRED");
  }
  throw new Error("PENDING_SESSION_NOT_FOUND");
}

// ── Reject Session ──────────────────────────────────────────────────

export async function rejectSession(params: {
  sessionId: string;
  branchId: string;
}) {
  // Compare-and-swap: only a still-pending session in this branch flips to
  // rejected, so concurrent reject/approve can't both win.
  const [updated] = await db
    .update(schema.tableSessions)
    .set({ status: "rejected" })
    .where(
      and(
        eq(schema.tableSessions.id, params.sessionId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("PENDING_SESSION_NOT_FOUND");
  }

  return { session: updated, tableId: updated.table_id };
}

// ── End Session ─────────────────────────────────────────────────────

export async function endSession(params: {
  sessionId: string;
  branchId: string;
  /**
   * Perdona el saldo pendiente. El endpoint lo restringe a `payments:void` y lo
   * audita, igual que en `freeTable`.
   */
  force?: boolean;
}) {
  // Do the open-orders guard + state change + table reset in one transaction
  // with a compare-and-swap so concurrent ends can't both succeed.
  return await db.transaction(async (tx) => {
    // Candado de la mesa ANTES de mirar las órdenes.
    //
    // Aquí había un interbloqueo garantizado: `freeTable` bloquea tables y
    // luego orders, mientras que este camino bloqueaba orders (dentro de
    // `computeOutstanding`) y solo al final la mesa, al ponerla disponible.
    // Con «Terminar» y «Liberar» pulsados a la vez sobre la misma mesa —dos
    // tablets, o incluso el mismo usuario— cada transacción esperaba el candado
    // que tenía la otra y Postgres mataba una con un 500 opaco. Tomando el
    // candado de la mesa primero, este camino cumple la regla del módulo (ver
    // `lockTable`) y las dos operaciones se serializan en vez de matarse.
    const [session] = await tx
      .select({ table_id: schema.tableSessions.table_id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
        ),
      )
      .limit(1);

    if (!session) {
      throw new Error("ACTIVE_SESSION_NOT_FOUND");
    }

    await lockTable(tx, { tableId: session.table_id, branchId: params.branchId });

    // Check for open orders (not completed/cancelled) before transitioning.
    const [openOrder] = await tx
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.table_session_id, params.sessionId),
          notInArray(schema.orders.status, ["completed", "cancelled"]),
        ),
      )
      .limit(1);

    if (openOrder) {
      throw new Error("SESSION_HAS_OPEN_ORDERS");
    }

    // Guard de saldo, el mismo que aplica `freeTable`.
    //
    // Sin esto quedaba una puerta trasera al mismo problema: una visita cuyas
    // órdenes están todas en 'completed' pero SIN cobrar pasa el guard de
    // "órdenes abiertas" de arriba, y la mesa se liberaba con la cuenta impagada
    // y sin ninguna traza. Cerrar una visita y liberar una mesa tienen que exigir
    // lo mismo, porque para el negocio son la misma acción.
    if (!params.force) {
      const { pendingAmount } = await computeOutstanding(tx, [params.sessionId], params.branchId);
      if (pendingAmount > 0) {
        throw new TableHasBalanceError(pendingAmount);
      }
    }

    // Compare-and-swap: only a still-active session in this branch completes.
    const [updated] = await tx
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: new Date() })
      .where(
        and(
          eq(schema.tableSessions.id, params.sessionId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.status, "active"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("ACTIVE_SESSION_NOT_FOUND");
    }

    await tx
      .update(schema.tables)
      .set({ status: "available" })
      .where(eq(schema.tables.id, updated.table_id));

    return { session: updated, tableId: updated.table_id };
  });
}

// ── Free Table ──────────────────────────────────────────────────────

/** Orden finalizada al liberar la mesa, con lo que necesitan los efectos posteriores. */
interface CompletedOrderRef {
  id: string;
  order_number: string;
  subtotal: number;
  discount: number;
  customer_id: string | null;
}

/**
 * La mesa tiene cuenta pendiente: liberarla convertiría un impago en venta
 * cerrada (con puntos e inventario descontados) sin que nadie se entere.
 * `pendingAmount` va en CÉNTIMOS.
 */
export class TableHasBalanceError extends Error {
  readonly code = "TABLE_HAS_BALANCE";
  constructor(readonly pendingAmount: number) {
    super(`La mesa tiene un saldo pendiente de ${pendingAmount} céntimos`);
    this.name = "TableHasBalanceError";
  }
}

/**
 * Calcula el saldo pendiente de un conjunto de órdenes: lo facturado menos lo
 * cobrado. Solo cuentan los pagos `completed` y NO anulados: un cobro anulado
 * (voided_at) no cancela nada, la deuda sigue viva.
 *
 * Bloquea las órdenes con FOR UPDATE, que es el mismo candado que toma
 * `POST /payments` antes de registrar un cobro. Así "liberar" y "cobrar" se
 * serializan y no puede colarse un pago entre el cálculo y la liberación.
 */
async function computeOutstanding(
  tx: DbOrTx,
  sessionIds: string[],
  branchId: string,
): Promise<{ billed: number; paid: number; pendingAmount: number; orders: Array<{ id: string; order_number: string; status: string; subtotal: number; discount: number; total: number; customer_id: string | null }> }> {
  if (sessionIds.length === 0) {
    return { billed: 0, paid: 0, pendingAmount: 0, orders: [] };
  }

  // Todas las órdenes vivas de la visita (las anuladas no se cobran). Se usan
  // tanto para el saldo como para saber cuáles hay que finalizar.
  //
  // El filtro por sede NO es decorativo: `GET /tables/:id/active-session` —la
  // pantalla que ve el cajero— acota sus órdenes por `branch_id`, así que este
  // cálculo tiene que acotarlas igual. En cuanto un lado filtra y el otro no,
  // vuelve el desencuentro que este módulo existe para evitar: un saldo en
  // pantalla y un 409 al liberar que dicen cosas distintas.
  const orders = await tx
    .select({
      id: schema.orders.id,
      order_number: schema.orders.order_number,
      status: schema.orders.status,
      subtotal: schema.orders.subtotal,
      discount: schema.orders.discount,
      total: schema.orders.total,
      customer_id: schema.orders.customer_id,
    })
    .from(schema.orders)
    .where(
      and(
        inArray(schema.orders.table_session_id, sessionIds),
        eq(schema.orders.branch_id, branchId),
        ne(schema.orders.status, "cancelled"),
      ),
    )
    // Orden determinista al tomar los candados: dos transacciones que bloqueen
    // el mismo conjunto de órdenes lo hacen en la misma secuencia y no pueden
    // quedarse esperándose la una a la otra.
    .orderBy(schema.orders.id)
    .for("update");

  if (orders.length === 0) {
    return { billed: 0, paid: 0, pendingAmount: 0, orders: [] };
  }

  const [paidRow] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)::int` })
    .from(schema.payments)
    .where(
      and(
        inArray(
          schema.payments.order_id,
          orders.map((o) => o.id),
        ),
        eq(schema.payments.status, "completed"),
        isNull(schema.payments.voided_at),
      ),
    );

  const billed = orders.reduce((sum, o) => sum + o.total, 0);
  const paid = paidRow?.total ?? 0;

  return { billed, paid, pendingAmount: Math.max(0, billed - paid), orders };
}

/**
 * Frees a table for the next customer, robustly. Unlike PATCH /:id/status
 * (which only flips tables.status and was the cause of the "Liberar no libera"
 * bug — it left an orphan ACTIVE table_sessions row that made the customer-entry
 * side still treat the table as busy), this:
 *   1. comprueba que no quede saldo pendiente (salvo `force`);
 *   2. closes every non-terminal session for the table (active -> completed,
 *      pending -> rejected), clearing any orphan left by the old path;
 *   3. finalizes any still-open orders (status -> completed, items -> served) so
 *      the visit is closed out;
 *   4. sets the table to available (also self-heals a row wrongly left occupied).
 * Returns the orders that were finalized so the caller can run the completion
 * side effects (loyalty + inventory) idempotently OUTSIDE this transaction.
 *
 * @throws TableHasBalanceError si queda saldo y no se fuerza.
 */
export async function freeTable(params: {
  tableId: string;
  branchId: string;
  organizationId: string;
  /** Perdona el saldo pendiente. El endpoint lo restringe a payments:void y lo audita. */
  force?: boolean;
}): Promise<{
  tableId: string;
  completedOrders: CompletedOrderRef[];
  /**
   * Sesiones que se cerraron. El llamador las necesita para avisar por realtime
   * a cada dispositivo de comensal (canal `session:<id>`): si no, su pantalla se
   * queda colgada mostrando una cuenta que ya no existe.
   */
  closedSessionIds: string[];
  /** Saldo que quedaba al liberar (0 salvo que se haya forzado). */
  pendingAmount: number;
  /** Total facturado y total cobrado de la visita, para la traza de auditoría. */
  billed: number;
  paid: number;
}> {
  return await db.transaction(async (tx) => {
    // Candado sobre la mesa: dos "liberar" simultáneos se serializan aquí.
    const table = await lockTable(tx, {
      tableId: params.tableId,
      branchId: params.branchId,
      organizationId: params.organizationId,
    });

    if (!table) {
      throw new Error("TABLE_NOT_FOUND");
    }

    // Mismo conjunto de visitas que sirve `GET /tables/:id/active-session`: el
    // saldo del guard y el de la pantalla salen de las mismas filas.
    const sessions = await getLiveTableSessions(tx, {
      tableId: params.tableId,
      branchId: params.branchId,
      organizationId: params.organizationId,
    });

    const sessionIds = sessions.map((s) => s.id);
    const { billed, paid, pendingAmount, orders } = await computeOutstanding(
      tx,
      sessionIds,
      params.branchId,
    );

    if (pendingAmount > 0 && !params.force) {
      throw new TableHasBalanceError(pendingAmount);
    }

    const openOrders: CompletedOrderRef[] = orders
      .filter((o) => o.status !== "completed")
      .map((o) => ({
        id: o.id,
        order_number: o.order_number,
        subtotal: o.subtotal,
        discount: o.discount,
        customer_id: o.customer_id,
      }));

    if (sessionIds.length > 0) {
      if (openOrders.length > 0) {
        const orderIds = openOrders.map((o) => o.id);
        const now = new Date();
        await tx
          .update(schema.orders)
          .set(camposDeCambioDeEstado("completed", now))
          .where(inArray(schema.orders.id, orderIds));
        await tx
          .update(schema.orderItems)
          .set({ status: "served" })
          .where(
            and(
              inArray(schema.orderItems.order_id, orderIds),
              ne(schema.orderItems.status, "cancelled"),
            ),
          );
      }

      const now2 = new Date();
      await tx
        .update(schema.tableSessions)
        .set({ status: "completed", ended_at: now2 })
        .where(
          and(
            eq(schema.tableSessions.table_id, params.tableId),
            eq(schema.tableSessions.branch_id, params.branchId),
            eq(schema.tableSessions.status, "active"),
          ),
        );
      await tx
        .update(schema.tableSessions)
        .set({ status: "rejected", ended_at: now2 })
        .where(
          and(
            eq(schema.tableSessions.table_id, params.tableId),
            eq(schema.tableSessions.branch_id, params.branchId),
            eq(schema.tableSessions.status, "pending"),
          ),
        );
    }

    // Cerrar los avisos que quedaran vivos ("llamar al mozo", "la cuenta").
    //
    // CRÍTICO por el índice único parcial de `service_requests`: solo puede
    // haber UN aviso pendiente por mesa y tipo. Si al liberar la mesa quedaba
    // uno abierto del comensal anterior, el SIGUIENTE comensal pulsaba el botón
    // y el sistema se lo tragaba como "ya hay uno en camino" —de una visita que
    // ya terminó—, así que su llamada nunca llegaba a nadie. La mesa se quedaba
    // muda hasta que alguien resolvía a mano un aviso fantasma.
    await tx
      .update(schema.serviceRequests)
      .set({ status: "cancelled", resolved_at: new Date() })
      .where(
        and(
          eq(schema.serviceRequests.table_id, params.tableId),
          eq(schema.serviceRequests.branch_id, params.branchId),
          inArray(schema.serviceRequests.status, ["pending", "acknowledged"]),
        ),
      );

    await tx
      .update(schema.tables)
      .set({ status: "available" })
      .where(
        and(
          eq(schema.tables.id, params.tableId),
          eq(schema.tables.branch_id, params.branchId),
          eq(schema.tables.organization_id, params.organizationId),
        ),
      );

    return {
      tableId: params.tableId,
      completedOrders: openOrders,
      closedSessionIds: sessionIds,
      pendingAmount,
      billed,
      paid,
    };
  });
}

// ── Mover y juntar cuenta ───────────────────────────────────────────

/**
 * Errores de negocio de mover/juntar. Se distinguen por `code` para que la ruta
 * traduzca cada uno a su HTTP sin comparar cadenas sueltas.
 */
export class SessionTransferError extends Error {
  constructor(
    readonly code:
      | "TABLE_NOT_FOUND"
      | "TARGET_TABLE_NOT_FOUND"
      | "SAME_TABLE"
      | "NO_ACTIVE_SESSION"
      | "TARGET_NOT_AVAILABLE"
      | "TARGET_HAS_SESSION"
      | "SOURCE_TABLE_NOT_FOUND"
      | "SOURCE_WITHOUT_SESSION",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SessionTransferError";
  }
}

/**
 * Bloquea varias mesas con FOR UPDATE en orden determinista (ascendente por id).
 *
 * El orden importa: si "mover 5 -> 8" bloquea 5 y luego 8 mientras "mover 8 -> 5"
 * bloquea 8 y luego 5, Postgres mata una de las dos por deadlock. Ordenando
 * siempre por id, todas las transferencias toman los candados en la misma
 * secuencia y no hay ciclo posible.
 */
async function lockTables(
  tx: DbOrTx,
  tableIds: string[],
  branchId: string,
  organizationId: string,
) {
  const unique = [...new Set(tableIds)].sort();
  const locked: Array<{ id: string; number: number; status: string }> = [];
  for (const tableId of unique) {
    const [row] = await tx
      .select({
        id: schema.tables.id,
        number: schema.tables.number,
        status: schema.tables.status,
      })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, tableId),
          eq(schema.tables.branch_id, branchId),
          eq(schema.tables.organization_id, organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (row) locked.push(row);
  }
  return new Map(locked.map((t) => [t.id, t]));
}

/** Sesión activa de una mesa (a lo sumo una por la propia semántica del flujo). */
async function findActiveSession(tx: DbOrTx, tableId: string, branchId: string) {
  const [session] = await tx
    .select({
      id: schema.tableSessions.id,
      table_id: schema.tableSessions.table_id,
      customer_name: schema.tableSessions.customer_name,
      status: schema.tableSessions.status,
      token: schema.tableSessions.token,
    })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.table_id, tableId),
        eq(schema.tableSessions.branch_id, branchId),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .orderBy(desc(schema.tableSessions.started_at))
    .limit(1)
    .for("update");

  return session ?? null;
}

/**
 * Vuelve a firmar el token del comensal apuntando a la nueva mesa.
 *
 * El JWT de comensal lleva `table` entre sus claims y `requireActiveSession`
 * exige que coincida con `table_sessions.table_id`. Si movemos la sesión sin
 * re-firmar, el token del comensal deja de validar y su teléfono responde
 * SESSION_ENDED en el siguiente pedido: mover la cuenta echaría al cliente del
 * sistema. Se conserva `customerId` leyéndolo del token anterior (la fila de
 * sesión no lo guarda), para no perder la atribución de puntos de fidelidad.
 */
async function resignSessionToken(
  previousToken: string,
  params: { sessionId: string; organizationId: string; branchId: string; tableId: string },
): Promise<string> {
  let customerId: string | undefined;
  try {
    // Decodificar sin verificar es seguro aquí: el token lo emitimos nosotros y
    // solo se lee para conservar un claim. Si estuviese caducado, `verify`
    // lanzaría y perderíamos el vínculo con el cliente sin necesidad.
    const { payload } = decode(previousToken) as { payload?: Record<string, unknown> };
    if (typeof payload?.customerId === "string") customerId = payload.customerId;
  } catch {
    // Token ilegible (formato antiguo o corrupto): se re-firma sin cliente.
  }

  return signCustomerToken({
    sub: params.sessionId,
    org: params.organizationId,
    branch: params.branchId,
    table: params.tableId,
    ...(customerId ? { customerId } : {}),
  });
}

/**
 * Mueve la sesión activa de una mesa a otra libre ("los de la 5 se pasan a la 8").
 *
 * Las órdenes cuelgan de `table_session_id`, no de la mesa, así que reasignar la
 * sesión arrastra TODA la cuenta —pedidos, líneas, pagos y comandas— sin tocar
 * un solo importe. La sesión sigue siendo la misma; lo único que se renueva es
 * el token del comensal, porque va atado a la mesa (ver `resignSessionToken`).
 */
export async function moveSession(params: {
  tableId: string;
  targetTableId: string;
  branchId: string;
  organizationId: string;
}) {
  if (params.tableId === params.targetTableId) {
    throw new SessionTransferError("SAME_TABLE", "La mesa de origen y la de destino son la misma");
  }

  return await db.transaction(async (tx) => {
    const locked = await lockTables(
      tx,
      [params.tableId, params.targetTableId],
      params.branchId,
      params.organizationId,
    );

    const source = locked.get(params.tableId);
    if (!source) {
      throw new SessionTransferError("TABLE_NOT_FOUND", "Mesa de origen no encontrada");
    }
    const target = locked.get(params.targetTableId);
    if (!target) {
      throw new SessionTransferError("TARGET_TABLE_NOT_FOUND", "Mesa de destino no encontrada");
    }

    if (target.status !== "available") {
      throw new SessionTransferError(
        "TARGET_NOT_AVAILABLE",
        `La mesa ${target.number} no está disponible`,
      );
    }

    const session = await findActiveSession(tx, params.tableId, params.branchId);
    if (!session) {
      throw new SessionTransferError(
        "NO_ACTIVE_SESSION",
        `La mesa ${source.number} no tiene una cuenta abierta`,
      );
    }

    // Defensa en profundidad: aunque la mesa destino figure disponible, no puede
    // tener sesiones vivas colgando (un huérfano dejaría dos cuentas en la misma mesa).
    const [targetSession] = await tx
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, params.targetTableId),
          eq(schema.tableSessions.branch_id, params.branchId),
          inArray(schema.tableSessions.status, ["active", "pending"]),
        ),
      )
      .limit(1);

    if (targetSession) {
      throw new SessionTransferError(
        "TARGET_HAS_SESSION",
        `La mesa ${target.number} ya tiene una cuenta abierta`,
      );
    }

    // El token se renueva DENTRO de la transacción: si el movimiento se
    // deshace, el token guardado tampoco cambia y el comensal sigue operativo
    // en su mesa original.
    const newToken = await resignSessionToken(session.token, {
      sessionId: session.id,
      organizationId: params.organizationId,
      branchId: params.branchId,
      tableId: params.targetTableId,
    });

    const [movedSession] = await tx
      .update(schema.tableSessions)
      .set({ table_id: params.targetTableId, token: newToken })
      .where(eq(schema.tableSessions.id, session.id))
      .returning();

    const [{ count: movedOrders }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(eq(schema.orders.table_session_id, session.id));

    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, params.targetTableId));

    // El origen queda libre salvo que esté en mantenimiento, estado que no debe
    // pisarse por mover una cuenta.
    if (source.status !== "maintenance") {
      await tx
        .update(schema.tables)
        .set({ status: "available" })
        .where(eq(schema.tables.id, params.tableId));
    }

    return {
      session: movedSession,
      sessionId: session.id,
      /** Token renovado del comensal: hay que hacérselo llegar a su dispositivo. */
      token: newToken,
      movedOrders,
      source: { id: source.id, number: source.number },
      target: { id: target.id, number: target.number },
    };
  });
}

/**
 * Junta las cuentas de varias mesas en la de esta mesa ("mételo todo en la 4").
 *
 * Reasigna las órdenes de las sesiones origen a la sesión destino, cierra esas
 * sesiones como `completed` y libera sus mesas. No recalcula dinero: cada orden
 * conserva su subtotal, IGV, descuento y total, y sus pagos siguen apuntando a
 * ella. La cuenta junta es, simplemente, la suma de las órdenes de la sesión
 * destino.
 */
export async function mergeSessions(params: {
  tableId: string;
  sourceTableIds: string[];
  branchId: string;
  organizationId: string;
}) {
  const sourceIds = [...new Set(params.sourceTableIds)].filter((id) => id !== params.tableId);
  if (sourceIds.length === 0) {
    throw new SessionTransferError("SAME_TABLE", "Indica al menos una mesa distinta de la destino");
  }

  return await db.transaction(async (tx) => {
    const locked = await lockTables(
      tx,
      [params.tableId, ...sourceIds],
      params.branchId,
      params.organizationId,
    );

    const target = locked.get(params.tableId);
    if (!target) {
      throw new SessionTransferError("TABLE_NOT_FOUND", "Mesa de destino no encontrada");
    }

    const missing = sourceIds.filter((id) => !locked.has(id));
    if (missing.length > 0) {
      throw new SessionTransferError(
        "SOURCE_TABLE_NOT_FOUND",
        "Alguna mesa de origen no pertenece a esta sede",
        { missing },
      );
    }

    const targetSession = await findActiveSession(tx, params.tableId, params.branchId);
    if (!targetSession) {
      throw new SessionTransferError(
        "NO_ACTIVE_SESSION",
        `La mesa ${target.number} no tiene una cuenta abierta donde juntar`,
      );
    }

    const merged: Array<{
      tableId: string;
      tableNumber: number;
      sessionId: string;
      movedOrders: number;
    }> = [];

    for (const sourceId of sourceIds) {
      const sourceTable = locked.get(sourceId)!;
      const sourceSession = await findActiveSession(tx, sourceId, params.branchId);
      if (!sourceSession) {
        throw new SessionTransferError(
          "SOURCE_WITHOUT_SESSION",
          `La mesa ${sourceTable.number} no tiene una cuenta abierta`,
          { tableId: sourceId },
        );
      }

      const movedOrders = await tx
        .update(schema.orders)
        .set({ table_session_id: targetSession.id, updated_at: new Date() })
        .where(eq(schema.orders.table_session_id, sourceSession.id))
        .returning({ id: schema.orders.id });

      // La sesión origen se cierra ya sin órdenes: toda su cuenta vive ahora en
      // la sesión destino, de modo que el histórico de la mesa origen apunta a
      // una visita cerrada y sin importes duplicados.
      await tx
        .update(schema.tableSessions)
        .set({ status: "completed", ended_at: new Date() })
        .where(eq(schema.tableSessions.id, sourceSession.id));

      // Las sesiones pendientes de la mesa origen se rechazan: nadie va a
      // aprobar un ingreso a una mesa que acaba de quedar libre.
      await tx
        .update(schema.tableSessions)
        .set({ status: "rejected", ended_at: new Date() })
        .where(
          and(
            eq(schema.tableSessions.table_id, sourceId),
            eq(schema.tableSessions.branch_id, params.branchId),
            eq(schema.tableSessions.status, "pending"),
          ),
        );

      if (sourceTable.status !== "maintenance") {
        await tx
          .update(schema.tables)
          .set({ status: "available" })
          .where(eq(schema.tables.id, sourceId));
      }

      merged.push({
        tableId: sourceId,
        tableNumber: sourceTable.number,
        sessionId: sourceSession.id,
        movedOrders: movedOrders.length,
      });
    }

    // La mesa destino queda ocupada aunque estuviera marcada de otro modo.
    await tx
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, params.tableId));

    const [{ count: totalOrders }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(eq(schema.orders.table_session_id, targetSession.id));

    return {
      targetSessionId: targetSession.id,
      target: { id: target.id, number: target.number },
      merged,
      totalOrders,
    };
  });
}

// ── Get Table History ───────────────────────────────────────────────

export async function getTableHistory(params: {
  tableId: string;
  branchId: string;
  from?: string;
  to?: string;
}) {
  // Verify table belongs to this branch
  const [table] = await db
    .select()
    .from(schema.tables)
    .where(
      and(
        eq(schema.tables.id, params.tableId),
        eq(schema.tables.branch_id, params.branchId),
      ),
    )
    .limit(1);

  if (!table) {
    throw new Error("TABLE_NOT_FOUND");
  }

  // Build session query conditions
  const sessionConditions = [
    eq(schema.tableSessions.table_id, params.tableId),
    eq(schema.tableSessions.branch_id, params.branchId),
  ];

  // Fechas civiles peruanas: el encargado elige "07/08" en el DatePicker y
  // espera el día 7 de Lima. Interpretar la cadena como instante UTC (lo que
  // hacía `new Date("2026-08-07")` + setHours del servidor) desplazaba la
  // ventana cinco horas y se colaban o se perdían las visitas de la noche.
  if (params.from) {
    sessionConditions.push(gte(schema.tableSessions.started_at, peruCivilDayStart(params.from)));
  }
  if (params.to) {
    sessionConditions.push(lt(schema.tableSessions.started_at, peruCivilDayEnd(params.to)));
  }

  const sessions = await db
    .select()
    .from(schema.tableSessions)
    .where(and(...sessionConditions))
    .orderBy(desc(schema.tableSessions.started_at))
    .limit(100);

  // Pedidos de cada visita. Los anulados quedan fuera: no son ventas y estaban
  // inflando el "Ingresos" del histórico con comida que nunca salió.
  const sessionIds = sessions.map((s) => s.id);
  let sessionOrders: Array<{
    id: string;
    table_session_id: string | null;
    order_number: string;
    total: number;
    status: string;
    created_at: Date | null;
    /** Cobrado de verdad (completado y no anulado), en céntimos. */
    total_paid: number;
  }> = [];
  if (sessionIds.length > 0) {
    sessionOrders = await db
      .select({
        id: schema.orders.id,
        table_session_id: schema.orders.table_session_id,
        order_number: schema.orders.order_number,
        total: schema.orders.total,
        status: schema.orders.status,
        created_at: schema.orders.created_at,
        // Predicado canónico de "cobro real": completado Y no anulado. Un cobro
        // anulado no ingresó nada, así que no puede sumar en el histórico.
        //
        // Alias explícito (`p`) y `orders.id` cualificado a propósito: drizzle
        // interpola las columnas SIN cualificar, y dentro del subselect un
        // `"id"` a secas resolvería a `payments.id`, con lo que la suma daría
        // 0 siempre.
        total_paid: sql<number>`COALESCE((
          SELECT SUM(p.amount)::bigint
          FROM payments p
          WHERE p.order_id = orders.id
            AND p.status = 'completed'
            AND p.voided_at IS NULL
        ), 0)::int`,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.branch_id, params.branchId),
          inArray(schema.orders.table_session_id, sessionIds),
          ne(schema.orders.status, "cancelled"),
        ),
      );
  }

  // Group orders by session
  const ordersBySession = new Map<string, typeof sessionOrders>();
  for (const order of sessionOrders) {
    const key = order.table_session_id;
    if (!key) continue;
    if (!ordersBySession.has(key)) ordersBySession.set(key, []);
    ordersBySession.get(key)!.push(order);
  }

  // Build result with orders
  const sessionsWithOrders = sessions.map((s) => {
    const orders = ordersBySession.get(s.id) || [];
    // "Ingresos" es dinero COBRADO, no facturado: una visita servida y nunca
    // pagada no puede figurar como ingreso del local.
    const totalRevenue = orders.reduce((sum, o) => sum + o.total_paid, 0);
    const duration = s.ended_at
      ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
      : null;
    return {
      ...s,
      orders,
      total_revenue: totalRevenue,
      order_count: orders.length,
      duration_minutes: duration,
    };
  });

  // Summary
  const totalRevenue = sessionsWithOrders.reduce((sum, s) => sum + s.total_revenue, 0);
  const totalOrders = sessionsWithOrders.reduce((sum, s) => sum + s.order_count, 0);
  const completedSessions = sessionsWithOrders.filter((s) => s.duration_minutes !== null);
  const avgDuration = completedSessions.length > 0
    ? Math.round(completedSessions.reduce((sum, s) => sum + s.duration_minutes!, 0) / completedSessions.length)
    : 0;

  return {
    sessions: sessionsWithOrders,
    summary: {
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      total_sessions: sessions.length,
      avg_duration_minutes: avgDuration,
    },
  };
}

// ── Expire Stale Sessions ───────────────────────────────────────────

/**
 * Auto-expires pending and active sessions that have passed their TTL.
 * Resets associated tables to "available".
 * Returns the number of expired sessions.
 */
export async function expireStale(): Promise<number> {
  const now = new Date();

  return await db.transaction(async (tx) => {
    // Expire pending sessions (already set-based).
    const expiredPending = await tx
      .update(schema.tableSessions)
      .set({ status: "rejected", ended_at: now })
      .where(
        and(
          eq(schema.tableSessions.status, "pending"),
          lt(schema.tableSessions.expires_at, now),
        ),
      )
      .returning({ table_id: schema.tableSessions.table_id });

    // Expire active sessions (safety net) — skip sessions with open orders.
    // Single set-based UPDATE with a correlated NOT EXISTS anti-join against
    // open orders, replacing the previous per-session N+1 query loop.
    const expiredActive = await tx
      .update(schema.tableSessions)
      .set({ status: "completed", ended_at: now })
      .where(
        and(
          eq(schema.tableSessions.status, "active"),
          lt(schema.tableSessions.expires_at, now),
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.orders}
            WHERE ${schema.orders.table_session_id} = ${schema.tableSessions.id}
              AND ${schema.orders.status} NOT IN ('completed', 'cancelled')
          )`,
        ),
      )
      .returning({ table_id: schema.tableSessions.table_id });

    // Reset associated tables to available in the same transaction.
    const tableIds = [
      ...expiredPending.map((r) => r.table_id),
      ...expiredActive.map((r) => r.table_id),
    ];

    if (tableIds.length > 0) {
      const uniqueTableIds = [...new Set(tableIds)];
      await tx
        .update(schema.tables)
        .set({ status: "available" })
        .where(inArray(schema.tables.id, uniqueTableIds));

      logger.info("Expired stale sessions", {
        pending: expiredPending.length,
        active: expiredActive.length,
      });
    }

    return expiredPending.length + expiredActive.length;
  });
}
