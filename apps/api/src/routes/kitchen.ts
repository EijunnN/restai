import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, ne, asc, inArray, isNull, sum, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@restai/db";
import { updateOrderItemStatusSchema, idParamSchema, kitchenQuerySchema } from "@restai/validators";
import { ORDER_ITEM_STATUS_TRANSITIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { realtime } from "../infrastructure/container.js";
import { auditFromContext } from "../lib/audit.js";
import { repriceOrderAfterCancel, persistRepricedDiscount } from "../services/order.service.js";

const kitchen = new Hono<AppEnv>();

kitchen.use("*", authMiddleware);
kitchen.use("*", tenantMiddleware);
kitchen.use("*", requireBranch);

// ---------------------------------------------------------------------------
// Esquemas de entrada (inline: este archivo es de un solo dueño)
// ---------------------------------------------------------------------------

/** Params de la anulación de línea: /orders/:orderId/items/:itemId/cancel */
const cancelItemParamSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid(),
});

/**
 * Motivo de la anulación. Es OBLIGATORIO: un "86" sin motivo no sirve para
 * nada al día siguiente, cuando el gerente quiere saber qué se acabó y por qué.
 */
const cancelItemBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ---------------------------------------------------------------------------
// GET /orders - Comandas activas de la sede para la pantalla de cocina
// ---------------------------------------------------------------------------

kitchen.get("/orders", requirePermission("orders:read"), zValidator("query", kitchenQuerySchema), async (c) => {
  const tenant = c.get("tenant");
  const { status } = c.req.valid("query");

  type OrderStatus = (typeof schema.orders.status.enumValues)[number];
  const statusList: OrderStatus[] = status
    ? [status]
    : ["pending", "confirmed", "preparing", "ready"];

  // 1ª consulta: órdenes + número de mesa (vía sesión → mesa), para que la
  // tarjeta de cocina rotule "Mesa N" en lugar de caer en "Salón"/nombre del
  // cliente. Se ordenan de la MÁS ANTIGUA a la más nueva: en cocina se cocina
  // por orden de llegada, y la UI promete ese orden.
  //
  // Se arrastra además el ESPACIO de la mesa (salón, terraza, segundo piso). En
  // una sede con varios ambientes y más de una cocina, cada partida solo debe
  // ver lo suyo: sin este dato la pantalla no puede distinguirlo y el cocinero
  // de la terraza acaba leyendo las comandas del sótano.
  //
  // Los tres campos son NULOS para lo que no se sirve en mesa (para llevar y
  // reparto). Esa distinción es deliberada y la pantalla la trata aparte: esas
  // comandas no pertenecen a ninguna zona, pero alguien tiene que cocinarlas.
  const activeOrders = await db
    .select({
      ...getTableColumns(schema.orders),
      table_number: schema.tables.number,
      space_id: schema.tables.space_id,
      space_name: schema.spaces.name,
      floor_number: schema.spaces.floor_number,
    })
    .from(schema.orders)
    .leftJoin(schema.tableSessions, eq(schema.orders.table_session_id, schema.tableSessions.id))
    .leftJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
    .leftJoin(schema.spaces, eq(schema.tables.space_id, schema.spaces.id))
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        eq(schema.orders.organization_id, tenant.organizationId),
        inArray(schema.orders.status, statusList),
      ),
    )
    .orderBy(asc(schema.orders.created_at));

  if (activeOrders.length === 0) {
    return c.json({ success: true, data: [] });
  }

  // 2ª consulta: TODOS los ítems de esas órdenes de una sola vez. Antes se hacía
  // una consulta por orden (1+2N): con 25 comandas eran 51 viajes a la base por
  // cada refresco, y la pantalla de cocina refresca con cada evento realtime.
  const orderIds = activeOrders.map((o) => o.id);
  // Se adjunta la CATEGORÍA de carta de cada línea (LEFT JOIN: el plato existe
  // siempre por la FK, pero su categoría puede haberse borrado).
  //
  // Es lo que alimenta el filtro por estación del tablero. El modelo no tiene un
  // concepto propio de "partida" (parrilla, fríos, salsas), y la categoría de la
  // carta es su equivalente real en un restaurante: se configura una sola vez,
  // ya está poblada, y evita inventar un campo nuevo que nadie mantendría.
  const items = await db
    .select({
      ...getTableColumns(schema.orderItems),
      category_id: schema.menuItems.category_id,
      category_name: schema.menuCategories.name,
    })
    .from(schema.orderItems)
    .leftJoin(schema.menuItems, eq(schema.orderItems.menu_item_id, schema.menuItems.id))
    .leftJoin(
      schema.menuCategories,
      eq(schema.menuItems.category_id, schema.menuCategories.id),
    )
    .where(inArray(schema.orderItems.order_id, orderIds));

  // 3ª consulta: los modificadores de todos esos ítems ("sin cebolla", "extra
  // queso"). El cocinero los necesita para preparar el plato.
  const itemIds = items.map((i) => i.id);
  const mods = itemIds.length
    ? await db
        .select({
          id: schema.orderItemModifiers.id,
          order_item_id: schema.orderItemModifiers.order_item_id,
          name: schema.orderItemModifiers.name,
          price: schema.orderItemModifiers.price,
        })
        .from(schema.orderItemModifiers)
        .where(inArray(schema.orderItemModifiers.order_item_id, itemIds))
    : [];

  // Agrupación en memoria (O(n)), respetando la forma de respuesta anterior:
  // cada orden lleva `items`, y cada ítem lleva `modifiers` además de sus notas.
  type ItemRow = (typeof items)[number];
  type ModRow = (typeof mods)[number];

  const modsByItem = new Map<string, ModRow[]>();
  for (const m of mods) {
    const bucket = modsByItem.get(m.order_item_id);
    if (bucket) bucket.push(m);
    else modsByItem.set(m.order_item_id, [m]);
  }

  const itemsByOrder = new Map<string, Array<ItemRow & { modifiers: ModRow[] }>>();
  for (const it of items) {
    const withMods = { ...it, modifiers: modsByItem.get(it.id) ?? [] };
    const bucket = itemsByOrder.get(it.order_id);
    if (bucket) bucket.push(withMods);
    else itemsByOrder.set(it.order_id, [withMods]);
  }

  const ordersWithItems = activeOrders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
  }));

  return c.json({ success: true, data: ordersWithItems });
});

// ---------------------------------------------------------------------------
// GET /zones - Ambientes de la sede, para configurar a qué zona sirve la pantalla
// ---------------------------------------------------------------------------

/**
 * Catálogo de espacios de la sede (salón, terraza, segundo piso).
 *
 * Existe aparte de `/api/spaces` porque aquel exige `tables:read`, que el rol de
 * cocina no tiene ni debería tener: para elegir su zona, el cocinero no necesita
 * el mapa de mesas ni poder tocarlo.
 *
 * Se sirve el catálogo COMPLETO y no solo las zonas con comandas: la tablet se
 * configura al empezar el turno, con la cocina todavía vacía, y una lista que
 * solo existe cuando ya hay trabajo llega tarde.
 */
kitchen.get("/zones", requirePermission("orders:read"), async (c) => {
  const tenant = c.get("tenant");

  const zones = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      floor_number: schema.spaces.floor_number,
    })
    .from(schema.spaces)
    .where(
      and(
        eq(schema.spaces.branch_id, tenant.branchId),
        eq(schema.spaces.organization_id, tenant.organizationId),
        eq(schema.spaces.is_active, true),
      ),
    )
    .orderBy(asc(schema.spaces.floor_number), asc(schema.spaces.sort_order), asc(schema.spaces.name));

  return c.json({ success: true, data: zones });
});

// ---------------------------------------------------------------------------
// POST /orders/:orderId/items/:itemId/cancel - Anular una línea ("86")
// ---------------------------------------------------------------------------

/**
 * Se acabó el plato. Es la situación más frecuente del servicio y hasta ahora
 * obligaba al cocinero a salir físicamente a la sala para que alguien con más
 * permisos tocara la comanda.
 *
 * La línea NO se borra: queda con status='cancelled' y su motivo, para que el
 * histórico y la comanda impresa sigan cuadrando con lo que ocurrió. Los totales
 * de la orden se recalculan al vuelo con la tasa de impuesto de la SEDE.
 */
kitchen.post(
  "/orders/:orderId/items/:itemId/cancel",
  requirePermission("orders:update_item_status"),
  zValidator("param", cancelItemParamSchema),
  zValidator("json", cancelItemBodySchema),
  async (c) => {
    const { orderId, itemId } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const tenant = c.get("tenant");
    const user = c.get("user");
    const userId: string | null = user?.sub ?? null;

    // IMPORTANTE: devolver un objeto de error desde el callback de una
    // transacción de Drizzle NO la aborta: el callback termina bien y se hace
    // COMMIT. Por eso TODAS las validaciones van ANTES de cualquier escritura
    // (misma disciplina que payments.ts). Si se validara después, un 409 dejaría
    // el ítem anulado y los totales sin recalcular: una comanda incoherente.
    const txResult = await db.transaction(async (tx) => {
      // Bloqueo de la orden: aquí se mueve dinero (totales) y estado compartido,
      // así que se serializan cobros y anulaciones concurrentes sobre la orden.
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, orderId),
            eq(schema.orders.organization_id, tenant.organizationId),
            eq(schema.orders.branch_id, tenant.branchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!order) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Orden no encontrada" } };
      }

      if (order.status === "cancelled") {
        return {
          error: { status: 409 as const, code: "CONFLICT", message: "La orden ya está anulada" },
        };
      }
      if (order.status === "completed") {
        return {
          error: {
            status: 409 as const,
            code: "CONFLICT",
            message: "La orden ya está cerrada: anula el cobro antes de tocar los ítems",
          },
        };
      }

      // Si ya se emitió comprobante, cambiar los totales rompería el documento
      // fiscal. La corrección correcta en Perú es una nota de crédito.
      const [comprobante] = await tx
        .select({
          id: schema.invoices.id,
          series: schema.invoices.series,
          number: schema.invoices.number,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.order_id, orderId))
        .limit(1);

      if (comprobante) {
        return {
          error: {
            status: 409 as const,
            code: "CONFLICT",
            message: `La orden ya tiene comprobante emitido (${comprobante.series}-${comprobante.number}). Se corrige con nota de crédito.`,
          },
        };
      }

      // Bloqueo de la línea concreta.
      const [item] = await tx
        .select()
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.id, itemId),
            eq(schema.orderItems.order_id, orderId),
          ),
        )
        .limit(1)
        .for("update");

      if (!item) {
        return { error: { status: 404 as const, code: "NOT_FOUND", message: "Ítem no encontrado" } };
      }

      // No se anula algo ya cobrado: primero se anula el cobro.
      if (item.paid_at) {
        return {
          error: {
            status: 409 as const,
            code: "CONFLICT",
            message: "El ítem ya fue cobrado: anula primero el cobro",
          },
        };
      }

      const allowed = ORDER_ITEM_STATUS_TRANSITIONS[item.status];
      if (!allowed?.includes("cancelled")) {
        return {
          error: {
            status: 400 as const,
            code: "BAD_REQUEST",
            message: `No se puede anular un ítem en estado "${item.status}"`,
          },
        };
      }

      // ── Cálculo previo (sin escribir todavía) ────────────────────────────
      // Los importes los recalcula el servicio de pedidos, que es el único que
      // sabe cómo se formaron: el descuento se REAPLICA con las reglas del
      // cupón y del canje sobre el nuevo subtotal, en vez de arrastrarse como
      // importe absoluto (un 20 % arrastrado se convertía en 40 % al anular la
      // mitad de la comanda). `excludeItemIds` permite calcularlo ANTES de
      // escribir, que es lo que mantiene todas las validaciones por delante de
      // la primera escritura.
      const totales = await repriceOrderAfterCancel(
        {
          orderId,
          organizationId: tenant.organizationId,
          branchId: tenant.branchId,
          previousDiscount: order.discount,
          deliveryFee: order.delivery_fee,
          excludeItemIds: [itemId],
        },
        tx,
      );

      const todoAnulado = totales.allCancelled;
      const nuevoSubtotal = totales.subtotal;
      const nuevoDescuento = totales.discount;
      const nuevoImpuesto = totales.tax;
      const nuevoDelivery = totales.delivery_fee;
      const nuevoTotal = totales.total;

      // Lo ya cobrado no puede quedar por encima de lo que se debe: eso sería una
      // devolución encubierta y sin traza. Se exige anular el cobro primero.
      const [cobrado] = await tx
        .select({ total_paid: sum(schema.payments.amount) })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, orderId),
            eq(schema.payments.status, "completed"),
            isNull(schema.payments.voided_at),
          ),
        );
      const yaPagado = Number(cobrado?.total_paid ?? 0);

      if (yaPagado > nuevoTotal) {
        // Última validación antes de escribir: lo ya cobrado no puede quedar por
        // encima de lo que se debe. Se sale sin haber tocado nada.
        return {
          error: {
            status: 409 as const,
            code: "CONFLICT",
            message: "La orden ya tiene cobros por encima del nuevo total: anula primero el cobro",
          },
        };
      }

      // ── A partir de aquí sí se escribe ───────────────────────────────────
      const now = new Date();

      // Anulación guardada contra el estado leído: si otra petición se adelantó,
      // no vuelve ninguna fila y se responde 409 en vez de pisar el cambio.
      const [cancelledItem] = await tx
        .update(schema.orderItems)
        .set({
          status: "cancelled",
          cancelled_at: now,
          cancel_reason: reason,
          cancelled_by: userId,
        })
        .where(
          and(
            eq(schema.orderItems.id, itemId),
            eq(schema.orderItems.order_id, orderId),
            eq(schema.orderItems.status, item.status),
            isNull(schema.orderItems.cancelled_at),
          ),
        )
        .returning();

      if (!cancelledItem) {
        return {
          error: {
            status: 409 as const,
            code: "CONFLICT",
            message: "El ítem fue modificado por otra operación. Intenta de nuevo.",
          },
        };
      }

      // Si no queda ninguna línea viva, la orden entera se anula. Se salta la
      // máquina de estados a propósito: una comanda sin ítems no puede servirse.
      const nuevoEstadoOrden = todoAnulado ? "cancelled" : order.status;

      const [updatedOrder] = await tx
        .update(schema.orders)
        .set({
          subtotal: nuevoSubtotal,
          discount: nuevoDescuento,
          tax: nuevoImpuesto,
          delivery_fee: nuevoDelivery,
          total: nuevoTotal,
          status: nuevoEstadoOrden,
          updated_at: now,
        })
        .where(eq(schema.orders.id, orderId))
        .returning();

      // El importe registrado del cupón se pone al día ahora, ya en la fase de
      // escritura: si se hubiera hecho durante el cálculo, un 409 posterior lo
      // habría dejado grabado (devolver un error no aborta la transacción).
      await persistRepricedDiscount(totales, tx);

      // Re-tarifar los COBROS PENDIENTES de la orden.
      //
      // El intento de cobro que se crea al pedir con `paymentMethod` guarda el
      // total del momento. Si después se anula un plato, ese cobro pendiente
      // conservaba el importe viejo y la caja acababa capturando de más: el
      // cliente pagaba un plato que nunca recibió.
      const pendientes = await tx
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, orderId),
            eq(schema.payments.status, "pending"),
            isNull(schema.payments.voided_at),
          ),
        );

      if (pendientes.length > 0) {
        const saldo = Math.max(0, nuevoTotal - yaPagado);
        if (saldo === 0) {
          // Ya no hay nada que cobrar: el intento pendiente se anula con motivo,
          // nunca se borra, para que quede la traza de por qué desapareció.
          await tx
            .update(schema.payments)
            .set({
              status: "refunded",
              voided_at: now,
              voided_by: userId,
              void_reason: "Anulado al re-tarifar la orden por anulación de un plato",
            })
            .where(
              and(
                eq(schema.payments.order_id, orderId),
                eq(schema.payments.status, "pending"),
                isNull(schema.payments.voided_at),
              ),
            );
        } else if (pendientes.length === 1) {
          // Caso normal: un único intento pendiente, se ajusta al nuevo saldo.
          await tx
            .update(schema.payments)
            .set({ amount: saldo })
            .where(eq(schema.payments.id, pendientes[0].id));
        }
        // Con varios intentos pendientes no se reparte automáticamente: no hay
        // forma de saber qué parte le toca a cada uno. El cajero lo resuelve
        // anulando y volviendo a cobrar, y el 409 de arriba ya protege el caso
        // en que lo cobrado supere lo debido.
      }

      // La traza entra en la misma transacción: si el recálculo se revierte, la
      // traza no debe quedar afirmando una anulación que no ocurrió.
      await auditFromContext(
        c,
        {
          action: "order_item.cancel",
          entityType: "order_item",
          entityId: cancelledItem.id,
          summary: `Anulado "${cancelledItem.name}" x${cancelledItem.quantity} de la orden ${order.order_number}: ${reason}`,
          before: {
            item: { status: item.status, total: item.total },
            order: {
              status: order.status,
              subtotal: order.subtotal,
              discount: order.discount,
              tax: order.tax,
              delivery_fee: order.delivery_fee,
              total: order.total,
            },
          },
          after: {
            item: { status: cancelledItem.status, reason },
            order: {
              status: updatedOrder.status,
              subtotal: updatedOrder.subtotal,
              discount: updatedOrder.discount,
              tax: updatedOrder.tax,
              delivery_fee: updatedOrder.delivery_fee,
              total: updatedOrder.total,
            },
          },
        },
        tx,
      );

      return {
        error: null,
        order,
        updatedOrder,
        cancelledItem,
        todoAnulado,
      };
    });

    if (txResult.error) {
      const { status, code, message } = txResult.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    const { order, updatedOrder, cancelledItem, todoAnulado } = txResult;

    // Aviso a la sede (comandas, mozos) y a la pantalla del comensal, que debe
    // dejar de esperar un plato que ya no va a llegar.
    const cancelPayload = {
      type: "order:item_cancelled",
      payload: {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.order_number,
        item: {
          id: cancelledItem.id,
          name: cancelledItem.name,
          quantity: cancelledItem.quantity,
          status: cancelledItem.status,
        },
        reason: cancelledItem.cancel_reason,
        orderStatus: updatedOrder.status,
        totals: {
          subtotal: updatedOrder.subtotal,
          discount: updatedOrder.discount,
          tax: updatedOrder.tax,
          total: updatedOrder.total,
        },
      },
      timestamp: Date.now(),
    };
    await realtime.publish(`branch:${tenant.branchId}`, cancelPayload);
    await realtime.publish(`branch:${tenant.branchId}:kitchen`, cancelPayload);
    if (order.table_session_id) {
      await realtime.publish(`session:${order.table_session_id}`, cancelPayload);
    }

    // Si la orden quedó vacía se emite además el evento de orden anulada, que es
    // el que ya escuchan las pantallas existentes.
    if (todoAnulado) {
      const orderPayload = {
        type: "order:cancelled",
        payload: {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.order_number,
        },
        timestamp: Date.now(),
      };
      await realtime.publish(`branch:${tenant.branchId}`, orderPayload);
      await realtime.publish(`branch:${tenant.branchId}:kitchen`, orderPayload);
      if (order.table_session_id) {
        await realtime.publish(`session:${order.table_session_id}`, orderPayload);
      }
    }

    return c.json({
      success: true,
      data: {
        item: cancelledItem,
        order: {
          id: updatedOrder.id,
          order_number: updatedOrder.order_number,
          status: updatedOrder.status,
          subtotal: updatedOrder.subtotal,
          discount: updatedOrder.discount,
          tax: updatedOrder.tax,
          delivery_fee: updatedOrder.delivery_fee,
          total: updatedOrder.total,
        },
        order_cancelled: todoAnulado,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /items/:id/status - Avanzar el estado de un ítem
// ---------------------------------------------------------------------------

kitchen.patch(
  "/items/:id/status",
  requirePermission("orders:update_item_status"),
  zValidator("param", idParamSchema),
  zValidator("json", updateOrderItemStatusSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant");

    // Una sola consulta y con el ámbito completo del token: antes se leía el
    // ítem por id sin filtro y solo después se comparaba la sede, sin mirar la
    // organización. Un ítem de otro local simplemente no existe para este token.
    const [row] = await db
      .select({
        item_status: schema.orderItems.status,
        order_id: schema.orders.id,
        order_number: schema.orders.order_number,
        table_session_id: schema.orders.table_session_id,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.order_id, schema.orders.id))
      .where(
        and(
          eq(schema.orderItems.id, id),
          eq(schema.orders.organization_id, tenant.organizationId),
          eq(schema.orders.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!row) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Ítem no encontrado" } },
        404,
      );
    }

    const allowed = ORDER_ITEM_STATUS_TRANSITIONS[row.item_status];
    if (!allowed?.includes(status)) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: `No se puede cambiar de "${row.item_status}" a "${status}"` },
        },
        400,
      );
    }

    // Escritura guardada contra el estado leído: en cocina hay varias tablets
    // sobre la misma comanda, y sin esto la última en pulsar pisaba el avance
    // (o el "86") de la anterior sin que nadie se enterara.
    const [updated] = await db
      .update(schema.orderItems)
      .set({ status })
      .where(and(eq(schema.orderItems.id, id), eq(schema.orderItems.status, row.item_status)))
      .returning();

    if (!updated) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "El ítem fue modificado por otra operación. Intenta de nuevo.",
          },
        },
        409,
      );
    }

    const order = { id: row.order_id, order_number: row.order_number, table_session_id: row.table_session_id };
    const itemPayload = {
      type: "order:item_status",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        item: { id: updated.id, name: updated.name, quantity: updated.quantity, status: updated.status },
      },
      timestamp: Date.now(),
    };
    await realtime.publish(`branch:${tenant.branchId}`, itemPayload);
    await realtime.publish(`branch:${tenant.branchId}:kitchen`, itemPayload);
    if (order.table_session_id) {
      await realtime.publish(`session:${order.table_session_id}`, itemPayload);
    }

    return c.json({ success: true, data: updated });
  },
);

// ---------------------------------------------------------------------------
// Disponibilidad de la carta desde cocina (plato agotado)
// ---------------------------------------------------------------------------

type AvailabilityResult =
  | { error: { status: 404; code: string; message: string } }
  | {
      error: null;
      item: { id: string; name: string; is_available: boolean };
      changed: boolean;
    };

/**
 * Marca un plato como disponible/agotado dentro de la sede del token.
 *
 * Es idempotente: si ya estaba en ese estado se responde 200 sin auditar ni
 * publicar, para que un doble toque en la tablet de cocina no ensucie la traza.
 */
async function setMenuItemAvailability(
  c: Context<AppEnv>,
  id: string,
  isAvailable: boolean,
): Promise<AvailabilityResult> {
  const tenant = c.get("tenant");

  // Ámbito del token: organización + sede, y nunca un plato borrado. La
  // consulta de lectura anterior no bastaba: entre leer y escribir cabía otro
  // toque, y el plato se auditaba y anunciaba dos veces por un solo cambio.
  const ambito = and(
    eq(schema.menuItems.id, id),
    eq(schema.menuItems.organization_id, tenant.organizationId),
    eq(schema.menuItems.branch_id, tenant.branchId),
    isNull(schema.menuItems.deleted_at),
  );

  const columnas = {
    id: schema.menuItems.id,
    name: schema.menuItems.name,
    is_available: schema.menuItems.is_available,
  };

  // Cambio atómico: solo actualiza si el plato está en el estado contrario.
  const [updated] = await db
    .update(schema.menuItems)
    .set({ is_available: isAvailable })
    .where(and(ambito, ne(schema.menuItems.is_available, isAvailable)))
    .returning(columnas);

  if (!updated) {
    // No se tocó ninguna fila: o ya estaba en ese estado (respuesta idempotente,
    // sin traza ni evento) o el plato no existe en esta sede.
    const [actual] = await db.select(columnas).from(schema.menuItems).where(ambito).limit(1);
    if (!actual) {
      return { error: { status: 404, code: "NOT_FOUND", message: "Plato no encontrado" } };
    }
    return { error: null, item: actual, changed: false };
  }

  await auditFromContext(c, {
    action: "menu.availability_change",
    entityType: "menu_item",
    entityId: updated.id,
    summary: isAvailable
      ? `Plato "${updated.name}" repuesto en la carta`
      : `Plato "${updated.name}" marcado como agotado`,
    before: { is_available: !isAvailable },
    after: { is_available: updated.is_available },
  });

  // Las cartas abiertas (comensales en la sede) y las pantallas de staff deben
  // refrescarse solas: si no, se siguen pidiendo platos que ya no hay.
  const payload = {
    type: "menu:availability",
    payload: {
      menuItemId: updated.id,
      name: updated.name,
      isAvailable: updated.is_available,
    },
    timestamp: Date.now(),
  };
  await realtime.publish(`branch:${tenant.branchId}`, payload);
  await realtime.publish(`branch:${tenant.branchId}:kitchen`, payload);
  // `branch:{id}` es el canal al que también están suscritos los comensales
  // (ver allowedRoomsFor en routes/realtime.ts), así que la carta abierta en la
  // mesa se entera del plato agotado sin recargar.

  return { error: null, item: updated, changed: true };
}

// POST /menu-items/:id/unavailable - Se acabó: fuera de la carta
kitchen.post(
  "/menu-items/:id/unavailable",
  requirePermission("menu:availability"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const result = await setMenuItemAvailability(c, id, false);

    if (result.error) {
      const { status, code, message } = result.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    return c.json({ success: true, data: { ...result.item, changed: result.changed } });
  },
);

// POST /menu-items/:id/available - Hay de nuevo: vuelve a la carta
kitchen.post(
  "/menu-items/:id/available",
  requirePermission("menu:availability"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const result = await setMenuItemAvailability(c, id, true);

    if (result.error) {
      const { status, code, message } = result.error;
      return c.json({ success: false, error: { code, message } }, status);
    }

    return c.json({ success: true, data: { ...result.item, changed: result.changed } });
  },
);

export { kitchen };
