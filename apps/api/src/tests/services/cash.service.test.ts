import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestBranch, createTestOrder, cleanup } from "../setup";
import {
  openCashSession,
  closeCashSession,
  getCurrentCashSession,
  getCashSessionById,
  findOpenCashSession,
  CashSessionError,
} from "../../services/cash.service";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";

/**
 * Arqueo de caja.
 *
 * Es el módulo que decide si un local puede cuadrar su dinero al cerrar el
 * turno, así que lo que se prueba aquí es el DINERO: qué entra en el efectivo
 * esperado, qué no, y qué pasa cuando dos personas hacen algo a la vez.
 */
describe("cash.service", () => {
  let orgId: string;
  let branchId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  /** Registra un cobro ya confirmado sobre una orden nueva. */
  async function registerPayment(opts: {
    amount: number;
    method?: "cash" | "card" | "yape";
    cashSessionId?: string | null;
    voided?: boolean;
    tip?: number;
  }) {
    const order = await createTestOrder(orgId, branchId, { total: opts.amount });
    const [payment] = await db
      .insert(schema.payments)
      .values({
        order_id: order.id,
        organization_id: orgId,
        branch_id: branchId,
        method: opts.method ?? "cash",
        amount: opts.amount,
        tip: opts.tip ?? 0,
        status: "completed",
        cash_session_id: opts.cashSessionId ?? null,
        ...(opts.voided
          ? { voided_at: new Date(), void_reason: "prueba de anulación" }
          : {}),
      })
      .returning();
    return payment;
  }

  it("abre caja con el fondo inicial y sin ventas", async () => {
    const session = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 10_000, // S/ 100.00
    });

    expect(session.status).toBe("open");
    expect(session.opening_float).toBe(10_000);
    // Sin cobros, el efectivo esperado es exactamente el fondo.
    expect(session.totals.expected_cash).toBe(10_000);
    expect(session.totals.total_sales).toBe(0);

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
  });

  it("impide dos cajas abiertas en la misma sede", async () => {
    const first = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 0,
    });

    let error: any = null;
    try {
      await openCashSession({
        organizationId: orgId,
        branchId,
        userId: null,
        openingFloat: 5_000,
      });
    } catch (e) {
      error = e;
    }

    // Lo garantiza el índice único parcial de la BD, no una comprobación previa
    // (que sería vulnerable a carrera entre el SELECT y el INSERT).
    expect(error).toBeInstanceOf(CashSessionError);
    expect(error.code).toBe("CASH_SESSION_ALREADY_OPEN");

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, first.id));
  });

  it("el efectivo esperado suma solo los cobros en efectivo NO anulados", async () => {
    const session = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 2_000, // S/ 20.00 de fondo
    });

    await registerPayment({ amount: 5_000, method: "cash", cashSessionId: session.id });
    await registerPayment({ amount: 3_000, method: "cash", cashSessionId: session.id });
    // La tarjeta vende, pero NO entra en el cajón.
    await registerPayment({ amount: 9_900, method: "card", cashSessionId: session.id });
    // Un cobro anulado no es dinero: la deuda sigue viva.
    await registerPayment({ amount: 4_000, method: "cash", cashSessionId: session.id, voided: true });

    const current = await getCurrentCashSession({ organizationId: orgId, branchId });
    expect(current).not.toBeNull();

    const t = current!.totals;
    expect(t.cash_sales).toBe(8_000);
    expect(t.non_cash_sales).toBe(9_900);
    expect(t.total_sales).toBe(17_900);
    expect(t.expected_cash).toBe(10_000); // 2 000 de fondo + 8 000 en efectivo
    expect(t.voided_total).toBe(4_000);
    expect(t.voided_count).toBe(1);

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
  });

  it("cierra la caja y calcula la diferencia (faltante y sobrante)", async () => {
    const session = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 1_000,
    });
    await registerPayment({ amount: 6_000, method: "cash", cashSessionId: session.id });

    // Esperado = 1 000 + 6 000 = 7 000. Se cuentan 6 500: faltan 500.
    const { session: closed } = await closeCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      countedCash: 6_500,
      closingNotes: "faltó vuelto",
    });

    expect(closed.status).toBe("closed");
    expect(closed.expected_cash).toBe(7_000);
    expect(closed.counted_cash).toBe(6_500);
    expect(closed.difference).toBe(-500); // negativo = faltante

    // Cerrada la caja, ya no hay ninguna abierta en la sede.
    const current = await getCurrentCashSession({ organizationId: orgId, branchId });
    expect(current).toBeNull();

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
  });

  it("cerrar sin caja abierta falla con NO_OPEN_CASH_SESSION", async () => {
    let error: any = null;
    try {
      await closeCashSession({
        organizationId: orgId,
        branchId,
        userId: null,
        countedCash: 0,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CashSessionError);
    expect(error.code).toBe("NO_OPEN_CASH_SESSION");
  });

  it("marca recalculated cuando se anula un cobro DESPUÉS del cierre", async () => {
    const session = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 0,
    });
    const payment = await registerPayment({
      amount: 5_000,
      method: "cash",
      cashSessionId: session.id,
    });

    await closeCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      countedCash: 5_000,
    });

    // Alguien anula el cobro al día siguiente: el arqueo guardado deja de cuadrar
    // con la realidad. La red de seguridad contable es avisar, no reescribirlo.
    await db
      .update(schema.payments)
      .set({ voided_at: new Date(), void_reason: "anulado tras el cierre", status: "refunded" })
      .where(eq(schema.payments.id, payment.id));

    const detail = await getCashSessionById({ organizationId: orgId, branchId, id: session.id });
    expect(detail).not.toBeNull();
    expect(detail!.recalculated).toBe(true);

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
  });

  it("findOpenCashSession acota por sede", async () => {
    const otherBranch = await createTestBranch(orgId);
    const session = await openCashSession({
      organizationId: orgId,
      branchId,
      userId: null,
      openingFloat: 0,
    });

    expect((await findOpenCashSession({ organizationId: orgId, branchId }))?.id).toBe(session.id);
    // La caja de una sede no puede verse desde otra.
    expect(
      await findOpenCashSession({ organizationId: orgId, branchId: otherBranch.id }),
    ).toBeNull();

    await db.delete(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
  });
});
