import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  cleanup,
} from "../setup";

/**
 * Reordenar la carta.
 *
 * El orden de la carta es una decisión comercial: el plato que va primero se
 * vende más. Lo que se comprueba aquí es que arrastrar escribe EXACTAMENTE lo
 * que se arrastró, que dos personas moviendo a la vez no dejan la carta a
 * medias, y que nadie puede reordenar la carta de otro restaurante.
 */
describe("routes/menu — reordenar", () => {
  let orgId: string;
  let branchId: string;
  let otraOrgId: string;
  let otraSedeId: string;
  let categoryId: string;
  let token: string;

  async function crearUsuario(organizationId: string, branchIds: string[]) {
    const [user] = await db
      .insert(schema.users)
      .values({
        organization_id: organizationId,
        email: `reorder_${Date.now()}_${Math.round(Math.random() * 1e6)}@test.local`,
        password_hash: "x",
        name: "Admin de prueba",
        role: "org_admin",
      })
      .returning();

    for (const b of branchIds) {
      await db.insert(schema.userBranches).values({ user_id: user.id, branch_id: b });
    }

    return signAccessToken({
      sub: user.id,
      org: organizationId,
      role: "org_admin",
      branches: branchIds,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;

    const otraOrg = await createTestOrg();
    otraOrgId = otraOrg.id;
    const otraSede = await createTestBranch(otraOrgId);
    otraSedeId = otraSede.id;

    const category = await createTestCategory(branchId, orgId);
    categoryId = category.id;

    token = await crearUsuario(orgId, [branchId]);
  });

  afterAll(async () => {
    await cleanup([orgId, otraOrgId]);
  });

  function pedir(ruta: string, cuerpo: unknown) {
    return app.request(`/api/menu${ruta}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-branch-id": branchId,
      },
      body: JSON.stringify(cuerpo),
    });
  }

  async function idsEnOrden() {
    const filas = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.category_id, categoryId))
      .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.name));
    return filas.map((f) => f.id);
  }

  it("un producto nuevo va al FINAL de su categoría, no al principio", async () => {
    // Con `.default(0)` en el validador, todo lo creado nacía en la posición 0
    // y se colaba delante del plato estrella sin que nadie lo pidiera.
    const crear = (name: string) =>
      app.request("/api/menu/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-branch-id": branchId,
        },
        body: JSON.stringify({ categoryId, name, price: 1000 }),
      });

    const r1 = await crear("Primero");
    const r2 = await crear("Segundo");
    const r3 = await crear("Tercero");
    expect(r1.status).toBe(201);

    const posiciones = [r1, r2, r3];
    const cuerpos = await Promise.all(posiciones.map((r) => r.json() as Promise<any>));
    expect(cuerpos.map((b) => b.data.sort_order)).toEqual([0, 1, 2]);
  });

  it("reordenar escribe exactamente el orden enviado", async () => {
    const antes = await idsEnOrden();
    expect(antes.length).toBe(3);

    const alReves = [...antes].reverse();
    const res = await pedir("/items/reorder", { categoryId, ids: alReves });
    expect(res.status).toBe(200);

    expect(await idsEnOrden()).toEqual(alReves);
  });

  it("rechaza con 409 si la lista está desfasada", async () => {
    // Alguien creó un plato mientras el otro arrastraba. Escribir de todas
    // formas colocaría el plato nuevo en un sitio que nadie eligió.
    const actuales = await idsEnOrden();
    const res = await pedir("/items/reorder", { categoryId, ids: actuales.slice(0, 2) });

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("CONFLICT");

    // Y no se ha tocado nada.
    expect(await idsEnOrden()).toEqual(actuales);
  });

  it("rechaza un id que no es de esta categoría", async () => {
    const otraCategoria = await createTestCategory(branchId, orgId);
    const ajeno = await createTestMenuItem(branchId, orgId, otraCategoria.id, {
      name: "De otra categoría",
      price: 500,
    });

    const actuales = await idsEnOrden();
    const res = await pedir("/items/reorder", {
      categoryId,
      ids: [...actuales.slice(1), ajeno.id],
    });

    expect(res.status).toBe(409);
    expect(await idsEnOrden()).toEqual(actuales);
  });

  it("no se puede reordenar la carta de otra sede", async () => {
    const res = await app.request("/api/menu/items/reorder", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // Cabecera de una sede de OTRA organización.
        "x-branch-id": otraSedeId,
      },
      body: JSON.stringify({ categoryId, ids: await idsEnOrden() }),
    });

    // El middleware de tenant corta antes: el usuario no es miembro de esa sede.
    expect([403, 404]).toContain(res.status);
  });

  it("las categorías se reordenan y el listado las devuelve así", async () => {
    const leer = async () => {
      const res = await app.request("/api/menu/categories", {
        headers: { Authorization: `Bearer ${token}`, "x-branch-id": branchId },
      });
      const body = (await res.json()) as any;
      return body.data.map((c: any) => c.id);
    };

    const antes = await leer();
    expect(antes.length).toBeGreaterThanOrEqual(2);

    const alReves = [...antes].reverse();
    const res = await pedir("/categories/reorder", { ids: alReves });
    expect(res.status).toBe(200);

    // Sin `.orderBy` en GET /categories esto pasaría a veces y fallaría a veces.
    expect(await leer()).toEqual(alReves);
  });

  it("las opciones de un grupo se reordenan dentro de su grupo", async () => {
    const [grupo] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: branchId,
        organization_id: orgId,
        name: "Nivel de ají",
        min_selections: 1,
        max_selections: 1,
        is_required: true,
      })
      .returning();

    const nombres = ["Sin ají", "Suave", "Picante", "Bien picante"];
    const creadas: string[] = [];
    for (const name of nombres) {
      const res = await app.request("/api/menu/modifiers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-branch-id": branchId,
        },
        body: JSON.stringify({ groupId: grupo.id, name, price: 0 }),
      });
      const body = (await res.json()) as any;
      creadas.push(body.data.id);
    }

    const leer = async () => {
      const filas = await db
        .select({ id: schema.modifiers.id })
        .from(schema.modifiers)
        .where(eq(schema.modifiers.group_id, grupo.id))
        .orderBy(asc(schema.modifiers.sort_order));
      return filas.map((f) => f.id);
    };

    // Una escala se crea en orden y debe conservarlo.
    expect(await leer()).toEqual(creadas);

    const alReves = [...creadas].reverse();
    const res = await pedir(`/modifier-groups/${grupo.id}/modifiers/reorder`, {
      ids: alReves,
    });
    expect(res.status).toBe(200);
    expect(await leer()).toEqual(alReves);
  });
});
