import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { app } from "../../app";
import { signCustomerToken } from "../../lib/jwt";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  createTestTable,
  cleanup,
} from "../setup";

/**
 * Carta estática: el QR sirve para LEER, no para pedir.
 *
 * Lo que se comprueba aquí es que el modo es una regla del SERVIDOR y no una
 * decoración de la pantalla. Si solo fuera pantalla, un enlace guardado en el
 * navegador o un token de una visita anterior seguirían metiendo comandas en un
 * local que ya no las espera, y nadie se enteraría hasta que salga un plato que
 * nadie pidió.
 */
describe("routes/customer — carta estática", () => {
  let orgId: string;
  let branchId: string;
  let publicCode: string;
  let slug: string;
  let qrCode: string;
  let tokenComensal: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;

    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    publicCode = branch.public_code;
    slug = branch.slug;

    const category = await createTestCategory(branchId, orgId);
    await createTestMenuItem(branchId, orgId, category.id, {
      name: "Ceviche de prueba",
      price: 3500,
    });

    const table = await createTestTable(branchId, orgId, 3);
    qrCode = table.qr_code;

    // Una visita que YA estaba abierta cuando el dueño cambia de modo.
    const [session] = await db
      .insert(schema.tableSessions)
      .values({
        table_id: table.id,
        branch_id: branchId,
        organization_id: orgId,
        customer_name: "Comensal de prueba",
        token: "test-session-token",
        status: "active",
      })
      .returning();

    tokenComensal = await signCustomerToken({
      sub: session.id,
      org: orgId,
      branch: branchId,
      table: table.id,
    });
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  async function ponerModo(modo: "static" | "dynamic") {
    await db
      .update(schema.branches)
      .set({ menu_mode: modo })
      .where(eq(schema.branches.id, branchId));
  }

  it("una sede nace en modo dinámico", async () => {
    const [fila] = await db
      .select({ menu_mode: schema.branches.menu_mode })
      .from(schema.branches)
      .where(eq(schema.branches.id, branchId))
      .limit(1);
    expect(fila.menu_mode).toBe("dynamic");
  });

  it("la carta de sede se sirve sin mesa y sin token", async () => {
    const res = await app.request(`/api/customer/carta/${publicCode}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.branch.id).toBe(branchId);
    expect(body.data.items.length).toBeGreaterThan(0);
    // Sin mesa: la respuesta no puede inventarse una.
    expect(body.data.table).toBeUndefined();
  });

  it("la carta de sede tolera el código en minúsculas y con guiones", async () => {
    const sucio = publicCode.toLowerCase().split("").join("-");
    const res = await app.request(`/api/customer/carta/${sucio}`);
    expect(res.status).toBe(200);
  });

  it("un código público inexistente da 404, no la carta de otro", async () => {
    const res = await app.request("/api/customer/carta/ZZZZZZ");
    expect(res.status).toBe(404);
  });

  it("en modo estático NO se puede abrir una visita nueva", async () => {
    await ponerModo("static");

    const res = await app.request(`/api/customer/${slug}/${qrCode}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: "Quien sea" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("STATIC_MENU");
  });

  it("en modo estático NO se puede pedir ni con un token que ya existía", async () => {
    // Este es el caso que una comprobación de pantalla no cubre: el navegador
    // guardó el token antes del cambio de modo y lo sigue mandando.
    await ponerModo("static");

    const res = await app.request("/api/customer/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenComensal}`,
      },
      body: JSON.stringify({ items: [], type: "dine_in" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("STATIC_MENU");
  });

  it("en modo estático tampoco se llama al mozo desde el móvil", async () => {
    await ponerModo("static");

    const res = await app.request("/api/customer/table-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenComensal}`,
      },
      body: JSON.stringify({ action: "call_waiter", tableSessionId: "x" }),
    });

    expect(res.status).toBe(409);
  });

  it("en modo estático la carta de la MESA se sigue sirviendo", async () => {
    // El QR pegado en la mesa no deja de funcionar: solo deja de admitir
    // pedidos. Si devolviera 404 habría que reimprimir carteles al cambiar.
    await ponerModo("static");

    const res = await app.request(`/api/customer/${slug}/${qrCode}/menu`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.data.branch.menu_mode).toBe("static");
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it("al volver a dinámico se puede abrir una visita otra vez", async () => {
    await ponerModo("dynamic");

    const res = await app.request(`/api/customer/${slug}/${qrCode}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: "Quien sea" }),
    });

    // La mesa ya tiene una sesión activa de este archivo, así que lo correcto
    // es "ocupada" (409 TABLE_OCCUPIED) y NO el bloqueo por carta estática.
    const body = (await res.json()) as any;
    expect(body.error?.code).not.toBe("STATIC_MENU");
  });
});
