import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  createTestOrder,
  cleanup,
} from "../setup";

/**
 * Añadir platos a una cuenta ya abierta.
 *
 * Es el endpoint que hace posible el servicio de salón de verdad —la mesa pide
 * otra ronda sobre la misma cuenta— y toca dinero en cada llamada: si el
 * recálculo se equivoca, el local cobra de menos y no se entera hasta el arqueo.
 */
describe("routes/orders — añadir platos a una cuenta abierta", () => {
  let orgId: string;
  let branchId: string;
  let categoryId: string;
  let platoId: string;
  let agotadoId: string;
  let token: string;

  /** Grupo de modificadores vinculado a OTRO plato, para el caso de inyección. */
  let modificadorAjenoId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const cat = await createTestCategory(branchId, orgId);
    categoryId = cat.id;

    const plato = await createTestMenuItem(branchId, orgId, categoryId, {
      name: "Lomo saltado",
      price: 3800,
    });
    platoId = plato.id;

    const agotado = await createTestMenuItem(branchId, orgId, categoryId, {
      name: "Ceviche del día",
      price: 4200,
      is_available: false,
    });
    agotadoId = agotado.id;

    // Un grupo con su opción, vinculado a un TERCER plato y no al nuestro.
    const otro = await createTestMenuItem(branchId, orgId, categoryId, {
      name: "Pollo a la brasa",
      price: 2600,
    });
    const [grupo] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: branchId,
        organization_id: orgId,
        name: "Presa",
        min_selections: 0,
        max_selections: 1,
        is_required: false,
      })
      .returning();
    const [modificador] = await db
      .insert(schema.modifiers)
      .values({ group_id: grupo.id, name: "Pierna", price: 500 })
      .returning();
    await db
      .insert(schema.menuItemModifierGroups)
      .values({ item_id: otro.id, group_id: grupo.id });
    modificadorAjenoId = modificador.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        organization_id: orgId,
        email: `pos_${Date.now()}@test.local`,
        password_hash: "x",
        name: "Cajera de prueba",
        role: "org_admin",
      })
      .returning();
    await db.insert(schema.userBranches).values({ user_id: user.id, branch_id: branchId });
    token = await signAccessToken({
      sub: user.id,
      org: orgId,
      role: "org_admin",
      branches: [branchId],
    });
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  function anadir(orderId: string, items: unknown) {
    return app.request(`/api/orders/${orderId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-branch-id": branchId,
      },
      body: JSON.stringify({ items }),
    });
  }

  async function lineasDe(orderId: string) {
    return db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.order_id, orderId));
  }

  it("añade la línea y recalcula la cuenta entera", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "preparing" });

    const res = await anadir(orden.id, [{ menuItemId: platoId, quantity: 2, modifiers: [] }]);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.data.subtotal).toBe(7600);
    // IGV del 18 % sobre la base, redondeado a céntimos enteros.
    expect(body.data.tax).toBe(1368);
    expect(body.data.total).toBe(8968);
    expect(body.data.added).toHaveLength(1);
  });

  it("una segunda ronda se suma a la misma cuenta", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "preparing" });

    await anadir(orden.id, [{ menuItemId: platoId, quantity: 1, modifiers: [] }]);
    const res = await anadir(orden.id, [{ menuItemId: platoId, quantity: 1, modifiers: [] }]);
    const body = (await res.json()) as any;

    // Dos líneas separadas, no una fusionada: se pidieron en momentos distintos
    // y la cocina las recibió por separado.
    expect(await lineasDe(orden.id)).toHaveLength(2);
    expect(body.data.subtotal).toBe(7600);
  });

  it("el precio lo pone la carta, no el cliente", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "pending" });

    // Se cuela un precio en el cuerpo: el validador lo ignora y el servidor
    // cobra lo que dice la carta.
    const res = await anadir(orden.id, [
      { menuItemId: platoId, quantity: 1, price: 1, unitPrice: 1, modifiers: [] },
    ]);
    const body = (await res.json()) as any;
    expect(body.data.subtotal).toBe(3800);
  });

  it("rechaza un plato agotado y no inserta nada", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "pending" });

    const res = await anadir(orden.id, [{ menuItemId: agotadoId, quantity: 1, modifiers: [] }]);
    expect(res.status).toBe(400);
    expect(await lineasDe(orden.id)).toHaveLength(0);
  });

  it("rechaza un modificador que no es de ese plato", async () => {
    // Es la inyección que convierte "Lomo saltado" en "Lomo saltado + extra
    // gratis de otro plato": el grupo no está vinculado, así que su precio no
    // debería poder entrar en esta línea.
    const orden = await createTestOrder(orgId, branchId, { status: "pending" });

    const res = await anadir(orden.id, [
      { menuItemId: platoId, quantity: 1, modifiers: [{ modifierId: modificadorAjenoId }] },
    ]);
    expect(res.status).toBe(400);
    expect(await lineasDe(orden.id)).toHaveLength(0);
  });

  it("si una línea del lote falla, no entra NINGUNA", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "pending" });

    const res = await anadir(orden.id, [
      { menuItemId: platoId, quantity: 1, modifiers: [] },
      { menuItemId: agotadoId, quantity: 1, modifiers: [] },
    ]);
    expect(res.status).toBe(400);
    expect(await lineasDe(orden.id)).toHaveLength(0);
  });

  it("una cuenta ya cobrada no admite más platos", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "completed" });

    const res = await anadir(orden.id, [{ menuItemId: platoId, quantity: 1, modifiers: [] }]);
    expect(res.status).toBe(409);

    const body = (await res.json()) as any;
    expect(body.error.message).toContain("cobró");
    expect(await lineasDe(orden.id)).toHaveLength(0);
  });

  it("una cuenta anulada tampoco", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "cancelled" });

    const res = await anadir(orden.id, [{ menuItemId: platoId, quantity: 1, modifiers: [] }]);
    expect(res.status).toBe(409);
    expect(await lineasDe(orden.id)).toHaveLength(0);
  });

  it("no se puede añadir a la cuenta de otra sede", async () => {
    const otraOrg = await createTestOrg();
    const otraSede = await createTestBranch(otraOrg.id);
    const ajena = await createTestOrder(otraOrg.id, otraSede.id, { status: "pending" });

    const res = await anadir(ajena.id, [{ menuItemId: platoId, quantity: 1, modifiers: [] }]);
    expect(res.status).toBe(404);

    await cleanup([otraOrg.id]);
  });

  it("un pedido sin líneas se rechaza en el validador", async () => {
    const orden = await createTestOrder(orgId, branchId, { status: "pending" });
    const res = await anadir(orden.id, []);
    expect(res.status).toBe(400);
  });
});
