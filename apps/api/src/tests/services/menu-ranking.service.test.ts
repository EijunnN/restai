import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { platosMasVendidos } from "../../services/menu-ranking.service";
import {
  createTestOrg,
  createTestBranch,
  createTestCategory,
  createTestMenuItem,
  createTestOrder,
  cleanup,
} from "../setup";

/**
 * Qué platos se venden de verdad.
 *
 * Este ranking es lo que va a decidir qué platos se anclan en la caja, así que
 * si cuenta mal, el dueño reconfigura su punto de venta con datos falsos y no
 * tiene forma de enterarse: no hay nada con lo que contrastar la cifra.
 *
 * El predicado anterior exigía `orders.status='completed'` y perdía las ventas
 * de mostrador cobradas cuya comanda nadie tocó en cocina — que son justo los
 * productos rápidos que el dueño ya tiende a olvidar.
 */
describe("services/menu-ranking — qué se vende de verdad", () => {
  let orgId: string;
  let branchId: string;
  let categoryId: string;
  let lomoId: string;
  let gaseosaId: string;
  let postreId: string;
  /** Plato exclusivo de la prueba de renombrado, para que no dependa del orden. */
  let renombradoId: string;

  const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const VENTANA = {
    desde: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    hasta: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  /** Cuelga una línea de una orden, con el estado que se le diga. */
  async function linea(
    orderId: string,
    menuItemId: string,
    nombre: string,
    cantidad: number,
    estado: "pending" | "cancelled" = "pending",
  ) {
    await db.insert(schema.orderItems).values({
      order_id: orderId,
      menu_item_id: menuItemId,
      name: nombre,
      unit_price: 1000,
      quantity: cantidad,
      total: 1000 * cantidad,
      status: estado,
    });
  }

  /** Registra un cobro válido sobre la orden: es lo que la convierte en venta. */
  async function cobrar(orderId: string, importe: number) {
    await db.insert(schema.payments).values({
      organization_id: orgId,
      branch_id: branchId,
      order_id: orderId,
      method: "cash",
      amount: importe,
      status: "completed",
    });
  }

  function ranking(limite = 10) {
    return platosMasVendidos({
      organizationId: orgId,
      branchId,
      desde: VENTANA.desde,
      hasta: VENTANA.hasta,
      limite,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    const branch = await createTestBranch(orgId);
    branchId = branch.id;
    const cat = await createTestCategory(branchId, orgId);
    categoryId = cat.id;

    const lomo = await createTestMenuItem(branchId, orgId, categoryId, { name: "Lomo saltado" });
    lomoId = lomo.id;
    const gaseosa = await createTestMenuItem(branchId, orgId, categoryId, { name: "Inca Kola" });
    gaseosaId = gaseosa.id;
    const postre = await createTestMenuItem(branchId, orgId, categoryId, { name: "Picarones" });
    postreId = postre.id;
    const renombrado = await createTestMenuItem(branchId, orgId, categoryId, {
      name: "Seco de res",
    });
    renombradoId = renombrado.id;
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("la gaseosa cobrada que nadie marcó en cocina SÍ cuenta", async () => {
    /*
      Es el caso que rompía el ranking anterior. Una orden solo pasa a
      `completed` al cobrarla si estaba en `ready` o `served`; una venta de
      mostrador que se canta, se cobra y se entrega sin tocar la pantalla de
      cocina se queda en `pending` para siempre. Con el predicado viejo,
      desaparecía — y el sesgo caía justo sobre los productos rápidos.

      Lo que hace de esto una venta y no una comanda fantasma es EL COBRO: por
      eso la prueba lo registra, en vez de dar por bueno cualquier `pending`.
    */
    const enMarcha = await createTestOrder(orgId, branchId, {
      status: "pending",
      created_at: AYER,
    });
    await linea(enMarcha.id, gaseosaId, "Inca Kola", 9);
    await cobrar(enMarcha.id, 1000);

    const cerrada = await createTestOrder(orgId, branchId, {
      status: "completed",
      created_at: AYER,
    });
    await linea(cerrada.id, lomoId, "Lomo saltado", 4);

    const filas = await ranking();
    const gaseosa = filas.find((f) => f.menuItemId === gaseosaId);
    expect(gaseosa?.totalQuantity).toBe(9);
    // Y manda sobre el lomo, que es lo que el dueño no habría adivinado.
    expect(filas[0]!.menuItemId).toBe(gaseosaId);
  });

  it("la comanda fantasma NO cuenta: nadie la sirvió, nadie la cobró y nadie la anuló", async () => {
    /*
      Es la que se teclea por error y se queda en `pending` para siempre. Contar
      cualquier orden no anulada la habría metido en el ranking, y en treinta
      días estas se acumulan hasta empujar un plato a la fila anclada de la caja
      sin que se haya vendido nunca.
    */
    const fantasma = await createTestOrder(orgId, branchId, {
      status: "pending",
      created_at: AYER,
    });
    await linea(fantasma.id, postreId, "Picarones", 40);

    const filas = await ranking();
    expect(filas.find((f) => f.menuItemId === postreId)).toBeUndefined();
  });

  it("una orden viva de HOY sí cuenta: está en la cocina ahora mismo", async () => {
    // El ranking del turno en curso tiene que ver lo que se está cocinando.
    const deHoy = await createTestOrder(orgId, branchId, {
      status: "preparing",
      created_at: new Date(),
    });
    await linea(deHoy.id, postreId, "Picarones", 2);

    const filas = await ranking();
    expect(filas.find((f) => f.menuItemId === postreId)?.totalQuantity).toBe(2);
  });

  it("una orden anulada no es una venta", async () => {
    const anulada = await createTestOrder(orgId, branchId, {
      status: "cancelled",
      created_at: AYER,
    });
    await linea(anulada.id, postreId, "Picarones", 500);

    const filas = await ranking();
    // Sigue con solo las 2 de la orden viva de hoy: las 500 anuladas no entran.
    expect(filas.find((f) => f.menuItemId === postreId)?.totalQuantity).toBe(2);
  });

  it("una línea anulada (el '86' de cocina) tampoco", async () => {
    // El plato se cantó y luego se cayó porque se acabó: nunca salió.
    const orden = await createTestOrder(orgId, branchId, {
      status: "completed",
      created_at: AYER,
    });
    await linea(orden.id, postreId, "Picarones", 300, "cancelled");

    const filas = await ranking();
    expect(filas.find((f) => f.menuItemId === postreId)?.totalQuantity).toBe(2);
  });

  it("agrupa por PLATO, así que un plato renombrado no sale partido en dos", async () => {
    /*
      `order_items.name` es una copia congelada. Agrupando por ese texto, un
      plato rebautizado a mitad de mes salía como dos filas que no suman, y
      ninguna de las dos llegaba arriba del ranking.
    */
    const antes = await createTestOrder(orgId, branchId, {
      status: "completed",
      created_at: AYER,
    });
    await linea(antes.id, renombradoId, "Seco de res", 3);

    const despues = await createTestOrder(orgId, branchId, {
      status: "completed",
      created_at: AYER,
    });
    await linea(despues.id, renombradoId, "Seco a la nortena (nuevo nombre)", 4);

    const filas = await ranking();
    const plato = filas.find((f) => f.menuItemId === renombradoId)!;
    // Una sola fila con las dos ventas sumadas, no dos filas de 3 y de 4.
    expect(plato.totalQuantity).toBe(7);
    // Y devuelve el nombre ACTUAL de la carta, no el del ticket.
    expect(plato.name).toBe("Seco de res");
  });

  it("la ventana de fechas acota de verdad", async () => {
    const vieja = await createTestOrder(orgId, branchId, {
      status: "completed",
      created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    });
    await linea(vieja.id, postreId, "Picarones", 100);

    const filas = await ranking();
    // Fuera de los 30 días: no suma a las 2 que sí están dentro.
    expect(filas.find((f) => f.menuItemId === postreId)?.totalQuantity).toBe(2);
  });

  it("dice cuáles ya están destacados, para no tener que preguntarlo aparte", async () => {
    await db
      .update(schema.menuItems)
      .set({ is_featured: true })
      .where(eq(schema.menuItems.id, gaseosaId));

    const filas = await ranking();
    expect(filas.find((f) => f.menuItemId === gaseosaId)?.isFeatured).toBe(true);
    expect(filas.find((f) => f.menuItemId === lomoId)?.isFeatured).toBe(false);
  });

  it("un plato agotado sigue en el ranking pero se marca como no vendible", async () => {
    // Su venta ocurrió y borrarla del informe sería mentir; pero no se puede
    // anclar en la caja algo que no se puede cantar.
    await db
      .update(schema.menuItems)
      .set({ is_available: false })
      .where(eq(schema.menuItems.id, lomoId));

    const filas = await ranking();
    const lomo = filas.find((f) => f.menuItemId === lomoId)!;
    expect(lomo.totalQuantity).toBe(4);
    expect(lomo.isSellable).toBe(false);

    await db
      .update(schema.menuItems)
      .set({ is_available: true })
      .where(eq(schema.menuItems.id, lomoId));
  });

  it("no se cuela la venta de otra sede", async () => {
    const otraSede = await createTestBranch(orgId);
    const otraCat = await createTestCategory(otraSede.id, orgId);
    const ajeno = await createTestMenuItem(otraSede.id, orgId, otraCat.id, { name: "Ajeno" });
    const orden = await createTestOrder(orgId, otraSede.id, {
      status: "completed",
      created_at: AYER,
    });
    await linea(orden.id, ajeno.id, "Ajeno", 999);

    const filas = await ranking();
    expect(filas.find((f) => f.menuItemId === ajeno.id)).toBeUndefined();
  });

  it("el límite recorta por la cola, no por la cabeza", async () => {
    const filas = await ranking(1);
    expect(filas).toHaveLength(1);
    // La gaseosa, con 9, es la más vendida de toda la prueba.
    expect(filas[0]!.menuItemId).toBe(gaseosaId);
  });
});
