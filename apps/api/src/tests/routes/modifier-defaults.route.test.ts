import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import { createTestOrg, createTestBranch, cleanup } from "../setup";

/**
 * Lo que el plato lleva "de serie".
 *
 * El punto de venta abre el diálogo de opciones con esto ya marcado, así que si
 * el dato no viaja entero —al crear, al editar y al leerlo desde el POS— el
 * cajero manda a cocina una comanda que dice menos de lo que va a salir.
 */
describe("routes/menu — opciones de serie", () => {
  let orgId: string;
  let branchId: string;
  let grupoId: string;
  let token: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;

    const [user] = await db
      .insert(schema.users)
      .values({
        organization_id: orgId,
        email: `defaults_${Date.now()}@test.local`,
        password_hash: "x",
        name: "Admin de prueba",
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

    const [grupo] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: branchId,
        organization_id: orgId,
        name: "Guarnición",
        min_selections: 0,
        max_selections: 1,
        is_required: false,
      })
      .returning();
    grupoId = grupo.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  function pedir(path: string, method: string, body?: unknown) {
    return app.request(`/api/menu${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-branch-id": branchId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("una opción nace sin ser de serie", async () => {
    const res = await pedir("/modifiers", "POST", { groupId: grupoId, name: "Yuca frita", price: 300 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.is_default).toBe(false);
  });

  it("se puede crear ya marcada de serie", async () => {
    const res = await pedir("/modifiers", "POST", {
      groupId: grupoId,
      name: "Papas fritas",
      price: 0,
      isDefault: true,
    });
    const body = (await res.json()) as any;
    expect(body.data.is_default).toBe(true);
  });

  it("se puede marcar y desmarcar sin tocar el precio", async () => {
    const creada = await pedir("/modifiers", "POST", {
      groupId: grupoId,
      name: "Ensalada fresca",
      price: 250,
    });
    const { data } = (await creada.json()) as any;

    const marcada = await pedir(`/modifiers/${data.id}`, "PATCH", { isDefault: true });
    expect(marcada.status).toBe(200);
    expect(((await marcada.json()) as any).data.is_default).toBe(true);

    const [tras] = await db
      .select()
      .from(schema.modifiers)
      .where(eq(schema.modifiers.id, data.id));
    // El recargo no puede moverse por marcar lo que viene de serie: es lo que
    // separa "cambiar la carta" de "cambiar el precio de la carta".
    expect(tras!.price).toBe(250);

    const desmarcada = await pedir(`/modifiers/${data.id}`, "PATCH", { isDefault: false });
    expect(((await desmarcada.json()) as any).data.is_default).toBe(false);
  });

  it("el POS recibe la marca al leer los grupos del plato", async () => {
    // Es el camino que de verdad usa el diálogo de opciones: si `is_default` no
    // llega hasta aquí, la premarcación no ocurre y nadie se entera.
    const [categoria] = await db
      .insert(schema.menuCategories)
      .values({ branch_id: branchId, organization_id: orgId, name: "Fondos" })
      .returning();
    const [plato] = await db
      .insert(schema.menuItems)
      .values({
        branch_id: branchId,
        organization_id: orgId,
        category_id: categoria.id,
        name: "Pollo a la brasa",
        price: 2600,
      })
      .returning();
    await db
      .insert(schema.menuItemModifierGroups)
      .values({ item_id: plato.id, group_id: grupoId });

    const res = await pedir(`/items/${plato.id}/modifier-groups`, "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const grupo = body.data.find((g: any) => g.id === grupoId);
    const deSerie = grupo.modifiers.filter((m: any) => m.is_default).map((m: any) => m.name);
    expect(deSerie).toEqual(["Papas fritas"]);
  });
});
