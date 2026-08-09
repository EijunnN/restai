import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
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
 * Ruta del mesero por voz, de punta a punta salvo el proveedor.
 *
 * Lo que se comprueba es la CADENA completa: token de comensal → sesión de mesa
 * activa → carta de esa sede → acuñación de la credencial. La llamada a OpenAI
 * se sustituye por un doble, porque lo que puede romperse aquí es nuestro lado:
 * que se cuele una petición sin sesión, que la clave real acabe en la respuesta
 * o que un fallo del proveedor salga como 500.
 */
describe("routes/voice", () => {
  let orgId: string;
  let branchId: string;
  let tableId: string;
  let sessionId: string;
  let token: string;

  const realFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const category = await createTestCategory(branchId, orgId);
    await createTestMenuItem(branchId, orgId, category.id, {
      name: "Ceviche de prueba",
      price: 3500,
    });
    const table = await createTestTable(branchId, orgId, 7);
    tableId = table.id;

    const [session] = await db
      .insert(schema.tableSessions)
      .values({
        table_id: tableId,
        branch_id: branchId,
        organization_id: orgId,
        customer_name: "Comensal de prueba",
        token: "test-session-token",
        status: "active",
      })
      .returning();
    sessionId = session.id;

    // El token debe llevar la sesión en `sub`: así lo exige requireActiveSession.
    token = await signCustomerToken({
      sub: sessionId,
      org: orgId,
      branch: branchId,
      table: tableId,
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  afterAll(async () => {
    // Borrar la organización arrastra la sesión en cascada.
    await cleanup([orgId]);
  });

  it("rechaza sin token", async () => {
    const res = await app.request("/api/voice/session", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("responde 503 sin clave configurada, no 500", async () => {
    // Hay que apagar TODOS los proveedores, no solo OpenAI: desde que existe
    // Gemini, quitar una sola clave deja la voz encendida por la otra y el
    // test medía algo que ya no era cierto.
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.VOICE_AGENT_PROVIDER;
    const res = await app.request("/api/voice/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VOICE_DISABLED");
  });

  it("acuña la credencial y devuelve el mapa ref→uuid", async () => {
    // El proveedor se fija a mano por dos motivos: el despliegue puede tener
    // `VOICE_AGENT_PROVIDER=gemini` —y entonces la clave falsa de OpenAI no se
    // miraría siquiera—, y con una clave real de Gemini en el entorno este caso
    // acabaría llamando a Google de verdad desde una prueba unitaria.
    process.env.VOICE_AGENT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fake";
    delete process.env.GEMINI_API_KEY;

    let capturedBody: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ value: "ek_fake_secret", expires_at: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await app.request("/api/voice/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.clientSecret).toBe("ek_fake_secret");
    expect(body.data.catalog.length).toBeGreaterThan(0);
    expect(body.data.catalog[0].ref).toBeTruthy();

    // La configuración se manda desde el SERVIDOR: si viajara desde la tablet,
    // cualquiera podría reescribir el prompt del mesero.
    expect(capturedBody.session.instructions).toContain("Ceviche de prueba");
    expect(capturedBody.session.tools.length).toBeGreaterThan(0);
    expect(capturedBody.session.audio.input.turn_detection.interrupt_response).toBe(true);

    // La clave real no puede aparecer en lo que se le devuelve a la tablet.
    expect(JSON.stringify(body)).not.toContain("sk-test-fake");
  });

  it("traduce el fallo del proveedor a 503, sin filtrar su respuesta", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "invalid_api_key detalle interno" } }), {
        status: 401,
      })) as unknown as typeof fetch;

    const res = await app.request("/api/voice/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("invalid_api_key");
  });

  it("config no expone el modelo cuando la voz está apagada", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.VOICE_AGENT_PROVIDER;
    const res = await app.request("/api/voice/config");
    const body = (await res.json()) as any;
    expect(body.data.enabled).toBe(false);
    expect(body.data.model).toBeNull();
  });
});
