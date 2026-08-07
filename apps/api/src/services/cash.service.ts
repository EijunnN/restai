import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema, type DbOrTx } from "@restai/db";
import { peruCivilDate } from "../lib/timezone.js";

/**
 * Arqueo de caja.
 *
 * Un cajero abre caja con un fondo (`opening_float`), cobra durante su turno y
 * al cerrar declara el efectivo que hay físicamente en el cajón. El sistema
 * calcula lo que DEBERÍA haber y registra la diferencia. Sin esto, un local con
 * caja de mostrador no puede cuadrar el dinero ni atribuir un faltante.
 *
 * Invariantes:
 * - Como máximo una caja abierta por sede. Lo garantiza el índice único parcial
 *   `uq_cash_sessions_open_per_branch` de la migración 0012, NO el código: dos
 *   peticiones simultáneas de apertura no pueden ganar las dos, porque la
 *   segunda revienta con 23505 y aquí se traduce a 409.
 * - `business_date` es la fecha civil de Lima (día operativo), no el día UTC.
 * - Todo el dinero va en CÉNTIMOS enteros. Nunca float.
 * - Un cobro anulado (`voided_at IS NOT NULL`) deja de contar para el efectivo
 *   esperado, pero se informa aparte para que el cierre sea explicable.
 *
 * Las funciones son puras respecto al transporte: reciben parámetros explícitos
 * y lanzan `CashSessionError`. El HTTP lo resuelve la ruta.
 */

// ── Errores tipados ─────────────────────────────────────────────────

export class CashSessionError extends Error {
  constructor(
    public readonly code:
      | "CASH_SESSION_ALREADY_OPEN"
      | "NO_OPEN_CASH_SESSION"
      | "CASH_SESSION_NOT_FOUND",
    message: string,
    public readonly status: 404 | 409,
    /** Datos útiles para la respuesta (p. ej. la caja que ya estaba abierta). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CashSessionError";
  }
}

/** SQLSTATE 23505 = violación de índice único. postgres.js lo pone en `.code`;
 *  drizzle a veces lo envuelve en `.cause`. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505";
}

// ── Tipos públicos ──────────────────────────────────────────────────

export type CashSessionRow = typeof schema.cashSessions.$inferSelect;

export interface CashMethodTotal {
  method: string;
  /** Suma cobrada con ese método, en céntimos (sin propinas). */
  total: number;
  /** Propinas cobradas con ese método, en céntimos. */
  tips: number;
  /** Nº de operaciones con ese método. */
  count: number;
}

export interface CashBreakdown {
  /** Desglose por método de pago (solo cobros completados y no anulados). */
  by_method: CashMethodTotal[];
  /** Cobros en efectivo, en céntimos. Lo único que suma al efectivo esperado. */
  cash_sales: number;
  /** Cobros con cualquier otro método (tarjeta, Yape, Plin...). Informativo. */
  non_cash_sales: number;
  /** Total cobrado (efectivo + resto), en céntimos. */
  total_sales: number;
  /**
   * Propinas registradas, en céntimos. NO se suman al efectivo esperado: el
   * arqueo cuadra la venta, y el reparto de propinas es otra conversación.
   * Se expone para que la pantalla de cierre pueda mostrarlas.
   */
  tips_total: number;
  /** Propinas cobradas en efectivo. Igual de informativas. */
  cash_tips: number;
  /** Nº de cobros válidos de la caja. */
  payment_count: number;
  /** Nº de órdenes distintas cobradas en la caja. */
  order_count: number;
  /** Importe anulado durante el turno, en céntimos. */
  voided_total: number;
  /** Nº de cobros anulados durante el turno. */
  voided_count: number;
  /** opening_float + cash_sales, en céntimos. Es la cifra que se audita. */
  expected_cash: number;
  /**
   * expected_cash + cash_tips, en céntimos. INFORMATIVO.
   *
   * La propina pagada en efectivo está FÍSICAMENTE en el cajón, así que si el
   * cajero cuenta todo lo que hay verá siempre un "sobrante" igual a las
   * propinas. Esta cifra existe para que la pantalla de cierre pueda explicarlo
   * sin tocar la fórmula auditada: `difference` sigue siendo
   * counted_cash − expected_cash, tal y como está especificado.
   */
  expected_cash_with_tips: number;
}

export interface CashSessionWithTotals extends CashSessionRow {
  opened_by_name: string | null;
  closed_by_name: string | null;
  /** Totales calculados AHORA a partir de los cobros de la caja. */
  totals: CashBreakdown;
}

const openerUser = alias(schema.users, "cash_opener");
const closerUser = alias(schema.users, "cash_closer");

// ── Consulta de la caja abierta ─────────────────────────────────────

/**
 * Devuelve la caja abierta de la sede, o `null`.
 *
 * `lock` sirve para serializar contra el cierre: la ruta de cobros debería
 * llamar a esta función con `lock: "share"` DENTRO de su transacción antes de
 * insertar el pago; el cierre toma `for update` sobre la misma fila, así que un
 * cobro en vuelo o bien entra antes del cierre y se cuenta, o bien espera y ve
 * la caja ya cerrada. Sin el lock compartido, un cobro podría colarse justo
 * después de calcular el esperado y descuadrar el arqueo.
 */
export async function findOpenCashSession(
  params: {
    organizationId: string;
    branchId: string;
    lock?: "update" | "share";
  },
  txOrDb: DbOrTx = db,
): Promise<CashSessionRow | null> {
  // El `orderBy` es determinista a propósito: el índice único parcial impide
  // dos cajas abiertas, pero si una sede ya tenía datos previos a la migración
  // 0012 el índice no las borra retroactivamente. Ante el empate imposible se
  // elige siempre la más reciente, igual que hace la ruta de cobros.
  const query = txOrDb
    .select()
    .from(schema.cashSessions)
    .where(
      and(
        eq(schema.cashSessions.organization_id, params.organizationId),
        eq(schema.cashSessions.branch_id, params.branchId),
        eq(schema.cashSessions.status, "open"),
      ),
    )
    .orderBy(desc(schema.cashSessions.opened_at))
    .limit(1);

  const rows = params.lock ? await query.for(params.lock) : await query;
  return rows[0] ?? null;
}

// ── Desglose de una caja ────────────────────────────────────────────

/**
 * Totales de una caja a partir de los cobros enlazados a ella.
 *
 * Solo cuentan los pagos `status = 'completed'` y NO anulados. Los anulados se
 * devuelven aparte porque un cierre sin explicación del importe anulado es un
 * cierre que nadie puede auditar.
 *
 * El filtro por `organization_id` y `branch_id` es redundante —el id de caja ya
 * acota— pero se pone igual: ninguna suma de dinero de este sistema debe poder
 * cruzar sedes ni organizaciones aunque alguien cambie la consulta de arriba.
 */
export async function getCashBreakdown(
  params: {
    cashSessionId: string;
    openingFloat: number;
    organizationId: string;
    branchId: string;
  },
  txOrDb: DbOrTx = db,
): Promise<CashBreakdown> {
  const sameTenant = and(
    eq(schema.payments.cash_session_id, params.cashSessionId),
    eq(schema.payments.organization_id, params.organizationId),
    eq(schema.payments.branch_id, params.branchId),
  );

  const validPayment = and(
    sameTenant,
    eq(schema.payments.status, "completed"),
    isNull(schema.payments.voided_at),
  );

  const [byMethod, [voided], [orders]] = await Promise.all([
    txOrDb
      .select({
        method: schema.payments.method,
        total: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)::int`,
        tips: sql<number>`COALESCE(SUM(${schema.payments.tip}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.payments)
      .where(validPayment)
      .groupBy(schema.payments.method),
    txOrDb
      .select({
        total: sql<number>`COALESCE(SUM(${schema.payments.amount}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.payments)
      .where(and(sameTenant, isNotNull(schema.payments.voided_at))),
    txOrDb
      .select({
        count: sql<number>`COUNT(DISTINCT ${schema.payments.order_id})::int`,
      })
      .from(schema.payments)
      .where(validPayment),
  ]);

  let cash_sales = 0;
  let non_cash_sales = 0;
  let tips_total = 0;
  let cash_tips = 0;
  let payment_count = 0;

  const by_method: CashMethodTotal[] = byMethod.map((row) => {
    const total = Number(row.total ?? 0);
    const tips = Number(row.tips ?? 0);
    const count = Number(row.count ?? 0);
    if (row.method === "cash") {
      cash_sales += total;
      cash_tips += tips;
    } else {
      non_cash_sales += total;
    }
    tips_total += tips;
    payment_count += count;
    return { method: row.method as string, total, tips, count };
  });

  // Orden estable: el efectivo primero (es lo que se cuenta), luego por importe.
  by_method.sort((a, b) => {
    if (a.method === "cash") return -1;
    if (b.method === "cash") return 1;
    return b.total - a.total;
  });

  return {
    by_method,
    cash_sales,
    non_cash_sales,
    total_sales: cash_sales + non_cash_sales,
    tips_total,
    cash_tips,
    payment_count,
    order_count: Number(orders?.count ?? 0),
    voided_total: Number(voided?.total ?? 0),
    voided_count: Number(voided?.count ?? 0),
    expected_cash: params.openingFloat + cash_sales,
    expected_cash_with_tips: params.openingFloat + cash_sales + cash_tips,
  };
}

/** Nombres de quien abrió y quien cerró, para no repetir el join en cada camino. */
async function resolveUserNames(
  ids: Array<string | null>,
  txOrDb: DbOrTx = db,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const rows = await txOrDb
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, unique));

  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── Caja actual ─────────────────────────────────────────────────────

/**
 * La caja abierta de la sede con sus totales en vivo, o `null` si no hay
 * ninguna abierta (estado perfectamente normal: local cerrado o turno sin caja).
 */
export async function getCurrentCashSession(params: {
  organizationId: string;
  branchId: string;
}): Promise<CashSessionWithTotals | null> {
  const [row] = await db
    .select({
      session: schema.cashSessions,
      opened_by_name: openerUser.name,
      closed_by_name: closerUser.name,
    })
    .from(schema.cashSessions)
    .leftJoin(openerUser, eq(schema.cashSessions.opened_by, openerUser.id))
    .leftJoin(closerUser, eq(schema.cashSessions.closed_by, closerUser.id))
    .where(
      and(
        eq(schema.cashSessions.organization_id, params.organizationId),
        eq(schema.cashSessions.branch_id, params.branchId),
        eq(schema.cashSessions.status, "open"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const totals = await getCashBreakdown({
    cashSessionId: row.session.id,
    openingFloat: row.session.opening_float,
    organizationId: params.organizationId,
    branchId: params.branchId,
  });

  return {
    ...row.session,
    opened_by_name: row.opened_by_name,
    closed_by_name: row.closed_by_name,
    totals,
  };
}

// ── Apertura ────────────────────────────────────────────────────────

/**
 * Abre la caja de la sede.
 *
 * No se comprueba "¿ya hay una abierta?" antes de insertar: esa comprobación es
 * una carrera. Se intenta insertar y se deja que el índice único parcial de la
 * BD decida; si choca, se recupera la caja existente solo para dar un mensaje
 * útil.
 */
export async function openCashSession(params: {
  organizationId: string;
  branchId: string;
  userId: string | null;
  openingFloat: number;
  openingNotes?: string | null;
  /** Solo para pruebas/backfill: por defecto, el día civil de Lima de hoy. */
  businessDate?: string;
}): Promise<CashSessionWithTotals> {
  const business_date = params.businessDate ?? peruCivilDate();

  let session: CashSessionRow;
  try {
    const [inserted] = await db
      .insert(schema.cashSessions)
      .values({
        organization_id: params.organizationId,
        branch_id: params.branchId,
        opened_by: params.userId,
        business_date,
        opening_float: params.openingFloat,
        opening_notes: params.openingNotes ?? null,
        status: "open",
      })
      .returning();
    session = inserted!;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const existing = await findOpenCashSession({
      organizationId: params.organizationId,
      branchId: params.branchId,
    });
    throw new CashSessionError(
      "CASH_SESSION_ALREADY_OPEN",
      "Ya hay una caja abierta en esta sede. Ciérrala antes de abrir otra.",
      409,
      existing ? { cash_session_id: existing.id, opened_at: existing.opened_at } : undefined,
    );
  }

  const names = await resolveUserNames([session.opened_by]);

  return {
    ...session,
    opened_by_name: session.opened_by ? (names.get(session.opened_by) ?? null) : null,
    closed_by_name: null,
    totals: await getCashBreakdown({
      cashSessionId: session.id,
      openingFloat: session.opening_float,
      organizationId: params.organizationId,
      branchId: params.branchId,
    }),
  };
}

// ── Cierre ──────────────────────────────────────────────────────────

/**
 * Cierra la caja abierta de la sede.
 *
 * Todo ocurre en una transacción que empieza bloqueando la fila de la caja
 * (`SELECT ... FOR UPDATE`): dos cierres simultáneos se serializan y el segundo
 * ve la caja ya cerrada en vez de escribir un arqueo encima del otro.
 *
 * `expected_cash` = fondo inicial + cobros en efectivo válidos.
 * `difference`    = contado − esperado. Negativo = FALTANTE.
 *
 * LÍMITE CONOCIDO: el `FOR UPDATE` solo serializa contra quien también bloquee
 * esa fila. Hoy `routes/payments.ts` lee la caja abierta SIN bloqueo (su propio
 * helper `findOpenCashSessionId`), así que un cobro en vuelo puede confirmarse
 * después de calcular el esperado y quedar contado en la caja pero fuera del
 * arqueo. La red de seguridad es `getCashSessionById`, que recalcula y marca
 * `recalculated: true`. El arreglo definitivo es que la ruta de cobros llame a
 * `findOpenCashSession({ ..., lock: "share" }, tx)` dentro de su transacción.
 */
export async function closeCashSession(params: {
  organizationId: string;
  branchId: string;
  userId: string | null;
  countedCash: number;
  closingNotes?: string | null;
}): Promise<{ before: CashSessionRow; session: CashSessionWithTotals }> {
  const { before, updated, totals } = await db.transaction(async (tx) => {
    const open = await findOpenCashSession(
      {
        organizationId: params.organizationId,
        branchId: params.branchId,
        lock: "update",
      },
      tx,
    );

    if (!open) {
      throw new CashSessionError(
        "NO_OPEN_CASH_SESSION",
        "No hay ninguna caja abierta en esta sede.",
        409,
      );
    }

    const totals = await getCashBreakdown(
      {
        cashSessionId: open.id,
        openingFloat: open.opening_float,
        organizationId: params.organizationId,
        branchId: params.branchId,
      },
      tx,
    );

    const expected_cash = totals.expected_cash;
    const difference = params.countedCash - expected_cash;

    // El compare-and-swap sobre status='open' es redundante teniendo el FOR
    // UPDATE, pero es barato y protege ante cualquier camino futuro que cierre
    // sin bloquear.
    const [updated] = await tx
      .update(schema.cashSessions)
      .set({
        counted_cash: params.countedCash,
        expected_cash,
        difference,
        closing_notes: params.closingNotes ?? null,
        closed_by: params.userId,
        closed_at: new Date(),
        status: "closed",
      })
      .where(
        and(
          eq(schema.cashSessions.id, open.id),
          eq(schema.cashSessions.organization_id, params.organizationId),
          eq(schema.cashSessions.branch_id, params.branchId),
          eq(schema.cashSessions.status, "open"),
        ),
      )
      .returning();

    if (!updated) {
      throw new CashSessionError(
        "NO_OPEN_CASH_SESSION",
        "La caja fue cerrada por otra operación mientras se procesaba el cierre.",
        409,
      );
    }

    return { before: open, updated, totals };
  });

  // Los nombres se resuelven fuera de la transacción: no son dinero y no deben
  // alargar el bloqueo de la fila de caja ni un milisegundo de más.
  const names = await resolveUserNames([updated.opened_by, updated.closed_by]);

  return {
    before,
    session: {
      ...updated,
      opened_by_name: updated.opened_by ? (names.get(updated.opened_by) ?? null) : null,
      closed_by_name: updated.closed_by ? (names.get(updated.closed_by) ?? null) : null,
      totals,
    },
  };
}

// ── Detalle ─────────────────────────────────────────────────────────

/**
 * Detalle de un arqueo con su desglose.
 *
 * El desglose se RECALCULA en el momento. Para una caja cerrada normalmente
 * coincide con lo guardado; si no coincide es porque se anuló un cobro después
 * del cierre, y eso es justo lo que hay que poder ver. Por eso se devuelven las
 * dos cifras (`expected_cash` guardado en la fila y `totals.expected_cash`
 * recalculado) junto a `recalculated` para señalar la discrepancia.
 */
export async function getCashSessionById(params: {
  organizationId: string;
  branchId: string;
  id: string;
}): Promise<CashSessionWithTotals & { recalculated: boolean }> {
  const [row] = await db
    .select({
      session: schema.cashSessions,
      opened_by_name: openerUser.name,
      closed_by_name: closerUser.name,
    })
    .from(schema.cashSessions)
    .leftJoin(openerUser, eq(schema.cashSessions.opened_by, openerUser.id))
    .leftJoin(closerUser, eq(schema.cashSessions.closed_by, closerUser.id))
    .where(
      and(
        eq(schema.cashSessions.id, params.id),
        eq(schema.cashSessions.organization_id, params.organizationId),
        eq(schema.cashSessions.branch_id, params.branchId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new CashSessionError("CASH_SESSION_NOT_FOUND", "Arqueo no encontrado", 404);
  }

  const totals = await getCashBreakdown({
    cashSessionId: row.session.id,
    openingFloat: row.session.opening_float,
    organizationId: params.organizationId,
    branchId: params.branchId,
  });

  const recalculated =
    row.session.expected_cash !== null && row.session.expected_cash !== totals.expected_cash;

  return {
    ...row.session,
    opened_by_name: row.opened_by_name,
    closed_by_name: row.closed_by_name,
    totals,
    recalculated,
  };
}

// ── Historial ───────────────────────────────────────────────────────

export interface CashSessionListItem extends CashSessionRow {
  opened_by_name: string | null;
  closed_by_name: string | null;
  cash_sales: number;
  total_sales: number;
  payment_count: number;
}

/**
 * Historial paginado de arqueos de la sede.
 *
 * El filtro va contra `business_date`, que YA es una fecha civil peruana
 * ("YYYY-MM-DD") sellada con `peruCivilDate()` al abrir. Comparar cadenas es
 * exacto aquí y evita la trampa de convertir la fecha del usuario a un instante:
 * una caja abierta a las 23:40 pertenece a SU día operativo, no al siguiente día
 * UTC.
 *
 * Los totales por fila se resuelven con subconsultas correlacionadas para no
 * caer en N+1 al pintar la tabla.
 */
export async function listCashSessions(params: {
  organizationId: string;
  branchId: string;
  from?: string;
  to?: string;
  status?: "open" | "closed";
  page: number;
  limit: number;
}): Promise<{
  data: CashSessionListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const conditions = [
    eq(schema.cashSessions.organization_id, params.organizationId),
    eq(schema.cashSessions.branch_id, params.branchId),
  ];

  if (params.from) conditions.push(gte(schema.cashSessions.business_date, params.from));
  if (params.to) conditions.push(lte(schema.cashSessions.business_date, params.to));
  if (params.status) conditions.push(eq(schema.cashSessions.status, params.status));

  const whereClause = and(...conditions);
  const offset = (params.page - 1) * params.limit;

  // La correlación amarra el cobro a la caja Y a su mismo tenant: comparando
  // contra las columnas de la fila externa no hace falta enlazar parámetros ni
  // castear uuid, y ninguna suma puede cruzar sede.
  const validPaymentSql = sql`
    ${schema.payments.cash_session_id} = ${schema.cashSessions.id}
    AND ${schema.payments.organization_id} = ${schema.cashSessions.organization_id}
    AND ${schema.payments.branch_id} = ${schema.cashSessions.branch_id}
    AND ${schema.payments.status} = 'completed'
    AND ${schema.payments.voided_at} IS NULL
  `;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        session: schema.cashSessions,
        opened_by_name: openerUser.name,
        closed_by_name: closerUser.name,
        cash_sales: sql<number>`COALESCE((
          SELECT SUM(${schema.payments.amount})::int FROM ${schema.payments}
          WHERE ${validPaymentSql} AND ${schema.payments.method} = 'cash'
        ), 0)`,
        total_sales: sql<number>`COALESCE((
          SELECT SUM(${schema.payments.amount})::int FROM ${schema.payments}
          WHERE ${validPaymentSql}
        ), 0)`,
        payment_count: sql<number>`(
          SELECT COUNT(*)::int FROM ${schema.payments}
          WHERE ${validPaymentSql}
        )`,
      })
      .from(schema.cashSessions)
      .leftJoin(openerUser, eq(schema.cashSessions.opened_by, openerUser.id))
      .leftJoin(closerUser, eq(schema.cashSessions.closed_by, closerUser.id))
      .where(whereClause)
      .orderBy(desc(schema.cashSessions.opened_at))
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.cashSessions)
      .where(whereClause),
  ]);

  const total = Number(counted?.count ?? 0);

  return {
    data: rows.map((row) => ({
      ...row.session,
      opened_by_name: row.opened_by_name,
      closed_by_name: row.closed_by_name,
      cash_sales: Number(row.cash_sales ?? 0),
      total_sales: Number(row.total_sales ?? 0),
      payment_count: Number(row.payment_count ?? 0),
    })),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      // Math.ceil pelado, igual que orders/loyalty/audit: 0 resultados = 0 páginas.
      totalPages: Math.ceil(total / params.limit),
    },
  };
}
