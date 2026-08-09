import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db, schema } from "@restai/db";
import { eq } from "drizzle-orm";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  cleanup,
} from "../setup";
import {
  loadVoiceCatalog,
  buildInstructions,
  buildVoiceAgentContext,
  VOICE_TOOLS,
} from "../../services/voice-agent.service";

/**
 * Lo que se prueba aquí es lo que el agente CREE que existe.
 *
 * Un fallo en esta capa no da un error: da un mesero que ofrece con total
 * seguridad un plato retirado de la carta, o que se calla sobre uno que sí
 * está. Por eso las pruebas se centran en qué entra y qué no entra en el
 * catálogo, más que en el formato del texto.
 */
describe("voice-agent.service", () => {
  let orgId: string;
  let branchId: string;
  let activeCategoryId: string;
  let hiddenCategoryId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;

    const activeCat = await createTestCategory(branchId, orgId);
    activeCategoryId = activeCat.id;

    const hiddenCat = await createTestCategory(branchId, orgId);
    hiddenCategoryId = hiddenCat.id;
    await db
      .update(schema.menuCategories)
      .set({ is_active: false })
      .where(eq(schema.menuCategories.id, hiddenCategoryId));
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("excluye los platos de una categoría desactivada", async () => {
    const visible = await createTestMenuItem(branchId, orgId, activeCategoryId, {
      name: "Ceviche visible",
      price: 3500,
    });
    const hidden = await createTestMenuItem(branchId, orgId, hiddenCategoryId, {
      name: "Plato de categoría oculta",
      price: 2000,
    });

    const catalog = await loadVoiceCatalog(orgId, branchId);
    const ids = catalog.map((entry) => entry.id);

    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });

  it("incluye los agotados, marcados como no disponibles", async () => {
    // Ocultarlos sería peor: el agente ofrecería alternativas sin saber que la
    // primera opción del comensal existe pero se acabó hoy.
    const soldOut = await createTestMenuItem(branchId, orgId, activeCategoryId, {
      name: "Anticuchos agotados",
      price: 2800,
      is_available: false,
    });

    const catalog = await loadVoiceCatalog(orgId, branchId);
    const entry = catalog.find((e) => e.id === soldOut.id);

    expect(entry).toBeTruthy();
    expect(entry!.available).toBe(false);
  });

  it("excluye los platos borrados", async () => {
    const deleted = await createTestMenuItem(branchId, orgId, activeCategoryId, {
      name: "Plato retirado",
      price: 1500,
      deleted_at: new Date(),
    });

    const catalog = await loadVoiceCatalog(orgId, branchId);
    expect(catalog.map((e) => e.id)).not.toContain(deleted.id);
  });

  it("asigna referencias cortas únicas y estables", async () => {
    const catalog = await loadVoiceCatalog(orgId, branchId);
    const refs = catalog.map((e) => e.ref);

    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs).size).toBe(refs.length);
    // Deben ser cortas: su razón de ser es no gastar tokens ni inducir errores
    // de copia como haría un uuid.
    for (const ref of refs) expect(ref.length).toBeLessThanOrEqual(4);

    const again = await loadVoiceCatalog(orgId, branchId);
    expect(again.map((e) => e.ref)).toEqual(refs);
  });

  it("marca en las instrucciones los platos agotados y no los oculta", async () => {
    const catalog = await loadVoiceCatalog(orgId, branchId);
    const instructions = buildInstructions({
      branchName: "Mi Restaurante",
      currency: "PEN",
      customerName: "Ana",
      tableNumber: 4,
      catalog,
    });

    expect(instructions).toContain("Anticuchos agotados");
    expect(instructions).toContain("AGOTADO HOY");
    expect(instructions).toContain("Mi Restaurante");
    expect(instructions).toContain("Ana");
    // La regla que sostiene toda la sincronía voz-pantalla.
    expect(instructions).toContain("mostrar_platos");
  });

  it("no filtra uuids al prompt: el agente solo ve referencias cortas", async () => {
    const catalog = await loadVoiceCatalog(orgId, branchId);
    const instructions = buildInstructions({
      branchName: "Mi Restaurante",
      currency: "PEN",
      catalog,
    });

    for (const entry of catalog) {
      expect(instructions).not.toContain(entry.id);
    }
  });

  it("el contexto no expone al navegador más de lo necesario", async () => {
    const context = await buildVoiceAgentContext({
      organizationId: orgId,
      branchId,
      branchName: "Mi Restaurante",
      currency: "PEN",
      tableNumber: 2,
    });

    expect(context.catalog.length).toBeGreaterThan(0);
    for (const entry of context.catalog) {
      // El navegador solo necesita traducir ref → uuid; la descripción y los
      // alérgenos ya los tiene de la carta pública.
      expect(Object.keys(entry).sort()).toEqual(
        ["available", "categoryId", "categoryName", "hasModifiers", "id", "name", "price", "ref"],
      );
    }
  });

  it("declara confirmar_pedido exigiendo el total, que es la salvaguarda del cierre por voz", () => {
    const confirm = VOICE_TOOLS.find((tool) => tool.name === "confirmar_pedido");
    expect(confirm).toBeTruthy();

    const params = confirm!.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("total_esperado_centimos");
    expect(params.properties.total_esperado_centimos).toBeTruthy();
  });

  it("expone herramientas para corregir el pedido sin rehacerlo", () => {
    // Un comensal cambia de idea a media frase. Sin estas, la única salida era
    // quitar la línea y volver a crearla, o hacer aritmética mental —que es
    // justo donde un modelo se equivoca y el error acaba en la cocina—.
    const names = VOICE_TOOLS.map((t) => t.name);
    expect(names).toContain("cambiar_cantidad");
    expect(names).toContain("poner_nota");
    expect(names).toContain("vaciar_carrito");

    const setQty = VOICE_TOOLS.find((t) => t.name === "cambiar_cantidad")!;
    const params = setQty.parameters as { required: string[] };
    expect(params.required).toContain("cantidad");
  });

  it("puede llamar al mozo, que es lo que el prompt promete", () => {
    // El prompt le dice al agente que ofrezca ayuda humana cuando algo se le
    // escapa (alergias, cuenta, descuentos). Sin la herramienta, esa promesa
    // era mentira: decía "llamo a alguien" y no llamaba a nadie.
    const tool = VOICE_TOOLS.find((t) => t.name === "llamar_mozo");
    expect(tool).toBeTruthy();

    const motivo = (tool!.parameters as { properties: { motivo: { enum: string[] } } })
      .properties.motivo;
    expect(motivo.enum).toEqual(["cuenta", "ayuda"]);
  });

  it("las herramientas que actúan sobre una línea aceptan desambiguar por opciones", () => {
    // El mismo plato puede estar pedido dos veces con opciones distintas; sin
    // este parámetro el agente no tiene forma de decir a cuál se refiere.
    for (const name of ["quitar_del_carrito", "cambiar_cantidad", "poner_nota"]) {
      const tool = VOICE_TOOLS.find((t) => t.name === name)!;
      const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
      expect(props.opciones).toBeTruthy();
    }
  });

  it("el prompt advierte de lo que el agente NO puede hacer", () => {
    const instructions = buildInstructions({
      branchName: "Mi Restaurante",
      currency: "PEN",
      catalog: [],
    });
    // Prometer un descuento que no puede aplicar es una discusión en caja.
    expect(instructions).toContain("llamar_mozo");
    expect(instructions.toLowerCase()).toContain("descuento");
  });

  it("expone cupones, puntos y estado del pedido", () => {
    const names = VOICE_TOOLS.map((t) => t.name);
    expect(names).toContain("aplicar_cupon");
    expect(names).toContain("quitar_cupon");
    expect(names).toContain("ver_mis_puntos");
    expect(names).toContain("canjear_recompensa");
    expect(names).toContain("estado_del_pedido");
  });

  it("avisa de que canjear puntos es irreversible", () => {
    // Canjear GASTA los puntos aunque el pedido no llegue a enviarse. Si la
    // descripción no lo dice, el modelo canjea "para ver qué sale" y el
    // comensal pierde puntos reales.
    const tool = VOICE_TOOLS.find((t) => t.name === "canjear_recompensa")!;
    expect(tool.description.toLowerCase()).toContain("irreversible");
  });

  it("el prompt obliga a no dar por definitivo un total que calcula la caja", () => {
    // Los cupones 2x1 y por categoría no se pueden estimar en el navegador. Sin
    // esta regla el agente diría un total que no es el que se cobra.
    const instructions = buildInstructions({
      branchName: "Mi Restaurante",
      currency: "PEN",
      catalog: [],
    });
    expect(instructions).toContain("calcula la caja");
    expect(instructions.toLowerCase()).toContain("tiempos de espera");
  });

  it("toda herramienta declara nombre, descripción y esquema de objeto", () => {
    // El formato es NEUTRO: cada adaptador de proveedor lo traduce a su
    // dialecto (OpenAI acepta JSON Schema tal cual; Gemini exige OpenAPI).
    for (const tool of VOICE_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect((tool.parameters as { type: string }).type).toBe("object");
    }
  });
});
