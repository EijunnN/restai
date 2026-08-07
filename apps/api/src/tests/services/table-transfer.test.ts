import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestOrg,
  createTestBranch,
  createTestTable,
  createTestOrder,
  cleanup,
} from "../setup";
import {
  createSession,
  freeTable,
  moveSession,
  mergeSessions,
  TableHasBalanceError,
} from "../../services/session.service";
import { db, schema } from "@restai/db";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Sala: liberar, mover y juntar mesas.
 *
 * Aquí se prueba lo que un mozo hace veinte veces por servicio y que hasta ahora
 * o no existía (mover/juntar) o convertía impagos en ventas cerradas (liberar).
 */
describe("session.service — transferencias de mesa", () => {
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

  let tableSeq = 100;
  const nextTable = () => createTestTable(branchId, orgId, tableSeq++);

  async function seatWithOrder(total: number) {
    const table = await nextTable();
    const session = await createSession({
      tableId: table.id,
      branchId,
      organizationId: orgId,
      customerName: `Mesa ${table.number}`,
      token: `tok_${table.id}`,
      status: "active",
    });
    await db
      .update(schema.tables)
      .set({ status: "occupied" })
      .where(eq(schema.tables.id, table.id));
    const order = await createTestOrder(orgId, branchId, {
      table_session_id: session.id,
      status: "completed",
      subtotal: total,
      total,
    });
    return { table, session, order };
  }

  it("liberar una mesa con cuenta pendiente falla con TABLE_HAS_BALANCE", async () => {
    const { table } = await seatWithOrder(5_000);

    let error: any = null;
    try {
      await freeTable({ tableId: table.id, branchId, organizationId: orgId });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TableHasBalanceError);
    expect(error.pendingAmount).toBe(5_000);

    // La mesa NO se liberó: sigue ocupada.
    const [after] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, table.id));
    expect(after.status).toBe("occupied");
  });

  it("liberar con force perdona el saldo y deja la mesa disponible", async () => {
    const { table } = await seatWithOrder(3_000);

    const result = await freeTable({
      tableId: table.id,
      branchId,
      organizationId: orgId,
      force: true,
    });
    expect(result.tableId).toBe(table.id);

    const [after] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, table.id));
    expect(after.status).toBe("available");
  });

  it("liberar una mesa saldada funciona sin force", async () => {
    const { table, order } = await seatWithOrder(4_000);
    await db.insert(schema.payments).values({
      order_id: order.id,
      organization_id: orgId,
      branch_id: branchId,
      method: "cash",
      amount: 4_000,
      status: "completed",
    });

    await freeTable({ tableId: table.id, branchId, organizationId: orgId });

    const [after] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, table.id));
    expect(after.status).toBe("available");
  });

  it("mover la cuenta a otra mesa arrastra las órdenes y libera el origen", async () => {
    const { table: origen, session, order } = await seatWithOrder(2_500);
    const destino = await nextTable();

    await moveSession({
      tableId: origen.id,
      targetTableId: destino.id,
      branchId,
      organizationId: orgId,
    });

    // La sesión ahora cuelga de la mesa destino...
    const [movedSession] = await db
      .select({ table_id: schema.tableSessions.table_id })
      .from(schema.tableSessions)
      .where(eq(schema.tableSessions.id, session.id));
    expect(movedSession.table_id).toBe(destino.id);

    // ...la orden sigue ligada a esa misma sesión (el importe no se toca)...
    const [movedOrder] = await db
      .select({ table_session_id: schema.orders.table_session_id, total: schema.orders.total })
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));
    expect(movedOrder.table_session_id).toBe(session.id);
    expect(movedOrder.total).toBe(2_500);

    // ...y las mesas quedan con el estado correcto.
    const [origenAfter] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, origen.id));
    const [destinoAfter] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, destino.id));
    expect(origenAfter.status).toBe("available");
    expect(destinoAfter.status).toBe("occupied");
  });

  it("mover a la misma mesa se rechaza", async () => {
    const { table } = await seatWithOrder(1_000);
    await expect(
      moveSession({
        tableId: table.id,
        targetTableId: table.id,
        branchId,
        organizationId: orgId,
      }),
    ).rejects.toThrow();
  });

  it("liberar la mesa cancela los avisos vivos, para no silenciar al siguiente comensal", async () => {
    const { table, session, order } = await seatWithOrder(1_200);
    await db.insert(schema.payments).values({
      order_id: order.id,
      organization_id: orgId,
      branch_id: branchId,
      method: "cash",
      amount: 1_200,
      status: "completed",
    });

    // El comensal llama al mozo y nadie llega a atenderle antes del cierre.
    await db.insert(schema.serviceRequests).values({
      organization_id: orgId,
      branch_id: branchId,
      table_id: table.id,
      table_session_id: session.id,
      type: "call_waiter",
      status: "pending",
    });

    await freeTable({ tableId: table.id, branchId, organizationId: orgId });

    const vivos = await db
      .select({ id: schema.serviceRequests.id, status: schema.serviceRequests.status })
      .from(schema.serviceRequests)
      .where(
        and(
          eq(schema.serviceRequests.table_id, table.id),
          inArray(schema.serviceRequests.status, ["pending", "acknowledged"]),
        ),
      );

    // Ninguno vivo: si quedara, el índice único parcial (1 pendiente por mesa y
    // tipo) haría que la llamada del SIGUIENTE comensal se descartara como
    // duplicada y su mesa quedaría muda.
    expect(vivos).toHaveLength(0);

    // Y en efecto, el siguiente comensal puede volver a avisar.
    const [nuevo] = await db
      .insert(schema.serviceRequests)
      .values({
        organization_id: orgId,
        branch_id: branchId,
        table_id: table.id,
        type: "call_waiter",
        status: "pending",
      })
      .returning();
    expect(nuevo.id).toBeDefined();
  });

  it("juntar mesas reasigna las órdenes a la sesión destino y cierra las de origen", async () => {
    const destino = await seatWithOrder(6_000);
    const origenA = await seatWithOrder(1_500);
    const origenB = await seatWithOrder(2_000);

    await mergeSessions({
      tableId: destino.table.id,
      sourceTableIds: [origenA.table.id, origenB.table.id],
      branchId,
      organizationId: orgId,
    });

    // Las órdenes de las mesas de origen cuelgan ahora de la sesión destino:
    // la cuenta del grupo queda unificada, que es justo lo que pide el cliente
    // cuando dos mesas se juntan a mitad de servicio.
    for (const origen of [origenA, origenB]) {
      const [order] = await db
        .select({ table_session_id: schema.orders.table_session_id })
        .from(schema.orders)
        .where(eq(schema.orders.id, origen.order.id));
      expect(order.table_session_id).toBe(destino.session.id);

      const [closed] = await db
        .select({ status: schema.tableSessions.status })
        .from(schema.tableSessions)
        .where(eq(schema.tableSessions.id, origen.session.id));
      expect(closed.status).toBe("completed");

      const [freed] = await db
        .select({ status: schema.tables.status })
        .from(schema.tables)
        .where(eq(schema.tables.id, origen.table.id));
      expect(freed.status).toBe("available");
    }

    // La mesa destino sigue ocupada con su visita viva.
    const [destinoAfter] = await db
      .select({ status: schema.tables.status })
      .from(schema.tables)
      .where(eq(schema.tables.id, destino.table.id));
    expect(destinoAfter.status).toBe("occupied");
  });
});
