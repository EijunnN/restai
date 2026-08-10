import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";

/**
 * Qué platos se venden de verdad.
 *
 * Existe porque nadie lo sabe de memoria, ni siquiera el dueño. Los operadores
 * se equivocan de forma sistemática y siempre en la misma dirección:
 * sobrevaloran el plato del que están orgullosos e infravaloran el aburrido que
 * se vende solo —la gaseosa, la guarnición, el menú del día—. Este ranking es lo
 * que corrige esa intuición con la cifra delante.
 *
 * Dos decisiones cargan con todo el peso de que diga la verdad.
 *
 * ── 1. Se agrupa por PLATO, no por el texto del nombre ──────────────────────
 *
 * `order_items.name` es una copia congelada del nombre en el momento del pedido.
 * Agrupar por ahí —como se hacía hasta ahora— parte en dos filas que no suman
 * cualquier plato renombrado a mitad de mes, y no deja ningún id con el que
 * casar la ficha de la carta. Se agrupa por `menu_item_id` y se devuelve el
 * nombre ACTUAL.
 *
 * ── 2. Vendido no es lo mismo que "completado" ──────────────────────────────
 *
 * El predicado anterior exigía `orders.status = 'completed'`, y eso pierde
 * ventas reales: una orden solo se cierra al cobrarla si estaba en `ready` o
 * `served` (`CLOSABLE_BY_PAYMENT` en payments.ts). Una gaseosa cantada, cobrada
 * y entregada cuya comanda nadie tocó en la pantalla de cocina se queda en
 * `pending` para siempre — y desaparecía del ranking.
 *
 * El sesgo no era neutro: castigaba justo a los productos rápidos de mostrador,
 * que son los que la cocina no marca y los que el dueño ya tiende a olvidar. Es
 * decir, el mecanismo que existe para acordarse de la Inca Kola se olvidaba de
 * la Inca Kola.
 *
 * Lo que cuenta es lo que OCURRIÓ, y eso son tres casos distintos unidos por un
 * "o":
 *
 *   a) La orden llegó a `served` o `completed`. La comida salió, punto.
 *   b) La orden tiene un cobro válido. Alguien pagó: ocurrió aunque la comanda
 *      se quedara sin avanzar en la pantalla de cocina —que es EXACTAMENTE el
 *      caso de la gaseosa de mostrador.
 *   c) La orden nació hoy. Todavía está viva de verdad, en la cocina, ahora
 *      mismo; el ranking del turno en curso la tiene que ver.
 *
 * Lo que queda fuera con esos tres es lo que no ocurrió: la comanda tecleada por
 * error hace tres semanas, que nadie sirvió, nadie pagó y nadie anuló, y que se
 * queda en `pending` para siempre. Sin este filtro contaría igual que una venta,
 * y en una ventana de treinta días esas fantasmas se acumulan.
 *
 * El cobro se comprueba con EXISTS y NO con un JOIN: una cuenta dividida entre
 * cuatro tarjetas son cuatro filas en `payments`, y unirlas multiplicaría por
 * cuatro las unidades de cada plato de esa mesa.
 */

/**
 * "Esto ocurrió": salió a la mesa, se cobró, o nació hoy y sigue en marcha.
 *
 * El EXISTS usa el criterio canónico de cobro de todo el repositorio: un cobro
 * anulado (`voided_at`) deja de ser dinero cobrado.
 */
/*
 * El instante viaja como texto ISO con `::timestamptz` explicito y no como
 * objeto `Date`: dentro de una plantilla `sql` el driver no sabe serializarlo y
 * la consulta entera revienta al vincular el parametro.
 */
function ocurrio(inicioDelDia: Date) {
  return sql`(
    ${schema.orders.status} in ('served', 'completed')
    or exists (
      select 1 from payments
      where payments.order_id = ${schema.orders.id}
        and payments.status = 'completed'
        and payments.voided_at is null
    )
    or ${schema.orders.created_at} >= ${inicioDelDia.toISOString()}::timestamptz
  )`;
}

/** Medianoche de Lima de hoy, que es donde empieza el día operativo peruano. */
function inicioDelDiaPorDefecto(): Date {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  lima.setUTCHours(0, 0, 0, 0);
  return new Date(lima.getTime() + 5 * 60 * 60 * 1000);
}

export interface PlatoVendido {
  menuItemId: string;
  /** Nombre ACTUAL del plato, no el que tenía cuando se vendió. */
  name: string;
  /** Unidades vendidas en la ventana. */
  totalQuantity: number;
  /** Importe en CÉNTIMOS. */
  totalRevenue: number;
  /** Ya está anclado arriba de la carta del punto de venta. */
  isFeatured: boolean;
  /**
   * El plato ya no está en la carta (borrado o agotado). Sigue en el ranking
   * porque su venta ocurrió, pero no se puede destacar.
   */
  isSellable: boolean;
}

export async function platosMasVendidos(
  params: {
    organizationId: string;
    branchId: string;
    /** Inclusivo. */
    desde: Date;
    /** EXCLUSIVO. */
    hasta: Date;
    limite: number;
    /**
     * Inicio del día operativo. Las órdenes vivas nacidas a partir de aquí
     * cuentan aunque nadie las haya servido ni cobrado todavía: están en marcha.
     */
    inicioDelDia?: Date;
  },
  ejecutor: DbOrTx = db,
): Promise<PlatoVendido[]> {
  const filas = await ejecutor
    .select({
      menuItemId: schema.orderItems.menu_item_id,
      name: schema.menuItems.name,
      isFeatured: schema.menuItems.is_featured,
      isAvailable: schema.menuItems.is_available,
      deletedAt: schema.menuItems.deleted_at,
      totalQuantity: sql<number>`sum(${schema.orderItems.quantity})::int`,
      totalRevenue: sql<number>`sum(${schema.orderItems.total})::int`,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.order_id, schema.orders.id))
    .innerJoin(schema.menuItems, eq(schema.orderItems.menu_item_id, schema.menuItems.id))
    .where(
      and(
        eq(schema.orders.organization_id, params.organizationId),
        eq(schema.orders.branch_id, params.branchId),
        gte(schema.orders.created_at, params.desde),
        lt(schema.orders.created_at, params.hasta),
        // Una venta anulada no es una venta.
        ne(schema.orders.status, "cancelled"),
        // El "86" de cocina: el plato nunca salió.
        ne(schema.orderItems.status, "cancelled"),
        // Salió, se cobró, o sigue viva hoy. Ver el docblock.
        ocurrio(params.inicioDelDia ?? inicioDelDiaPorDefecto()),
      ),
    )
    .groupBy(
      schema.orderItems.menu_item_id,
      schema.menuItems.name,
      schema.menuItems.is_featured,
      schema.menuItems.is_available,
      schema.menuItems.deleted_at,
    )
    .orderBy(desc(sql`sum(${schema.orderItems.quantity})`))
    .limit(params.limite);

  return filas.map((f) => ({
    menuItemId: f.menuItemId,
    name: f.name,
    totalQuantity: Number(f.totalQuantity ?? 0),
    totalRevenue: Number(f.totalRevenue ?? 0),
    isFeatured: f.isFeatured,
    isSellable: f.deletedAt === null && f.isAvailable,
  }));
}
