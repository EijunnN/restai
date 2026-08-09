import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  createModifierGroupSchema,
  createModifierSchema,
  updateModifierGroupSchema,
  updateModifierSchema,
  idParamSchema,
  bulkUpdateMenuItemsSchema,
  bulkItemIdsSchema,
  bulkLinkModifierGroupSchema,
  reorderSchema,
  reorderItemsSchema,
} from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext, auditMoney } from "../lib/audit.js";
import { realtime } from "../infrastructure/container.js";

const menu = new Hono<AppEnv>();

menu.use("*", authMiddleware);
menu.use("*", tenantMiddleware);
menu.use("*", requireBranch);

// --- Categories ---

// GET /categories
menu.get("/categories", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  // Sin este orden, la columna de categorías salía como quisiera Postgres:
  // arrastrarlas para colocarlas guardaba bien y la pantalla seguía enseñándolas
  // en otro orden en la siguiente recarga, así que el arrastre parecía roto.
  const categories = await db
    .select()
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.branch_id, tenant.branchId),
        eq(schema.menuCategories.organization_id, tenant.organizationId),
      ),
    )
    .orderBy(asc(schema.menuCategories.sort_order), asc(schema.menuCategories.name));

  return c.json({ success: true, data: categories });
});

/**
 * Reordenar: se recibe la lista COMPLETA del ámbito en su orden final y se
 * escriben las posiciones 0,1,2… en UNA sentencia dentro de una transacción.
 *
 * Tres decisiones que no son de estilo:
 *
 * - **Lista completa, no "este al puesto 4".** Con posiciones relativas, dos
 *   administradores moviendo a la vez dejan dos elementos en el mismo puesto y
 *   un hueco, y nadie se entera hasta que el comensal ve la carta rara.
 * - **409 si la lista no cuadra.** Si alguien creó o borró algo mientras el
 *   otro arrastraba, escribir de todas formas colocaría lo nuevo en un sitio
 *   que nadie eligió. Mejor rechazar y que la pantalla recargue.
 * - **Un solo UPDATE con CASE.** N updates en bucle son N viajes y una ventana
 *   más larga con las filas bloqueadas.
 */
function expresionDeOrden(columnaId: any, columnaOrden: any, ids: string[]) {
  const casos = sql.join(
    // El `::int` no es adorno: sin él Postgres trata el parámetro como texto y
    // rechaza la sentencia entera ("la columna sort_order es de tipo integer
    // pero la expresión es de tipo text").
    ids.map((id, indice) => sql`when ${columnaId} = ${id}::uuid then ${indice}::int`),
    sql` `,
  );

  // El `else` conserva el valor actual. Sin él, una fila que entrara en el
  // ámbito y no viniera en la lista recibiría NULL y reventaría contra el
  // NOT NULL con un 500. La comprobación previa hace que no debería ocurrir;
  // esto decide si ese "no debería" acaba en un error feo o en no tocar nada.
  return sql`case ${casos} else ${columnaOrden} end`;
}

/**
 * La siguiente posición libre del ámbito.
 *
 * Lo que se creaba nacía en la posición 0 —el primero de la carta— porque el
 * validador tenía `.default(0)`. Un plato recién dado de alta se colaba delante
 * del plato estrella sin que nadie lo pidiera, y en cuanto el orden empieza a
 * importar de verdad eso es un problema diario.
 */
async function siguientePosicion(
  ejecutor: typeof db,
  tabla: any,
  columnaOrden: any,
  ambito: any,
): Promise<number> {
  const [fila] = await ejecutor
    .select({ maximo: sql<number | null>`max(${columnaOrden})` })
    .from(tabla)
    .where(ambito);
  return (fila?.maximo ?? -1) + 1;
}

// PATCH /categories/reorder — debe ir ANTES que /categories/:id
menu.patch(
  "/categories/reorder",
  requirePermission("menu:update"),
  zValidator("json", reorderSchema),
  async (c) => {
    const { ids } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const ambito = and(
      eq(schema.menuCategories.branch_id, tenant.branchId),
      eq(schema.menuCategories.organization_id, tenant.organizationId),
    );

    const desfasada = await db.transaction(async (tx) => {
      const actuales = await tx
        .select({ id: schema.menuCategories.id })
        .from(schema.menuCategories)
        .where(ambito)
        .for("update");

      const enviadas = new Set(ids);
      if (actuales.length !== ids.length || actuales.some((f) => !enviadas.has(f.id))) {
        return true;
      }

      await tx
        .update(schema.menuCategories)
        .set({ sort_order: expresionDeOrden(schema.menuCategories.id, schema.menuCategories.sort_order, ids) })
        .where(ambito);

      return false;
    });

    if (desfasada) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "La lista de categorías ha cambiado. Recarga y vuelve a ordenarla.",
          },
        },
        409,
      );
    }

    return c.json({ success: true, data: { reordered: ids.length } });
  },
);

// POST /categories
menu.post(
  "/categories",
  requirePermission("menu:create"),
  zValidator("json", createCategorySchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [category] = await db
      .insert(schema.menuCategories)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description,
        image_url: body.imageUrl,
        sort_order:
          body.sortOrder ??
          (await siguientePosicion(
            db,
            schema.menuCategories,
            schema.menuCategories.sort_order,
            and(
              eq(schema.menuCategories.branch_id, tenant.branchId),
              eq(schema.menuCategories.organization_id, tenant.organizationId),
            ),
          )),
        is_active: body.isActive,
      })
      .returning();

    return c.json({ success: true, data: category }, 201);
  },
);

// PATCH /categories/:id
menu.patch(
  "/categories/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateCategorySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.imageUrl !== undefined) updateData.image_url = body.imageUrl;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    const [updated] = await db
      .update(schema.menuCategories)
      .set(updateData)
      .where(
        and(
          eq(schema.menuCategories.id, id),
          eq(schema.menuCategories.branch_id, tenant.branchId),
          eq(schema.menuCategories.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /categories/:id
menu.delete(
  "/categories/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Verify the category belongs to this tenant
    const [category] = await db
      .select({ id: schema.menuCategories.id })
      .from(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, id),
          eq(schema.menuCategories.branch_id, tenant.branchId),
          eq(schema.menuCategories.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!category) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    // Deleting a category cascades onto its menu items (onDelete: "cascade"),
    // which would destroy live items and throw on order-history FKs (restrict).
    // Block the delete while any menu item still references the category.
    const [{ count: itemCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.category_id, id));

    if (itemCount > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar: está en uso",
          },
        },
        409,
      );
    }

    const [deleted] = await db
      .delete(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, id),
          eq(schema.menuCategories.branch_id, tenant.branchId),
          eq(schema.menuCategories.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Categoría eliminada" } });
  },
);

// --- Items ---

// GET /items
menu.get("/items", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const categoryId = c.req.query("categoryId");

  const includeDeleted = c.req.query("include_deleted") === "true";

  const conditions = [
    eq(schema.menuItems.branch_id, tenant.branchId),
    eq(schema.menuItems.organization_id, tenant.organizationId),
  ];

  if (!includeDeleted) {
    conditions.push(isNull(schema.menuItems.deleted_at));
  }

  if (categoryId) {
    conditions.push(eq(schema.menuItems.category_id, categoryId));
  }

  // `sort_order` existía en la tabla y en los validadores, pero nadie ordenaba
  // por él: el listado salía en el orden que quisiera Postgres y la carta se
  // recolocaba sola entre recargas. El nombre desempata para que dos productos
  // con la misma posición no bailen entre peticiones.
  const items = await db
    .select()
    .from(schema.menuItems)
    .where(and(...conditions))
    .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.name));

  // Cuántos grupos de modificadores cuelgan de cada plato. La pantalla de
  // administración lo enseña en cada fila y filtra por "sin modificadores";
  // resolverlo en el cliente sería una petición por plato. Una sola consulta
  // agrupada, y los platos sin grupos simplemente no aparecen en ella.
  const conteo = items.length
    ? await db
        .select({
          item_id: schema.menuItemModifierGroups.item_id,
          count: sql<number>`count(*)`,
        })
        .from(schema.menuItemModifierGroups)
        .where(
          inArray(
            schema.menuItemModifierGroups.item_id,
            items.map((i) => i.id),
          ),
        )
        .groupBy(schema.menuItemModifierGroups.item_id)
    : [];

  const gruposPorPlato = new Map(conteo.map((f) => [f.item_id, Number(f.count)]));

  return c.json({
    success: true,
    data: items.map((item) => ({
      ...item,
      modifier_group_count: gruposPorPlato.get(item.id) ?? 0,
    })),
  });
});

// PATCH /items/reorder — el orden de los platos DENTRO de una categoría
menu.patch(
  "/items/reorder",
  requirePermission("menu:update"),
  zValidator("json", reorderItemsSchema),
  async (c) => {
    const { ids, categoryId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // El ámbito es la categoría, no la sede: la posición de un plato es
    // relativa a los de su categoría, porque así se agrupa la carta. Reindexar
    // una mezcla de categorías escribiría posiciones cruzadas.
    const ambito = and(
      eq(schema.menuItems.category_id, categoryId),
      eq(schema.menuItems.branch_id, tenant.branchId),
      eq(schema.menuItems.organization_id, tenant.organizationId),
      isNull(schema.menuItems.deleted_at),
    );

    const desfasada = await db.transaction(async (tx) => {
      const actuales = await tx
        .select({ id: schema.menuItems.id })
        .from(schema.menuItems)
        .where(ambito)
        .for("update");

      const enviados = new Set(ids);
      if (actuales.length !== ids.length || actuales.some((f) => !enviados.has(f.id))) {
        return true;
      }

      await tx
        .update(schema.menuItems)
        .set({ sort_order: expresionDeOrden(schema.menuItems.id, schema.menuItems.sort_order, ids) })
        .where(ambito);

      return false;
    });

    if (desfasada) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message:
              "Los productos de esta categoría han cambiado. Recarga y vuelve a ordenarlos.",
          },
        },
        409,
      );
    }

    return c.json({ success: true, data: { reordered: ids.length } });
  },
);

/**
 * Cambia varios productos de una vez, dentro de UNA transacción.
 *
 * El caso que lo justifica es diario: se acabó la merluza y hay que agotar los
 * tres platos que la llevan. Uno a uno son tres peticiones sin atomicidad —si
 * la segunda falla, quedan una aplicada y dos sin aplicar, y la pantalla no
 * tiene forma de saber cuáles.
 *
 * Devuelve las filas ANTES y DESPUÉS: el "deshacer" de la pantalla necesita el
 * estado previo, y sin él solo podría adivinarlo.
 */
menu.patch(
  "/items/bulk",
  requirePermission("menu:update"),
  zValidator("json", bulkUpdateMenuItemsSchema),
  async (c) => {
    const { ids, patch } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (patch.isAvailable !== undefined) updateData.is_available = patch.isAvailable;
    if (patch.categoryId !== undefined) updateData.category_id = patch.categoryId;
    if (patch.spiceLevel !== undefined) updateData.spice_level = patch.spiceLevel;
    if (patch.allergens !== undefined) updateData.allergens = patch.allergens;
    if (patch.dietaryTags !== undefined) updateData.dietary_tags = patch.dietaryTags;

    // El precio se calcula EN LA BASE, fila a fila, dentro de la transacción.
    // Traerlo, multiplicarlo en JavaScript y devolverlo abriría una ventana en
    // la que otro cambio de precio se pierde, y con dinero eso no se negocia.
    // La división es entera y va redondeada: `10000` es el 100 %.
    if (patch.price) {
      const columna = schema.menuItems.price;
      if (patch.price.mode === "percent") {
        const factor = 10000 + patch.price.value;
        if (factor < 0) {
          return c.json(
            {
              success: false,
              error: {
                code: "BAD_REQUEST",
                message: "Ese descuento deja el precio por debajo de cero",
              },
            },
            400,
          );
        }
        updateData.price = sql`greatest(0, round(${columna} * ${factor}::numeric / 10000))::int`;
      } else if (patch.price.mode === "delta") {
        updateData.price = sql`greatest(0, ${columna} + ${patch.price.value})`;
      } else {
        if (patch.price.value < 0) {
          return c.json(
            {
              success: false,
              error: { code: "BAD_REQUEST", message: "Un precio no puede ser negativo" },
            },
            400,
          );
        }
        updateData.price = patch.price.value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Nada que actualizar" } },
        400,
      );
    }

    const ambito = and(
      inArray(schema.menuItems.id, ids),
      eq(schema.menuItems.branch_id, tenant.branchId),
      eq(schema.menuItems.organization_id, tenant.organizationId),
      isNull(schema.menuItems.deleted_at),
    );

    const result = await db.transaction(async (tx) => {
      // El "antes" se lee dentro de la transacción: fuera, otro cambio entre
      // la lectura y la escritura haría que el deshacer restaurase un valor
      // que ya no era el vigente.
      const before = await tx
        .select({
          id: schema.menuItems.id,
          name: schema.menuItems.name,
          price: schema.menuItems.price,
          is_available: schema.menuItems.is_available,
          category_id: schema.menuItems.category_id,
          spice_level: schema.menuItems.spice_level,
          allergens: schema.menuItems.allergens,
          dietary_tags: schema.menuItems.dietary_tags,
        })
        .from(schema.menuItems)
        .where(ambito)
        .for("update");

      // Un id de otra sede simplemente no está en `before`. Se responde 404 en
      // vez de aplicar el cambio a medias sobre los que sí existen.
      if (before.length !== ids.length) {
        return { error: true as const, before: [], after: [] };
      }

      const after = await tx.update(schema.menuItems).set(updateData).where(ambito).returning();
      return { error: false as const, before, after };
    });

    if (result.error) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Alguno de los productos no existe en esta sede",
          },
        },
        404,
      );
    }

    // La disponibilidad no es un campo más: es el canal que miran la carta
    // abierta en la mesa y el POS. Cambiarla en silencio deja a esas pantallas
    // ofreciendo un plato que ya no hay, así que este lote emite exactamente lo
    // mismo que la ruta de cocina — traza y evento — por cada plato que de
    // verdad cambió. Va DESPUÉS de confirmar la transacción: avisar de algo que
    // luego se revierte es peor que no avisar.
    if (patch.isAvailable !== undefined) {
      const previo = new Map(result.before.map((fila) => [fila.id, fila.is_available]));

      for (const item of result.after) {
        if (previo.get(item.id) === item.is_available) continue;

        await auditFromContext(c, {
          action: "menu.availability_change",
          entityType: "menu_item",
          entityId: item.id,
          summary: item.is_available
            ? `Plato "${item.name}" repuesto en la carta`
            : `Plato "${item.name}" marcado como agotado`,
          before: { is_available: !item.is_available },
          after: { is_available: item.is_available },
        });

        const payload = {
          type: "menu:availability",
          payload: {
            menuItemId: item.id,
            name: item.name,
            isAvailable: item.is_available,
          },
          timestamp: Date.now(),
        };
        await realtime.publish(`branch:${tenant.branchId}`, payload);
        await realtime.publish(`branch:${tenant.branchId}:kitchen`, payload);
      }
    }

    // Cambiar precios en lote es la operación más fácil de hacer sin querer y
    // la más difícil de reconstruir después. Queda traza por plato, con el
    // importe anterior y el nuevo.
    if (patch.price) {
      const antes = new Map(result.before.map((fila) => [fila.id, fila.price]));

      for (const item of result.after) {
        const previo = antes.get(item.id);
        if (previo === undefined || previo === item.price) continue;

        await auditFromContext(c, {
          action: "menu.price_change",
          entityType: "menu_item",
          entityId: item.id,
          summary: `Precio de "${item.name}": ${auditMoney(previo)} → ${auditMoney(item.price)}`,
          before: { price: previo },
          after: { price: item.price },
        });
      }
    }

    return c.json({
      success: true,
      data: { updated: result.after.length, before: result.before, items: result.after },
    });
  },
);

// POST /items
menu.post(
  "/items",
  requirePermission("menu:create"),
  zValidator("json", createMenuItemSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [category] = await db
      .select({ id: schema.menuCategories.id })
      .from(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, body.categoryId),
          eq(schema.menuCategories.branch_id, tenant.branchId),
          eq(schema.menuCategories.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!category) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Categoría no encontrada" } },
        404,
      );
    }

    const [item] = await db
      .insert(schema.menuItems)
      .values({
        category_id: body.categoryId,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description,
        price: body.price,
        image_url: body.imageUrl,
        is_available: body.isAvailable,
        // Al final de SU categoría, no al principio de la carta.
        sort_order:
          body.sortOrder ??
          (await siguientePosicion(
            db,
            schema.menuItems,
            schema.menuItems.sort_order,
            and(
              eq(schema.menuItems.category_id, body.categoryId),
              eq(schema.menuItems.branch_id, tenant.branchId),
              isNull(schema.menuItems.deleted_at),
            ),
          )),
        preparation_time_min: body.preparationTimeMin,
        // La carta del comensal ya pinta estos tres, pero hasta ahora no había
        // forma de cargarlos: solo los ponía el seed.
        allergens: body.allergens ?? [],
        dietary_tags: body.dietaryTags ?? [],
        spice_level: body.spiceLevel ?? null,
      })
      .returning();

    return c.json({ success: true, data: item }, 201);
  },
);

// PATCH /items/:id
menu.patch(
  "/items/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateMenuItemSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.categoryId !== undefined) updateData.category_id = body.categoryId;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.imageUrl !== undefined) updateData.image_url = body.imageUrl;
    if (body.isAvailable !== undefined) updateData.is_available = body.isAvailable;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.preparationTimeMin !== undefined) updateData.preparation_time_min = body.preparationTimeMin;
    if (body.allergens !== undefined) updateData.allergens = body.allergens;
    if (body.dietaryTags !== undefined) updateData.dietary_tags = body.dietaryTags;
    if (body.spiceLevel !== undefined) updateData.spice_level = body.spiceLevel;

    // Un `null` explícito VACÍA el campo. Antes el esquema lo rechazaba y no
    // había manera de quitarle la foto a un plato una vez puesta.
    if (Object.keys(updateData).length === 0) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Nada que actualizar" } },
        400,
      );
    }

    const [updated] = await db
      .update(schema.menuItems)
      .set(updateData)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

/**
 * Vincula UN grupo de modificadores a varios productos de una vez.
 *
 * "Se acaba de crear el grupo Guarnición y lo llevan los doce fondos": doce
 * clics de menú desplegable, uno por plato, sin forma de saber si alguno se
 * quedó fuera. Los que ya lo tenían no molestan —el vínculo es idempotente— y
 * se devuelven aparte los que de verdad se han añadido, que son los únicos que
 * debe quitar el "Deshacer".
 */
menu.post(
  "/items/bulk/modifier-groups",
  requirePermission("menu:update"),
  zValidator("json", bulkLinkModifierGroupSchema),
  async (c) => {
    const { ids, groupId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [grupo] = await db
      .select({ id: schema.modifierGroups.id, name: schema.modifierGroups.name })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!grupo) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    const resultado = await db.transaction(async (tx) => {
      const platos = await tx
        .select({ id: schema.menuItems.id })
        .from(schema.menuItems)
        .where(
          and(
            inArray(schema.menuItems.id, ids),
            eq(schema.menuItems.branch_id, tenant.branchId),
            eq(schema.menuItems.organization_id, tenant.organizationId),
            isNull(schema.menuItems.deleted_at),
          ),
        );

      if (platos.length !== ids.length) return { error: true as const, vinculados: [] };

      const insertados = await tx
        .insert(schema.menuItemModifierGroups)
        .values(ids.map((item_id) => ({ item_id, group_id: groupId })))
        .onConflictDoNothing()
        .returning({ item_id: schema.menuItemModifierGroups.item_id });

      return { error: false as const, vinculados: insertados.map((f) => f.item_id) };
    });

    if (resultado.error) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Alguno de los productos no existe en esta sede",
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: {
        groupId,
        groupName: grupo.name,
        linked: resultado.vinculados,
        alreadyLinked: ids.length - resultado.vinculados.length,
      },
    });
  },
);

/**
 * Archiva varios productos a la vez, o los devuelve.
 *
 * Borrar es SUAVE: la fila se queda con su `deleted_at` puesto porque los
 * pedidos históricos la referencian. Por eso el mismo endpoint sirve para las
 * dos direcciones y el "Deshacer" es real, no una promesa.
 *
 * Exige `menu:delete` también para reponer: quien no puede archivar tampoco
 * tiene por qué poder resucitar lo que archivó otro.
 */
menu.post(
  "/items/bulk/delete",
  requirePermission("menu:delete"),
  zValidator("json", bulkItemIdsSchema.extend({ restore: z.boolean().optional() })),
  async (c) => {
    const { ids, restore } = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const archivando = !restore;

    const resultado = await db.transaction(async (tx) => {
      const existentes = await tx
        .select({ id: schema.menuItems.id, name: schema.menuItems.name })
        .from(schema.menuItems)
        .where(
          and(
            inArray(schema.menuItems.id, ids),
            eq(schema.menuItems.branch_id, tenant.branchId),
            eq(schema.menuItems.organization_id, tenant.organizationId),
          ),
        )
        .for("update");

      if (existentes.length !== ids.length) return { error: true as const, filas: [] };

      const filas = await tx
        .update(schema.menuItems)
        .set({ deleted_at: archivando ? new Date() : null })
        .where(
          and(
            inArray(schema.menuItems.id, ids),
            eq(schema.menuItems.branch_id, tenant.branchId),
            eq(schema.menuItems.organization_id, tenant.organizationId),
            archivando
              ? isNull(schema.menuItems.deleted_at)
              : sql`${schema.menuItems.deleted_at} is not null`,
          ),
        )
        .returning({ id: schema.menuItems.id, name: schema.menuItems.name });

      return { error: false as const, filas };
    });

    if (resultado.error) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Alguno de los productos no existe en esta sede",
          },
        },
        404,
      );
    }

    for (const fila of resultado.filas) {
      await auditFromContext(c, {
        action: archivando ? "menu.delete" : "menu.restore",
        entityType: "menu_item",
        entityId: fila.id,
        summary: archivando
          ? `Producto "${fila.name}" archivado`
          : `Producto "${fila.name}" devuelto a la carta`,
      });
    }

    return c.json({
      success: true,
      data: { changed: resultado.filas.length, items: resultado.filas },
    });
  },
);

// DELETE /items/:id (soft delete)
menu.delete(
  "/items/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [archived] = await db
      .update(schema.menuItems)
      .set({ deleted_at: new Date() })
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
          isNull(schema.menuItems.deleted_at),
        ),
      )
      .returning();

    if (!archived) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Item archivado" } });
  },
);

// PATCH /items/:id/restore (restore soft-deleted item)
menu.patch(
  "/items/:id/restore",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [restored] = await db
      .update(schema.menuItems)
      .set({ deleted_at: null })
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!restored) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: restored });
  },
);

// --- Modifier Groups ---

// POST /modifier-groups
menu.post(
  "/modifier-groups",
  requirePermission("menu:create"),
  zValidator("json", createModifierGroupSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [group] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        name: body.name,
        min_selections: body.minSelections,
        max_selections: body.maxSelections,
        is_required: body.isRequired,
      })
      .returning();

    return c.json({ success: true, data: group }, 201);
  },
);

// --- Modifiers ---

// POST /modifiers
menu.post(
  "/modifiers",
  requirePermission("menu:create"),
  zValidator("json", createModifierSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, body.groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    const [modifier] = await db
      .insert(schema.modifiers)
      .values({
        group_id: body.groupId,
        name: body.name,
        price: body.price,
        is_available: body.isAvailable,
        // Al final del grupo: quien añade "Bien picante" a una escala lo quiere
        // detrás de "Picante", no delante de "Sin ají".
        sort_order: await siguientePosicion(
          db,
          schema.modifiers,
          schema.modifiers.sort_order,
          eq(schema.modifiers.group_id, body.groupId),
        ),
      })
      .returning();

    return c.json({ success: true, data: modifier }, 201);
  },
);

// POST /items/:id/modifier-groups - Link modifier group to item
menu.post(
  "/items/:id/modifier-groups",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ groupId: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { groupId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item || !group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item o grupo no encontrado" } },
        404,
      );
    }

    await db
      .insert(schema.menuItemModifierGroups)
      .values({ item_id: id, group_id: groupId })
      .onConflictDoNothing();

    return c.json({ success: true, data: { message: "Grupo de modificadores vinculado" } }, 201);
  },
);

// GET /modifier-groups
menu.get("/modifier-groups", requirePermission("menu:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const groups = await db
    .select()
    .from(schema.modifierGroups)
    .where(
      and(
        eq(schema.modifierGroups.branch_id, tenant.branchId),
        eq(schema.modifierGroups.organization_id, tenant.organizationId),
      ),
    );

  // Fetch modifiers for each group
  const groupIds = groups.map((g) => g.id);
  let allModifiers: any[] = [];
  if (groupIds.length > 0) {
    allModifiers = await db
      .select()
      .from(schema.modifiers)
      .where(
        groupIds.length === 1
          ? eq(schema.modifiers.group_id, groupIds[0])
          : inArray(schema.modifiers.group_id, groupIds)
      )
      // En una escala —"Sin ají, Suave, Picante, Bien picante"— el orden ES el
      // significado, y sin esto salía el que quisiera Postgres.
      .orderBy(asc(schema.modifiers.sort_order), asc(schema.modifiers.name));
  }

  /*
    Cuántos productos usa cada grupo.

    Un grupo de modificadores se comparte entre platos, así que cambiar su
    mínimo o su obligatoriedad alcanza a todos a la vez. Sin este número, quien
    edita "Término de la carne" no tiene forma de saber si toca un plato o doce.

    Va en UNA consulta agrupada, no en una por grupo. La tabla puente no lleva
    columnas de sede, de ahí el join contra `menu_items` para no contar platos
    de otra sede ni archivados.
  */
  const usage =
    groupIds.length > 0
      ? await db
          .select({
            group_id: schema.menuItemModifierGroups.group_id,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.menuItemModifierGroups)
          .innerJoin(
            schema.menuItems,
            eq(schema.menuItems.id, schema.menuItemModifierGroups.item_id),
          )
          .where(
            and(
              inArray(schema.menuItemModifierGroups.group_id, groupIds),
              eq(schema.menuItems.branch_id, tenant.branchId),
              eq(schema.menuItems.organization_id, tenant.organizationId),
              isNull(schema.menuItems.deleted_at),
            ),
          )
          .groupBy(schema.menuItemModifierGroups.group_id)
      : [];

  const usageByGroup = new Map(usage.map((u) => [u.group_id, Number(u.count)]));

  const result = groups.map((g) => ({
    ...g,
    modifiers: allModifiers.filter((m) => m.group_id === g.id),
    used_in_items: usageByGroup.get(g.id) ?? 0,
  }));

  return c.json({ success: true, data: result });
});

/**
 * Qué productos usan este grupo.
 *
 * Es el sentido que faltaba: la API sabía decir qué grupos tiene un plato, pero
 * no qué platos tiene un grupo. Sin eso, el diálogo de borrado prometía la
 * consecuencia en prosa —"los productos vinculados perderán este grupo"— sin
 * poder nombrar ni uno.
 */
menu.get(
  "/modifier-groups/:id/items",
  requirePermission("menu:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // La tabla puente no tiene sede: sin comprobar antes que el grupo es de
    // esta, se podrían enumerar los platos de otro cliente pasando su uuid.
    const [group] = await db
      .select({ id: schema.modifierGroups.id, name: schema.modifierGroups.name })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    const items = await db
      .select({
        id: schema.menuItems.id,
        name: schema.menuItems.name,
        category_id: schema.menuItems.category_id,
        is_available: schema.menuItems.is_available,
      })
      .from(schema.menuItemModifierGroups)
      .innerJoin(
        schema.menuItems,
        eq(schema.menuItems.id, schema.menuItemModifierGroups.item_id),
      )
      .where(
        and(
          eq(schema.menuItemModifierGroups.group_id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
          isNull(schema.menuItems.deleted_at),
        ),
      )
      .orderBy(asc(schema.menuItems.name));

    return c.json({ success: true, data: { group, items } });
  },
);

// PATCH /modifier-groups/:id
menu.patch(
  "/modifier-groups/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateModifierGroupSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.minSelections !== undefined) updateData.min_selections = body.minSelections;
    if (body.maxSelections !== undefined) updateData.max_selections = body.maxSelections;
    if (body.isRequired !== undefined) updateData.is_required = body.isRequired;

    const [updated] = await db
      .update(schema.modifierGroups)
      .set(updateData)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /modifier-groups/:id
menu.delete(
  "/modifier-groups/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Verify the group belongs to this tenant
    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    // Deleting the group cascades onto its modifiers (onDelete: "cascade"),
    // but order_item_modifiers references modifiers with onDelete: "restrict".
    // If any modifier in this group is referenced by order history, the cascade
    // would throw a raw 500 — pre-check and return a clean 409 instead.
    const [{ count: refCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orderItemModifiers)
      .innerJoin(
        schema.modifiers,
        eq(schema.orderItemModifiers.modifier_id, schema.modifiers.id),
      )
      .where(eq(schema.modifiers.group_id, id));

    if (refCount > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar: está en uso",
          },
        },
        409,
      );
    }

    const [deleted] = await db
      .delete(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Grupo eliminado" } });
  },
);

// PATCH /modifier-groups/:id/modifiers/reorder — el orden de las opciones
menu.patch(
  "/modifier-groups/:id/modifiers/reorder",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", reorderSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { ids } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // La tabla `modifiers` no lleva columnas de sede: se comprueba a través del
    // grupo, o cualquiera reordenaría las opciones de otro restaurante.
    const [grupo] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!grupo) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Grupo no encontrado" } },
        404,
      );
    }

    const desfasada = await db.transaction(async (tx) => {
      const actuales = await tx
        .select({ id: schema.modifiers.id })
        .from(schema.modifiers)
        .where(eq(schema.modifiers.group_id, id))
        .for("update");

      const enviados = new Set(ids);
      if (actuales.length !== ids.length || actuales.some((f) => !enviados.has(f.id))) {
        return true;
      }

      await tx
        .update(schema.modifiers)
        .set({ sort_order: expresionDeOrden(schema.modifiers.id, schema.modifiers.sort_order, ids) })
        .where(eq(schema.modifiers.group_id, id));

      return false;
    });

    if (desfasada) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "Las opciones de este grupo han cambiado. Recarga y vuelve a ordenarlas.",
          },
        },
        409,
      );
    }

    return c.json({ success: true, data: { reordered: ids.length } });
  },
);

// PATCH /modifiers/:id
menu.patch(
  "/modifiers/:id",
  requirePermission("menu:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateModifierSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existingModifier] = await db
      .select({
        id: schema.modifiers.id,
      })
      .from(schema.modifiers)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.modifiers.group_id, schema.modifierGroups.id),
      )
      .where(
        and(
          eq(schema.modifiers.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existingModifier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.isAvailable !== undefined) updateData.is_available = body.isAvailable;

    const [updated] = await db
      .update(schema.modifiers)
      .set(updateData)
      .where(eq(schema.modifiers.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /modifiers/:id
menu.delete(
  "/modifiers/:id",
  requirePermission("menu:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existingModifier] = await db
      .select({
        id: schema.modifiers.id,
      })
      .from(schema.modifiers)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.modifiers.group_id, schema.modifierGroups.id),
      )
      .where(
        and(
          eq(schema.modifiers.id, id),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existingModifier) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    // order_item_modifiers references modifiers with onDelete: "restrict".
    // If this modifier is referenced by order history, the delete would throw a
    // raw 500 — pre-check and return a clean 409 instead.
    const [{ count: refCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orderItemModifiers)
      .where(eq(schema.orderItemModifiers.modifier_id, id));

    if (refCount > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar: está en uso",
          },
        },
        409,
      );
    }

    const [deleted] = await db
      .delete(schema.modifiers)
      .where(eq(schema.modifiers.id, id))
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Modificador no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Modificador eliminado" } });
  },
);

// GET /items/:id/modifier-groups
menu.get(
  "/items/:id/modifier-groups",
  requirePermission("menu:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, id),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
        404,
      );
    }

    const links = await db
      .select()
      .from(schema.menuItemModifierGroups)
      .where(eq(schema.menuItemModifierGroups.item_id, id));

    if (links.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const groupIds = links.map((l) => l.group_id);
    const groups = await db
      .select()
      .from(schema.modifierGroups)
      .where(
        and(
          groupIds.length === 1
            ? eq(schema.modifierGroups.id, groupIds[0])
            : inArray(schema.modifierGroups.id, groupIds),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        )
      );

    // Also fetch modifiers for these groups
    let allModifiers: any[] = [];
    if (groupIds.length > 0) {
      allModifiers = await db
        .select()
        .from(schema.modifiers)
        .where(
          groupIds.length === 1
            ? eq(schema.modifiers.group_id, groupIds[0])
            : inArray(schema.modifiers.group_id, groupIds)
        );
    }

    const result = groups.map((g) => ({
      ...g,
      modifiers: allModifiers.filter((m) => m.group_id === g.id),
    }));

    return c.json({ success: true, data: result });
  },
);

// DELETE /items/:id/modifier-groups/:groupId
menu.delete(
  "/items/:id/modifier-groups/:groupId",
  requirePermission("menu:update"),
  async (c) => {
    const itemId = c.req.param("id");
    const groupId = c.req.param("groupId");
    const tenant = c.get("tenant") as any;

    const [item] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.branch_id, tenant.branchId),
          eq(schema.menuItems.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    const [group] = await db
      .select({ id: schema.modifierGroups.id })
      .from(schema.modifierGroups)
      .where(
        and(
          eq(schema.modifierGroups.id, groupId),
          eq(schema.modifierGroups.branch_id, tenant.branchId),
          eq(schema.modifierGroups.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!item || !group) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Item o grupo no encontrado" } },
        404,
      );
    }

    const [deleted] = await db
      .delete(schema.menuItemModifierGroups)
      .where(
        and(
          eq(schema.menuItemModifierGroups.item_id, itemId),
          eq(schema.menuItemModifierGroups.group_id, groupId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Vínculo no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: { message: "Grupo desvinculado" } });
  },
);

export { menu };
