import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, or, inArray, sql, desc, asc, isNull, gte, lt, lte } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  startSessionSchema,
  createOrderSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { signCustomerToken, verifyAccessToken } from "../lib/jwt.js";
import { realtime } from "../infrastructure/container.js";
import { findOrCreate, findByEmail } from "../services/customer.service.js";
import { createOrder, OrderValidationError } from "../services/order.service.js";
import { redeemReward } from "../services/loyalty.service.js";
import * as referralService from "../services/referral.service.js";
import { PENDING_TTL_MINUTES, ACTIVE_TTL_HOURS } from "../services/session.service.js";
import { createServiceRequest } from "../services/service-request.service.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { customerAuth, requireActiveSession } from "../middleware/customer-auth.js";
import { audit } from "../lib/audit.js";
import { normalizeShortCode } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import { sendTransactionalEmail } from "../lib/notifications.js";
import { hashPassword, verifyPassword } from "../lib/hash.js";
import { requestCustomerCodeSchema, verifyCustomerCodeSchema } from "@restai/validators";

const customer = new Hono<AppEnv>();

// Stricter rate limit for session creation (5 per 10 minutes per IP)
customer.use("/:branchSlug/:tableCode/register", rateLimiter(5, 600_000, "session-create"));
customer.use("/:branchSlug/:tableCode/session", rateLimiter(5, 600_000, "session-create"));
// Entrada por código corto: el código es público (está impreso en la mesa), pero
// limitamos el barrido para que nadie enumere las mesas de una sede a fuerza bruta.
customer.use("/:branchSlug/tables/by-code/:code", rateLimiter(20, 600_000, "table-by-code"));
// Email-code login: tight limits to deter code spam / brute force.
customer.use("/:branchSlug/login/request-code", rateLimiter(5, 600_000, "login-request"));
customer.use("/:branchSlug/login/verify-code", rateLimiter(15, 600_000, "login-verify"));
const MAX_LOGIN_CODE_ATTEMPTS = 5;

/**
 * Centinela para abortar la transacción de anulación de un pedido.
 *
 * En drizzle, salir del callback de `db.transaction` con un valor CONFIRMA lo
 * escrito: la única forma de deshacerlo es lanzar. Se usa un mensaje propio
 * para poder distinguir después "la cocina se me adelantó" (409) de un error
 * real de base de datos (500).
 */
const CANCEL_CONFLICT = "ORDER_CANCEL_CONFLICT";

// ── Resolución de la sede en el flujo público ───────────────────────────────
//
// El slug de sede NO es único globalmente: `branches_org_slug_unique`
// (packages/db/src/schema/tenants.ts) lo declara único POR ORGANIZACIÓN, así
// que dos restaurantes distintos pueden tener a la vez una sede "principal"
// —que además es la del seed, o sea el caso más probable—. Resolverla con
// `WHERE slug = ? LIMIT 1` devuelve entonces una fila ARBITRARIA y el flujo
// público podía quedar apuntando a la organización equivocada.
//
// La corrección no consiste en imponer unicidad global del slug (eso cambiaría
// un contrato del panel de administración y obligaría a migrar datos vivos),
// sino en dejar de resolver por un predicado que no es único: aquí la sede se
// deduce SIEMPRE de un identificador globalmente único —el `qr_code` de la mesa
// (`tables.qr_code` lleva UNIQUE global) o el uuid del plato— y el slug pasa a
// ser una simple confirmación. Donde no hay tal identificador (entrada por
// código corto, petición de código de acceso) se leen TODAS las sedes con ese
// slug y el llamador resuelve la ambigüedad de forma explícita, nunca por azar.

/** Columnas de sede que necesita el flujo público (nunca se expone más). */
const publicBranchColumns = {
  id: schema.branches.id,
  organization_id: schema.branches.organization_id,
  name: schema.branches.name,
  slug: schema.branches.slug,
  currency: schema.branches.currency,
  tax_rate: schema.branches.tax_rate,
  is_active: schema.branches.is_active,
  settings: schema.branches.settings,
  /**
   * `static` o `dynamic`. Decide si el QR sirve para pedir o solo para leer.
   * Viaja al comensal porque la pantalla necesita saber si pintar el carrito.
   */
  menu_mode: schema.branches.menu_mode,
};

type PublicBranch = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  currency: string;
  tax_rate: number;
  is_active: boolean;
  settings: unknown;
  menu_mode: string;
};

/**
 * Carta estática: el QR sirve para LEER, no para pedir.
 *
 * El modo no puede vivir solo en la pantalla. Un enlace guardado en el
 * navegador, un token de una visita anterior o una petición hecha a mano se
 * saltarían una comprobación que estuviera únicamente en el móvil del comensal,
 * y el local acabaría con comandas que no espera nadie.
 *
 * Lo que NO bloquea: cerrar y cobrar lo que ya estaba abierto. Cambiar de modo a
 * media tarde no puede dejar una mesa sin poder pagar.
 */
function esCartaEstatica(branch: { menu_mode?: string | null }): boolean {
  return branch.menu_mode === "static";
}

const ERROR_CARTA_ESTATICA = {
  success: false,
  error: {
    code: "STATIC_MENU",
    message: "Este local tiene la carta en modo solo lectura. Para pedir, avisa a un mozo.",
  },
} as const;

/**
 * Cierra las rutas de PEDIR cuando la sede está en modo carta estática.
 *
 * Hace falta ADEMÁS de cerrar la creación de sesiones: quien tenía una visita
 * abierta cuando el dueño cambió el modo conserva su token, y sin esto seguiría
 * mandando comandas. La comprobación va contra la sede del propio token, nunca
 * contra algo que mande el cliente.
 */
const bloquearSiCartaEstatica = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user") as any;

  const [sede] = await db
    .select({ menu_mode: schema.branches.menu_mode })
    .from(schema.branches)
    .where(eq(schema.branches.id, user.branch))
    .limit(1);

  if (sede && esCartaEstatica(sede)) {
    return c.json(ERROR_CARTA_ESTATICA, 409);
  }

  await next();
});

type PublicTable = {
  id: string;
  number: number;
  qr_code: string;
  short_code: string;
  capacity: number;
};

/**
 * Resuelve (sede, mesa) a partir del QR de la mesa.
 *
 * `tables.qr_code` es único a nivel global, así que la mesa —y con ella su sede
 * y su organización— quedan determinadas sin ninguna ambigüedad. El slug de la
 * URL solo se usa para CONFIRMAR que el enlace es coherente; si no coincide, se
 * responde igual que si la sede no existiera.
 *
 * `is_active` NO se comprueba aquí: cada ruta tiene su propia regla (pedir
 * exige sede activa, consultar el estado de una sesión ya abierta no).
 */
async function resolvePublicTable(
  branchSlug: string,
  tableQr: string,
): Promise<
  | { ok: true; branch: PublicBranch; table: PublicTable }
  | { ok: false; reason: "table" | "branch" }
> {
  const [row] = await db
    .select({
      branch: publicBranchColumns,
      table: {
        id: schema.tables.id,
        number: schema.tables.number,
        qr_code: schema.tables.qr_code,
        short_code: schema.tables.short_code,
        capacity: schema.tables.capacity,
      },
    })
    .from(schema.tables)
    // El JOIN cruza también la organización: si una mesa apuntara a una sede de
    // otro tenant, la fila no sale en vez de resolverse a medias.
    .innerJoin(
      schema.branches,
      and(
        eq(schema.tables.branch_id, schema.branches.id),
        eq(schema.tables.organization_id, schema.branches.organization_id),
      ),
    )
    .where(eq(schema.tables.qr_code, tableQr))
    .limit(1);

  if (!row) return { ok: false, reason: "table" };
  if (row.branch.slug !== branchSlug) return { ok: false, reason: "branch" };

  return { ok: true, branch: row.branch as PublicBranch, table: row.table };
}

/**
 * TODAS las sedes con ese slug, sin `LIMIT`: el predicado no es único y
 * quedarse con la primera fila es justo el defecto que se está corrigiendo.
 * Solo la usan las rutas que no reciben ningún identificador global.
 */
async function branchesBySlug(branchSlug: string): Promise<PublicBranch[]> {
  const rows = await db
    .select(publicBranchColumns)
    .from(schema.branches)
    .where(eq(schema.branches.slug, branchSlug));
  return rows as PublicBranch[];
}

// ── Apertura de sesión de mesa ──────────────────────────────────────────────

/**
 * ¿La sede tiene la auto-aprobación activada?
 *
 * `branches.settings` es jsonb libre, así que se lee de forma defensiva: solo el
 * booleano `true` explícito activa el modo. Cualquier otra cosa (ausente, "true"
 * como texto, null) deja el flujo clásico con aprobación del mozo.
 */
function autoApproveEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  return (settings as Record<string, unknown>).auto_approve_sessions === true;
}

type TableOccupancy = "free" | "active" | "pending";

/**
 * Lectura barata del estado de la mesa para dar respuestas tempranas y amables
 * (y no crear un cliente en la BD si la mesa ya está tomada).
 *
 * NO es la autoridad: la decisión real la toma `startTableSession` dentro de una
 * transacción con cerrojo. Aquí puede haber carrera y no pasa nada.
 */
async function probeTableOccupancy(params: {
  organizationId: string;
  branchId: string;
  tableId: string;
}): Promise<TableOccupancy> {
  const now = new Date();
  const [taken] = await db
    .select({ status: schema.tableSessions.status })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.organization_id, params.organizationId),
        eq(schema.tableSessions.branch_id, params.branchId),
        eq(schema.tableSessions.table_id, params.tableId),
        or(
          eq(schema.tableSessions.status, "active"),
          and(
            eq(schema.tableSessions.status, "pending"),
            gte(schema.tableSessions.expires_at, now),
          ),
        ),
      ),
    )
    .limit(1);

  if (!taken) return "free";
  return taken.status === "active" ? "active" : "pending";
}

type StartSessionResult =
  | { ok: false; conflict: "active" | "pending" }
  | {
      ok: true;
      session: typeof schema.tableSessions.$inferSelect;
      autoApproved: boolean;
    };

/**
 * Abre la sesión de mesa de forma atómica.
 *
 * Toma un cerrojo sobre la fila de la mesa antes de mirar si hay sesión viva:
 * sin él, dos comensales que escanean el mismo QR a la vez pasan los dos el
 * chequeo y la mesa acaba con dos sesiones activas (y dos cuentas distintas).
 *
 * El id de la fila se fija al `sub` del token, que ya se firmó antes de existir
 * la fila; si divergen, `requireActiveSession` devolvería SESSION_ENDED siempre.
 *
 * Si la sede tiene auto-aprobación, la sesión nace 'active' y la mesa pasa a
 * 'occupied' en la misma transacción: el comensal ve la carta al instante en vez
 * de esperar hasta 10 minutos a que el mozo esté libre.
 */
async function startTableSession(params: {
  sessionId: string;
  organizationId: string;
  branchId: string;
  tableId: string;
  customerName: string;
  customerPhone?: string;
  token: string;
  autoApprove: boolean;
}): Promise<StartSessionResult> {
  const now = new Date();
  const status = params.autoApprove ? "active" : "pending";
  const expires_at = params.autoApprove
    ? new Date(now.getTime() + ACTIVE_TTL_HOURS * 3_600_000)
    : new Date(now.getTime() + PENDING_TTL_MINUTES * 60_000);

  return await db.transaction(async (tx): Promise<StartSessionResult> => {
    // Cerrojo de serialización sobre la mesa (estado compartido).
    await tx
      .select({ id: schema.tables.id })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, params.tableId),
          eq(schema.tables.branch_id, params.branchId),
          eq(schema.tables.organization_id, params.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    const [taken] = await tx
      .select({ status: schema.tableSessions.status })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.organization_id, params.organizationId),
          eq(schema.tableSessions.branch_id, params.branchId),
          eq(schema.tableSessions.table_id, params.tableId),
          or(
            eq(schema.tableSessions.status, "active"),
            and(
              eq(schema.tableSessions.status, "pending"),
              gte(schema.tableSessions.expires_at, now),
            ),
          ),
        ),
      )
      .limit(1);

    if (taken) {
      return { ok: false, conflict: taken.status === "active" ? "active" : "pending" };
    }

    const [session] = await tx
      .insert(schema.tableSessions)
      .values({
        id: params.sessionId,
        table_id: params.tableId,
        branch_id: params.branchId,
        organization_id: params.organizationId,
        customer_name: params.customerName,
        customer_phone: params.customerPhone,
        token: params.token,
        status,
        expires_at,
      })
      .returning();

    if (params.autoApprove) {
      await tx
        .update(schema.tables)
        .set({ status: "occupied" })
        .where(
          and(
            eq(schema.tables.id, params.tableId),
            eq(schema.tables.organization_id, params.organizationId),
            eq(schema.tables.branch_id, params.branchId),
          ),
        );
    }

    return { ok: true, session, autoApproved: params.autoApprove };
  });
}

/**
 * Avisa al personal de que hay una mesa nueva. Con aprobación manual emite
 * `session:pending` (la bandeja de conexiones y la campana lo esperan); con
 * auto-aprobación emite `session:approved`, que es lo que ya escuchan la
 * pantalla de mesas y la de espera del comensal.
 */
async function publishSessionStarted(params: {
  branchId: string;
  sessionId: string;
  tableId: string;
  tableNumber: number;
  customerName: string;
  autoApproved: boolean;
}): Promise<void> {
  const payload = {
    sessionId: params.sessionId,
    tableId: params.tableId,
    tableNumber: params.tableNumber,
    customerName: params.customerName,
  };
  const type = params.autoApproved ? "session:approved" : "session:pending";

  await realtime.publish(`branch:${params.branchId}`, {
    type,
    payload,
    timestamp: Date.now(),
  });

  if (params.autoApproved) {
    // La pantalla de espera del comensal escucha su propio canal de sesión y
    // salta a la carta en cuanto ve la aprobación.
    await realtime.publish(`session:${params.sessionId}`, {
      type,
      payload,
      timestamp: Date.now(),
    });
  }
}

/**
 * GET /carta/:publicCode — la carta de una sede, sin mesa y sin sesión.
 *
 * Es lo que hace posible el modo estático: un QR pegado en la puerta o en la
 * mesa que sustituye a la carta de papel. También es la vista previa que abre
 * el administrador desde el panel, para ver exactamente lo que ve el comensal.
 *
 * Se resuelve por `public_code` y NO por slug. El slug de sede solo es único
 * dentro de su organización, así que `/miraflores/carta` serviría la carta de
 * otro restaurante el día que otra cadena registre ese nombre. Es el mismo
 * motivo por el que el flujo con mesa resuelve por el código del QR.
 *
 * Nunca permite pedir: no hay mesa, no hay sesión y no se emite ningún token.
 * Por eso puede ser pública en los dos modos.
 */
customer.get("/carta/:publicCode", async (c) => {
  const publicCode = normalizeShortCode(c.req.param("publicCode"));

  const [branch] = await db
    .select(publicBranchColumns)
    .from(schema.branches)
    .where(eq(schema.branches.public_code, publicCode))
    .limit(1);

  if (!branch || !branch.is_active) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Carta no encontrada" } },
      404,
    );
  }

  const { categories, items } = await cargarCartaPublica(branch);

  return c.json({
    success: true,
    data: {
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        currency: branch.currency,
        tax_rate: branch.tax_rate,
        menu_mode: branch.menu_mode,
      },
      categories,
      items,
    },
  });
});

// GET /:branchSlug/tables/by-code/:code - Resolver mesa por código corto (público)
//
// Plan B del QR: sin cámara, sin datos, con el sticker despegado o con un
// comensal mayor, esta es la única forma de entrar sin volver al papel. Devuelve
// lo mismo que la resolución por QR (incluido el `qr_code`), de modo que la
// pantalla de entrada solo tiene que redirigir a /:branchSlug/:qr_code y seguir
// el flujo normal.
customer.get("/:branchSlug/tables/by-code/:code", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const code = normalizeShortCode(c.req.param("code"));

  const notFound = c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "No encontramos esa mesa. Revisa el código.",
      },
    },
    404,
  );

  if (!code) return notFound;

  // Única ruta pública sin identificador global: el código corto solo es único
  // POR SEDE (`uq_tables_branch_short_code`) y el slug tampoco desempata. Se
  // buscan las mesas en TODAS las sedes activas con ese slug y se exige que la
  // coincidencia sea única; si hay dos, se dice y se pide el QR en vez de
  // mandar al comensal al local equivocado.
  const candidateBranches = (await branchesBySlug(branchSlug)).filter((b) => b.is_active);
  if (candidateBranches.length === 0) return notFound;

  const matches = await db
    .select({
      id: schema.tables.id,
      number: schema.tables.number,
      qr_code: schema.tables.qr_code,
      short_code: schema.tables.short_code,
      capacity: schema.tables.capacity,
      branch_id: schema.tables.branch_id,
    })
    .from(schema.tables)
    .where(
      and(
        inArray(
          schema.tables.branch_id,
          candidateBranches.map((b) => b.id),
        ),
        eq(schema.tables.short_code, code),
      ),
    );

  if (matches.length === 0) return notFound;

  if (matches.length > 1) {
    logger.warn("Código de mesa ambiguo: varias sedes comparten slug", {
      branchSlug,
      matches: matches.length,
    });
    return c.json(
      {
        success: false,
        error: {
          code: "AMBIGUOUS_BRANCH",
          message: "Hay más de un local con ese identificador. Escanea el QR de la mesa.",
        },
      },
      409,
    );
  }

  const { branch_id, ...table } = matches[0];
  const branch = candidateBranches.find((b) => b.id === branch_id)!;

  // Mismo dato que /check-session para que la pantalla de entrada pueda decidir
  // sin una segunda llamada. Nunca se expone el token ni el nombre del ocupante.
  const occupancy = await probeTableOccupancy({
    organizationId: branch.organization_id,
    branchId: branch.id,
    tableId: table.id,
  });

  return c.json({
    success: true,
    data: {
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        currency: branch.currency,
        tax_rate: branch.tax_rate,
        menu_mode: branch.menu_mode,
      },
      table,
      session: {
        hasSession: occupancy !== "free",
        ...(occupancy !== "free" ? { status: occupancy } : {}),
      },
    },
  });
});

/**
 * Categorías y platos que ve el público, con `has_modifiers`.
 *
 * Vive aparte porque lo sirven DOS rutas: la del QR de la mesa y la carta de
 * sede sin mesa. Con el cuerpo duplicado, arreglar un filtro en una y olvidarlo
 * en la otra significa que el comensal ve una carta distinta según por dónde
 * entre, que es el peor fallo posible en una carta.
 */
async function cargarCartaPublica(branch: { id: string; organization_id: string }) {
  // Categorías activas y sus platos.
  const categories = await db
    .select()
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.organization_id, branch.organization_id),
        eq(schema.menuCategories.branch_id, branch.id),
        eq(schema.menuCategories.is_active, true),
      ),
    )
    .orderBy(asc(schema.menuCategories.sort_order), asc(schema.menuCategories.name));

  // Los platos AGOTADOS también se devuelven, marcados con `is_available: false`.
  // Ocultarlos hacía que la carta cambiara de tamaño sin explicación entre dos
  // miradas y que el comensal preguntara por un plato que "ya no está"; es mejor
  // mostrarlo en gris y que la cocina no reciba el pedido.
  //
  // Lo que sí se excluye son los platos de una categoría DESACTIVADA: la
  // respuesta solo trae las categorías activas, así que un plato colgando de
  // otra llegaba huérfano y la pantalla no tenía dónde pintarlo.
  const categoryIds = categories.map((cat) => cat.id);
  const items = categoryIds.length === 0 ? [] : await db
    .select({
      id: schema.menuItems.id,
      category_id: schema.menuItems.category_id,
      name: schema.menuItems.name,
      description: schema.menuItems.description,
      price: schema.menuItems.price,
      image_url: schema.menuItems.image_url,
      is_available: schema.menuItems.is_available,
      sort_order: schema.menuItems.sort_order,
      preparation_time_min: schema.menuItems.preparation_time_min,
      allergens: schema.menuItems.allergens,
      dietary_tags: schema.menuItems.dietary_tags,
      spice_level: schema.menuItems.spice_level,
    })
    .from(schema.menuItems)
    .where(
      and(
        eq(schema.menuItems.organization_id, branch.organization_id),
        eq(schema.menuItems.branch_id, branch.id),
        inArray(schema.menuItems.category_id, categoryIds),
        isNull(schema.menuItems.deleted_at),
      ),
    )
    .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.name));

  // Flag which items have modifier groups so the menu grid can route their
  // quick-add to the detail page (where required options are chosen) instead of
  // adding a bare line that the server would later reject at checkout.
  const itemIds = items.map((i) => i.id);
  let modifierItemIds = new Set<string>();
  if (itemIds.length > 0) {
    const links = await db
      .select({ item_id: schema.menuItemModifierGroups.item_id })
      .from(schema.menuItemModifierGroups)
      .where(inArray(schema.menuItemModifierGroups.item_id, itemIds));
    modifierItemIds = new Set(links.map((l) => l.item_id));
  }
  const itemsWithFlags = items.map((it) => ({
    ...it,
    has_modifiers: modifierItemIds.has(it.id),
  }));

  return { categories, items: itemsWithFlags };
}

// GET /:branchSlug/:tableCode/menu - Get menu for branch (public)
customer.get("/:branchSlug/:tableCode/menu", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const tableCode = c.req.param("tableCode");

  // Sede y mesa a la vez, resueltas por el QR (único global) y confirmadas con
  // el slug: nunca se elige una sede arbitraria entre varias homónimas.
  const resolved = await resolvePublicTable(branchSlug, tableCode);

  if (!resolved.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: resolved.reason === "table" ? "Mesa no encontrada" : "Sucursal no encontrada",
        },
      },
      404,
    );
  }

  const { branch, table } = resolved;

  if (!branch.is_active) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
      404,
    );
  }

  const { categories, items: itemsWithFlags } = await cargarCartaPublica(branch);

  return c.json({
    success: true,
    data: {
      branch: {
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        currency: branch.currency,
        // IGV real de la sede (en centésimas de punto: 1800 = 18,00%). El front
        // asumía 18% fijo, lo que rompe a cualquier local con tasa distinta
        // (Amazonía, exoneraciones) y desconciertaba al comensal al pagar.
        tax_rate: branch.tax_rate,
        // Sin esto la carta no sabe si es de pedir o de leer, y pintaría un
        // carrito que el servidor va a rechazar.
        menu_mode: branch.menu_mode,
      },
      table: { id: table.id, number: table.number, short_code: table.short_code },
      categories,
      items: itemsWithFlags,
    },
  });
});

// POST /:branchSlug/:tableCode/register - Register customer + create session (public)
customer.post(
  "/:branchSlug/:tableCode/register",
  zValidator("json", z.object({
    customerName: z.string().min(1).max(255),
    customerPhone: z.string().optional(),
    email: z.string().email().optional(),
    birthDate: z.string().optional(),
    marketingOptIn: z.boolean().optional(),
    referralCode: z.string().max(20).optional(),
  })),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const tableCode = c.req.param("tableCode");
    const body = c.req.valid("json");

    // Sede y mesa resueltas por el QR (único global), no por el slug.
    const resolved = await resolvePublicTable(branchSlug, tableCode);
    if (!resolved.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: resolved.reason === "table" ? "Mesa no encontrada" : "Sucursal no encontrada",
          },
        },
        404,
      );
    }

    const { branch, table } = resolved;

    // Se exige `is_active`. Sin esta comprobación se podían abrir sesiones (y por
    // tanto pedir) en una sede dada de baja, aunque su carta ya devolviera 404:
    // el comensal quedaba sentado en un local cerrado.
    if (!branch.is_active) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } }, 404);
    }

    // En modo carta estática no se abren visitas: el QR es solo para leer.
    if (esCartaEstatica(branch)) {
      return c.json(ERROR_CARTA_ESTATICA, 409);
    }

    // Chequeo temprano para no crear un cliente en la BD si la mesa ya está
    // tomada. La decisión firme la toma startTableSession bajo cerrojo: si la
    // mesa se ocupa entre este chequeo y el insert, allí se detecta. Nunca se
    // revela el token ni el nombre del ocupante legítimo.
    const occupancy = await probeTableOccupancy({
      organizationId: branch.organization_id,
      branchId: branch.id,
      tableId: table.id,
    });

    if (occupancy === "active") {
      return c.json({ success: true, data: { status: "active" } });
    }

    if (occupancy === "pending") {
      return c.json(
        { success: false, error: { code: "SESSION_PENDING", message: "Esta mesa esta en espera de aprobacion" } },
        409,
      );
    }

    // Check if same phone has a pending session in any table of this branch
    if (body.customerPhone) {
      const [phonePending] = await db
        .select({ id: schema.tableSessions.id })
        .from(schema.tableSessions)
        .where(and(
          eq(schema.tableSessions.organization_id, branch.organization_id),
          eq(schema.tableSessions.branch_id, branch.id),
          eq(schema.tableSessions.customer_phone, body.customerPhone),
          eq(schema.tableSessions.status, "pending"),
          gte(schema.tableSessions.expires_at, new Date()),
        ))
        .limit(1);

      if (phonePending) {
        return c.json(
          { success: false, error: { code: "SESSION_PENDING", message: "Ya tienes una sesion pendiente en esta sucursal" } },
          409,
        );
      }
    }

    // Find existing customer or create new one (dedup by email/phone)
    const { customer: customer_record, loyalty, isNew } = await findOrCreate({
      organizationId: branch.organization_id,
      name: body.customerName,
      email: body.email,
      phone: body.customerPhone,
      birthDate: body.birthDate,
      marketingOptIn: body.marketingOptIn,
    });

    // Welcome email for brand-new customers who gave an email. Transactional
    // (service confirmation of account creation), so it is NOT gated on
    // marketing consent. Best-effort: never blocks/breaks registration.
    if (isNew && body.email) {
      const [org] = await db
        .select({ name: schema.organizations.name })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, branch.organization_id))
        .limit(1);
      await sendTransactionalEmail({
        organizationId: branch.organization_id,
        customerId: customer_record.id,
        toAddress: body.email,
        type: "welcome",
        orgName: org?.name,
        data: {
          customerName: body.customerName,
          pointsBalance: loyalty?.points_balance ?? 0,
        },
      });
    }

    // Best-effort referral registration: bind this customer to the referrer
    // identified by the code. Never fail registration if the code is invalid,
    // self-referential, or the customer is already referred (idempotent no-op).
    if (body.referralCode) {
      try {
        await referralService.registerReferral({
          organizationId: branch.organization_id,
          refereeCustomerId: customer_record.id,
          code: body.referralCode,
        });
      } catch {
        // Swallow: referral binding must never block customer registration.
      }
    }

    // Crear la sesión: 'active' directa si la sede tiene auto-aprobación,
    // 'pending' (aprobación del mozo) en caso contrario.
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({ sub: sessionId, org: branch.organization_id, branch: branch.id, table: table.id, customerId: customer_record.id });

    const started = await startTableSession({
      sessionId, // el id de la fila se fija al sub del token
      organizationId: branch.organization_id,
      branchId: branch.id,
      tableId: table.id,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      token,
      autoApprove: autoApproveEnabled(branch.settings),
    });

    if (!started.ok && started.conflict === "active") {
      return c.json({ success: true, data: { status: "active" } });
    }
    if (!started.ok) {
      return c.json(
        { success: false, error: { code: "SESSION_PENDING", message: "Esta mesa esta en espera de aprobacion" } },
        409,
      );
    }

    await publishSessionStarted({
      branchId: branch.id,
      sessionId: started.session.id,
      tableId: table.id,
      tableNumber: table.number,
      customerName: body.customerName,
      autoApproved: started.autoApproved,
    });

    return c.json(
      {
        success: true,
        data: {
          session: started.session,
          token,
          sessionId: started.session.id,
          // Nunca un `status: "active"` suelto aquí: la pantalla de entrada usa
          // ese campo para detectar "mesa ocupada" y mostraría eso justo a quien
          // acaba de entrar. El estado real viaja dentro de `session.status`.
          auto_approved: started.autoApproved,
          customer: customer_record,
        },
      },
      201,
    );
  },
);

// GET /:branchSlug/:tableCode/check-session - Check if table has active/pending session (public)
customer.get("/:branchSlug/:tableCode/check-session", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const tableCode = c.req.param("tableCode");

  // Resolución por QR (único global): sin ella, con dos sedes homónimas se podía
  // estar respondiendo por la mesa de otro local.
  const resolved = await resolvePublicTable(branchSlug, tableCode);

  if (!resolved.ok) {
    return c.json({ success: true, data: { hasSession: false } });
  }

  const { branch, table } = resolved;

  // Nunca se filtra el sessionId ni el nombre del ocupante a un anónimo: solo si
  // hay sesión y en qué estado.
  const occupancy = await probeTableOccupancy({
    organizationId: branch.organization_id,
    branchId: branch.id,
    tableId: table.id,
  });

  if (occupancy === "free") {
    return c.json({ success: true, data: { hasSession: false } });
  }

  return c.json({ success: true, data: { hasSession: true, status: occupancy } });
});

// POST /:branchSlug/:tableCode/session - Start session (public)
customer.post(
  "/:branchSlug/:tableCode/session",
  zValidator("json", startSessionSchema),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const tableCode = c.req.param("tableCode");
    const body = c.req.valid("json");

    // Sede y mesa resueltas por el QR (único global), no por el slug.
    const resolved = await resolvePublicTable(branchSlug, tableCode);
    if (!resolved.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: resolved.reason === "table" ? "Mesa no encontrada" : "Sucursal no encontrada",
          },
        },
        404,
      );
    }

    const { branch, table } = resolved;

    // Se exige `is_active`, igual que en /register. Una sede de baja no puede
    // recibir comensales nuevos.
    if (!branch.is_active) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
        404,
      );
    }


    // En modo carta estática no se abren visitas: el QR es solo para leer.
    if (esCartaEstatica(branch)) {
      return c.json(ERROR_CARTA_ESTATICA, 409);
    }

    // Chequeo temprano (no autoritativo): la mesa ocupada se responde sin tocar
    // nada más. Nunca se revela el token ni el nombre del ocupante legítimo.
    const occupancy = await probeTableOccupancy({
      organizationId: branch.organization_id,
      branchId: branch.id,
      tableId: table.id,
    });

    if (occupancy === "active") {
      return c.json({ success: true, data: { status: "active" } });
    }

    if (occupancy === "pending") {
      return c.json(
        {
          success: false,
          error: {
            code: "SESSION_PENDING",
            message: "Esta mesa esta en espera de aprobacion",
          },
        },
        409,
      );
    }

    // Check if same phone has a pending session in any table of this branch
    if (body.customerPhone) {
      const [phonePending] = await db
        .select({ id: schema.tableSessions.id })
        .from(schema.tableSessions)
        .where(and(
          eq(schema.tableSessions.organization_id, branch.organization_id),
          eq(schema.tableSessions.branch_id, branch.id),
          eq(schema.tableSessions.customer_phone, body.customerPhone),
          eq(schema.tableSessions.status, "pending"),
          gte(schema.tableSessions.expires_at, new Date()),
        ))
        .limit(1);

      if (phonePending) {
        return c.json(
          { success: false, error: { code: "SESSION_PENDING", message: "Ya tienes una sesion pendiente en esta sucursal" } },
          409,
        );
      }
    }

    // Link to existing customer if phone is provided (enables points accumulation)
    let customerId: string | undefined;
    if (body.customerPhone) {
      const { customer: found } = await findOrCreate({
        organizationId: branch.organization_id,
        name: body.customerName,
        phone: body.customerPhone,
      });
      customerId = found.id;
    }

    // Generate customer token
    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({
      sub: sessionId,
      org: branch.organization_id,
      branch: branch.id,
      table: table.id,
      ...(customerId ? { customerId } : {}),
    });

    const started = await startTableSession({
      sessionId, // el id de la fila se fija al sub del token
      organizationId: branch.organization_id,
      branchId: branch.id,
      tableId: table.id,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      token,
      autoApprove: autoApproveEnabled(branch.settings),
    });

    if (!started.ok && started.conflict === "active") {
      return c.json({ success: true, data: { status: "active" } });
    }
    if (!started.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: "SESSION_PENDING",
            message: "Esta mesa esta en espera de aprobacion",
          },
        },
        409,
      );
    }

    await publishSessionStarted({
      branchId: branch.id,
      sessionId: started.session.id,
      tableId: table.id,
      tableNumber: table.number,
      customerName: body.customerName,
      autoApproved: started.autoApproved,
    });

    return c.json(
      {
        success: true,
        data: {
          session: started.session,
          token,
          sessionId: started.session.id,
          // Nunca un `status: "active"` suelto aquí: la pantalla de entrada usa
          // ese campo para detectar "mesa ocupada" y mostraría eso justo a quien
          // acaba de entrar. El estado real viaja dentro de `session.status`.
          auto_approved: started.autoApproved,
        },
      },
      201,
    );
  },
);

// GET /:branchSlug/:tableCode/session-status/:sessionId - Poll session status (public)
// Scoped by branch+table so a caller cannot poll arbitrary sessions across the
// tenant, and returns ONLY the status (no customer_name / no extra row data).
// If a customer token is supplied, its `sub` must match the requested session id.
customer.get("/:branchSlug/:tableCode/session-status/:sessionId", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const tableCode = c.req.param("tableCode");
  const sessionId = c.req.param("sessionId");

  // If the caller presents a customer token, it must be for this exact session.
  const header = c.req.header("Authorization");
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = (await verifyAccessToken(header.slice(7))) as any;
      if (payload.role === "customer" && payload.sub !== sessionId) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "Sesion inválida" } },
          403,
        );
      }
    } catch {
      // Ignore invalid tokens; fall through to scoped public lookup.
    }
  }

  // Resolución por QR (único global). Una sede de baja NO invalida esta lectura:
  // el comensal que ya está esperando tiene derecho a ver en qué quedó su
  // solicitud aunque el local se desactive entre medias.
  const resolved = await resolvePublicTable(branchSlug, tableCode);

  if (!resolved.ok) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sesion no encontrada" } },
      404,
    );
  }

  const { branch, table } = resolved;

  const [session] = await db
    .select({
      status: schema.tableSessions.status,
      started_at: schema.tableSessions.started_at,
      expires_at: schema.tableSessions.expires_at,
    })
    .from(schema.tableSessions)
    .where(
      and(
        eq(schema.tableSessions.id, sessionId),
        eq(schema.tableSessions.organization_id, branch.organization_id),
        eq(schema.tableSessions.branch_id, branch.id),
        eq(schema.tableSessions.table_id, table.id),
      ),
    )
    .limit(1);

  if (!session) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sesion no encontrada" } },
      404,
    );
  }

  const now = Date.now();
  const expiresAtMs = session.expires_at ? new Date(session.expires_at).getTime() : null;

  // Una sesión pendiente cuyo TTL ya venció está muerta: el barrido periódico la
  // marcará como rechazada, pero mientras tanto la pantalla del comensal se
  // quedaba girando para siempre. Se informa el estado EFECTIVO para que vea la
  // pantalla de "vuelve a intentarlo" en vez de una ruedita infinita.
  const expired =
    session.status === "pending" && expiresAtMs !== null && expiresAtMs <= now;
  const status = expired ? "rejected" : session.status;

  return c.json({
    success: true,
    data: {
      status,
      // Segundos que el comensal lleva esperando: la pantalla puede mostrar el
      // tiempo transcurrido, que es lo que convierte una espera en tolerable.
      waiting_seconds: Math.max(
        0,
        Math.floor((now - new Date(session.started_at).getTime()) / 1000),
      ),
      expires_at: session.expires_at,
      expires_in_seconds:
        expiresAtMs === null ? null : Math.max(0, Math.floor((expiresAtMs - now) / 1000)),
    },
  });
});

// GET /:branchSlug/menu/items/:itemId/modifiers - Get modifier groups for item (public)
customer.get("/:branchSlug/menu/items/:itemId/modifiers", async (c) => {
  const branchSlug = c.req.param("branchSlug");
  const itemId = c.req.param("itemId");

  // Aquí el identificador único global es el propio uuid del plato: se buscan
  // todas las sedes con ese slug y el plato entre ellas. Como mucho puede
  // encajar una, así que no hay ambigüedad posible.
  const candidateBranches = await branchesBySlug(branchSlug);

  if (candidateBranches.length === 0) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
      404,
    );
  }

  const [item] = await db
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    .where(
      and(
        eq(schema.menuItems.id, itemId),
        inArray(
          schema.menuItems.branch_id,
          candidateBranches.map((b) => b.id),
        ),
      ),
    )
    .limit(1);

  if (!item) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Item no encontrado" } },
      404,
    );
  }

  // El orden en que se le PREGUNTA al comensal no es cosmético: en un lomo el
  // término va antes que los extras, y en una escala de picante el orden ES el
  // significado. Sin estos dos `orderBy` salían como quisiera Postgres, y podían
  // cambiar entre dos miradas a la misma pantalla.
  const links = await db
    .select()
    .from(schema.menuItemModifierGroups)
    .where(eq(schema.menuItemModifierGroups.item_id, itemId))
    .orderBy(asc(schema.menuItemModifierGroups.sort_order));

  if (links.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const groupIds = links.map((l) => l.group_id);
  const groups = await db
    .select()
    .from(schema.modifierGroups)
    .where(
      groupIds.length === 1
        ? eq(schema.modifierGroups.id, groupIds[0])
        : inArray(schema.modifierGroups.id, groupIds),
    );

  const allModifiers = await db
    .select()
    .from(schema.modifiers)
    .where(
      groupIds.length === 1
        ? eq(schema.modifiers.group_id, groupIds[0])
        : inArray(schema.modifiers.group_id, groupIds),
    )
    .orderBy(asc(schema.modifiers.sort_order), asc(schema.modifiers.name));

  // Se recorre `links` y no `groups`: el orden lo manda el vínculo con ESTE
  // plato, no el orden en que la base devolvió los grupos.
  const porGrupo = new Map(groups.map((g) => [g.id, g]));
  const result = links
    .map((l) => porGrupo.get(l.group_id))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((g) => ({
      ...g,
      modifiers: allModifiers.filter((m) => m.group_id === g.id && m.is_available),
    }));

  return c.json({ success: true, data: result });
});

// POST /:branchSlug/login/request-code - Email a 6-digit login code (public)
// Resolves the org from the branch in the URL (customers are tenant-scoped), so
// the same email under another org is never confused. Returns a generic response
// regardless of existence so it can't be used to enumerate registered emails.
customer.post(
  "/:branchSlug/login/request-code",
  zValidator("json", requestCustomerCodeSchema),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const { email } = c.req.valid("json");

    const generic = {
      success: true,
      data: { message: "Si el correo está registrado, te enviamos un código." },
    };

    // Esta ruta solo recibe el slug, que no identifica una organización de forma
    // única. Se buscan TODAS las sedes homónimas y la cuenta se resuelve en las
    // organizaciones candidatas: si el correo encaja en exactamente una, se
    // continúa; si encajara en varias, no hay forma honesta de elegir y se
    // responde lo genérico (mandar el código a la organización equivocada haría
    // que el acceso fallara después, sin explicación posible para el comensal).
    const candidateBranches = await branchesBySlug(branchSlug);
    if (candidateBranches.length === 0) return c.json(generic);

    const organizationIds = [...new Set(candidateBranches.map((b) => b.organization_id))];

    const found: Array<{
      organizationId: string;
      record: NonNullable<Awaited<ReturnType<typeof findByEmail>>>;
    }> = [];
    for (const organizationId of organizationIds) {
      const record = await findByEmail({ organizationId, email });
      if (record) found.push({ organizationId, record });
    }

    if (found.length !== 1) {
      if (found.length > 1) {
        logger.warn("Correo de acceso ambiguo: varias sedes comparten slug", {
          branchSlug,
          organizations: found.length,
        });
      }
      // Se iguala el tiempo de respuesta con el camino registrado (que ejecuta
      // un hash argon2 más abajo) para que la latencia no delate si el correo
      // está registrado — es lo que sostiene la respuesta genérica.
      await hashPassword("000000").catch(() => {});
      return c.json(generic);
    }

    const { organizationId: resolvedOrgId, record: customer_record } = found[0];

    // 6-digit code; store ONLY its hash (never plaintext), short-lived, single-use.
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String(buf[0] % 1_000_000).padStart(6, "0");
    const code_hash = await hashPassword(code);

    await db.insert(schema.customerLoginCodes).values({
      organization_id: resolvedOrgId,
      customer_id: customer_record.id,
      code_hash,
      expires_at: new Date(Date.now() + 10 * 60_000),
    });

    const [org] = await db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, resolvedOrgId))
      .limit(1);

    // Transactional (not marketing) → sent regardless of marketing consent.
    await sendTransactionalEmail({
      organizationId: resolvedOrgId,
      customerId: customer_record.id,
      toAddress: email,
      type: "login_code",
      orgName: org?.name,
      data: { customerName: customer_record.name, code, expiresMinutes: 10 },
    });

    return c.json(generic);
  },
);

// POST /:branchSlug/login/verify-code - Verify the email code, then start a
// table session (public). On success this proves email ownership AND creates a
// PENDING table session for the recognized customer (waiter approval), exactly
// like register — login = "join this table as a returning member". Returns the
// session + QR token (which carries customerId, so loyalty works), or
// { status: "active" } if the table is already taken.
customer.post(
  "/:branchSlug/login/verify-code",
  zValidator("json", verifyCustomerCodeSchema),
  async (c) => {
    const branchSlug = c.req.param("branchSlug");
    const { email, code, tableCode } = c.req.valid("json");

    const invalid = c.json(
      { success: false, error: { code: "INVALID_CODE", message: "Código inválido o expirado" } },
      400,
    );

    // La mesa viaja en el cuerpo, así que la sede se resuelve por el QR (único
    // global) y no por el slug: el código de acceso se comprueba SIEMPRE contra
    // la organización real de esa mesa.
    const resolved = await resolvePublicTable(branchSlug, tableCode);
    if (!resolved.ok) {
      // Slug incoherente: mismo error genérico que un código inválido, para no
      // confirmar de paso qué correos están registrados.
      if (resolved.reason === "branch") return invalid;
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } }, 404);
    }

    const { branch, table } = resolved;

    // Sede de baja: mismo error genérico que un código inválido.
    if (!branch.is_active) return invalid;

    // En modo carta estática no se abren visitas ni entrando por correo.
    if (esCartaEstatica(branch)) {
      return c.json(ERROR_CARTA_ESTATICA, 409);
    }

    const customer_record = await findByEmail({
      organizationId: branch.organization_id,
      email,
    });
    if (!customer_record) return invalid;

    // Latest unconsumed, non-expired code for this customer.
    const [loginCode] = await db
      .select()
      .from(schema.customerLoginCodes)
      .where(
        and(
          eq(schema.customerLoginCodes.customer_id, customer_record.id),
          eq(schema.customerLoginCodes.organization_id, branch.organization_id),
          isNull(schema.customerLoginCodes.consumed_at),
          gte(schema.customerLoginCodes.expires_at, new Date()),
        ),
      )
      .orderBy(desc(schema.customerLoginCodes.created_at))
      .limit(1);

    if (!loginCode) return invalid;

    // Atomically claim ONE attempt: this single UPDATE both increments the
    // counter (with sql`attempts + 1`, never a stale JS read) and self-limits via
    // `attempts < MAX`, so concurrent guesses can't bypass the per-code cap
    // (no TOCTOU). 0 rows back => the code is consumed, expired, or out of
    // attempts → reject.
    const [claimed] = await db
      .update(schema.customerLoginCodes)
      .set({ attempts: sql`${schema.customerLoginCodes.attempts} + 1` })
      .where(
        and(
          eq(schema.customerLoginCodes.id, loginCode.id),
          isNull(schema.customerLoginCodes.consumed_at),
          gte(schema.customerLoginCodes.expires_at, new Date()),
          lt(schema.customerLoginCodes.attempts, MAX_LOGIN_CODE_ATTEMPTS),
        ),
      )
      .returning({ id: schema.customerLoginCodes.id });

    if (!claimed) return invalid;

    const ok = await verifyPassword(loginCode.code_hash, code);
    if (!ok) return invalid;

    // Single-use: consume only if still unconsumed (race-safe). If another
    // concurrent request already consumed it, treat this as invalid.
    const [consumed] = await db
      .update(schema.customerLoginCodes)
      .set({ consumed_at: new Date() })
      .where(
        and(
          eq(schema.customerLoginCodes.id, loginCode.id),
          isNull(schema.customerLoginCodes.consumed_at),
        ),
      )
      .returning({ id: schema.customerLoginCodes.id });

    if (!consumed) return invalid;

    // Identidad probada → se abre la sesión de ESTA mesa con las mismas reglas
    // que el registro: si la mesa ya está tomada se rechaza, y si no, la sesión
    // queda ligada al cliente reconocido (pendiente de aprobación del mozo, o
    // activa de inmediato si la sede tiene auto-aprobación).
    const customerInfo = {
      id: customer_record.id,
      name: customer_record.name,
      email: customer_record.email,
    };

    const sessionId = crypto.randomUUID();
    const token = await signCustomerToken({
      sub: sessionId,
      org: branch.organization_id,
      branch: branch.id,
      table: table.id,
      customerId: customer_record.id,
    });

    const started = await startTableSession({
      sessionId,
      organizationId: branch.organization_id,
      branchId: branch.id,
      tableId: table.id,
      customerName: customer_record.name,
      customerPhone: customer_record.phone ?? undefined,
      token,
      autoApprove: autoApproveEnabled(branch.settings),
    });

    if (!started.ok && started.conflict === "active") {
      // No se revela la sesión existente; solo que la mesa está ocupada.
      return c.json({ success: true, data: { status: "active", customer: customerInfo } });
    }
    if (!started.ok) {
      return c.json(
        { success: false, error: { code: "SESSION_PENDING", message: "Esta mesa esta en espera de aprobacion" } },
        409,
      );
    }

    await publishSessionStarted({
      branchId: branch.id,
      sessionId: started.session.id,
      tableId: table.id,
      tableNumber: table.number,
      customerName: customer_record.name,
      autoApproved: started.autoApproved,
    });

    return c.json(
      {
        success: true,
        data: {
          session: started.session,
          token,
          sessionId: started.session.id,
          // Nunca un `status: "active"` suelto aquí: la pantalla de entrada usa
          // ese campo para detectar "mesa ocupada" y mostraría eso justo a quien
          // acaba de entrar. El estado real viaja dentro de `session.status`.
          auto_approved: started.autoApproved,
          customer: customerInfo,
        },
      },
      201,
    );
  },
);

// `customerAuth` y `requireActiveSession` se definían aquí. Viven ahora en
// `middleware/customer-auth.ts` porque la carta por voz necesita exactamente la
// misma comprobación, y dos copias de un middleware de auth acaban divergiendo.

// GET /my-loyalty - Get loyalty info for current customer (customer auth)
customer.get("/my-loyalty", customerAuth, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;
  const orgId = user.org;

  if (!customerId) {
    return c.json({ success: true, data: null });
  }

  // Get enrollment with program and tier info
  const enrollment = await db
    .select({
      id: schema.customerLoyalty.id,
      points_balance: schema.customerLoyalty.points_balance,
      total_points_earned: schema.customerLoyalty.total_points_earned,
      program_name: schema.loyaltyPrograms.name,
      program_id: schema.loyaltyPrograms.id,
      tier_name: schema.loyaltyTiers.name,
      tier_min_points: schema.loyaltyTiers.min_points,
    })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, orgId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .leftJoin(
      schema.loyaltyTiers,
      eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
    )
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (enrollment.length === 0) {
    return c.json({ success: true, data: null });
  }

  const info = enrollment[0];

  // Recompensas disponibles del programa.
  //
  // `reward_type` es imprescindible: sin él, una recompensa de producto gratis
  // se pintaba como "S/ 0,00 de descuento" (su discount_value es 0) y nadie la
  // canjeaba. Se acompaña del plato asociado, del stock y de la ventana de
  // vigencia para que la tarjeta se pueda describir de verdad.
  const now = new Date();
  const availableRewards = await db
    .select({
      id: schema.rewards.id,
      name: schema.rewards.name,
      description: schema.rewards.description,
      points_cost: schema.rewards.points_cost,
      reward_type: schema.rewards.reward_type,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
      menu_item_id: schema.rewards.menu_item_id,
      menu_item_name: schema.menuItems.name,
      stock_remaining: schema.rewards.stock_remaining,
      max_per_customer: schema.rewards.max_per_customer,
      expires_at: schema.rewards.expires_at,
    })
    .from(schema.rewards)
    // El JOIN lleva su propio organization_id: si una recompensa apuntara a un
    // plato de otra organización, aquí devuelve NULL en vez de filtrar el nombre.
    .leftJoin(
      schema.menuItems,
      and(
        eq(schema.rewards.menu_item_id, schema.menuItems.id),
        eq(schema.menuItems.organization_id, orgId),
      ),
    )
    .where(
      and(
        eq(schema.rewards.program_id, info.program_id),
        eq(schema.rewards.is_active, true),
        // Fuera de vigencia = no se muestra: ofrecer un canje que el servidor
        // rechazará después es peor que no ofrecerlo. Los límites son
        // inclusivos: una recompensa que arranca justo ahora ya es válida.
        or(isNull(schema.rewards.starts_at), lte(schema.rewards.starts_at, now)),
        or(isNull(schema.rewards.expires_at), gte(schema.rewards.expires_at, now)),
      ),
    );

  // Get next tier (if any)
  const nextTier = await db
    .select({
      name: schema.loyaltyTiers.name,
      min_points: schema.loyaltyTiers.min_points,
    })
    .from(schema.loyaltyTiers)
    .where(
      and(
        eq(schema.loyaltyTiers.program_id, info.program_id),
        sql`${schema.loyaltyTiers.min_points} > ${info.total_points_earned}`,
      ),
    )
    .orderBy(schema.loyaltyTiers.min_points)
    .limit(1);

  return c.json({
    success: true,
    data: {
      points_balance: info.points_balance,
      total_points_earned: info.total_points_earned,
      program_name: info.program_name,
      tier_name: info.tier_name,
      next_tier: nextTier[0] || null,
      rewards: availableRewards,
    },
  });
});

// GET /my-coupons - Get available coupons for current customer (customer auth)
customer.get("/my-coupons", customerAuth, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;

  if (!customerId) {
    return c.json({ success: true, data: [] });
  }

  // Get coupons assigned to this customer that are still active
  const assigned = await db
    .select({
      id: schema.coupons.id,
      code: schema.coupons.code,
      name: schema.coupons.name,
      description: schema.coupons.description,
      type: schema.coupons.type,
      discount_value: schema.coupons.discount_value,
      min_order_amount: schema.coupons.min_order_amount,
      max_discount_amount: schema.coupons.max_discount_amount,
      expires_at: schema.coupons.expires_at,
      menu_item_id: schema.coupons.menu_item_id,
    })
    .from(schema.couponAssignments)
    .innerJoin(
      schema.coupons,
      eq(schema.couponAssignments.coupon_id, schema.coupons.id),
    )
    .where(
      and(
        eq(schema.couponAssignments.customer_id, customerId),
        eq(schema.coupons.status, "active"),
        sql`(${schema.coupons.expires_at} IS NULL OR ${schema.coupons.expires_at} > NOW())`,
        sql`(${schema.coupons.max_uses_total} IS NULL OR ${schema.coupons.current_uses} < ${schema.coupons.max_uses_total})`,
      ),
    );

  // Mark as seen
  if (assigned.length > 0) {
    const couponIds = assigned.map((a) => a.id);
    await db
      .update(schema.couponAssignments)
      .set({ seen_at: new Date() })
      .where(
        and(
          eq(schema.couponAssignments.customer_id, customerId),
          inArray(schema.couponAssignments.coupon_id, couponIds),
        ),
      );
  }

  return c.json({ success: true, data: assigned });
});

// POST /orders - Create order (customer auth)
customer.post("/orders", customerAuth, requireActiveSession, bloquearSiCartaEstatica, zValidator("json", createOrderSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as any;
  const session = c.get("session") as any;

  const branchId = user.branch;
  const organizationId = user.org;

  // Use customer_name from session if not provided in body
  const customerName = body.customerName || session.customer_name;

  let result;
  try {
    result = await createOrder({
      organizationId,
      branchId,
      items: body.items,
      type: body.type,
      customerName,
      notes: body.notes,
      tableSessionId: session.id,
      customerId: user.customerId || null,
      couponCode: body.couponCode || null,
      redemptionId: body.redemptionId || null,
    });
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: err.message } },
        400,
      );
    }
    throw err;
  }

  const { order, items: createdItems } = result;

  // Difusión. El canal `:kitchen` es el que escucha la pantalla de cocina: sin
  // él, un pedido hecho por el comensal no aparecía hasta el siguiente refresco
  // manual, mientras que los del POS sí (orders.ts ya publicaba en ese canal).
  // El payload replica el de orders.ts —mesa y sesión incluidas— para que la
  // comanda del comensal no llegue a cocina sin decir a qué mesa pertenece.
  const orderPayload = {
    type: "order:new",
    payload: {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      tableSessionId: order.table_session_id,
      tableNumber: session.table_number ?? null,
      items: createdItems.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        status: i.status,
        notes: i.notes,
      })),
    },
    timestamp: Date.now(),
  };

  await realtime.publish(`branch:${branchId}`, orderPayload);
  await realtime.publish(`branch:${branchId}:kitchen`, orderPayload);
  await realtime.publish(`session:${session.id}`, orderPayload);

  return c.json({ success: true, data: { ...order, items: createdItems } }, 201);
});

// GET /orders/:id - Get order status (customer auth)
// Scoped to the caller's OWN session (not just branch) to prevent IDOR; a
// customer can only read orders that belong to their active table session.
customer.get("/orders/:id", customerAuth, requireActiveSession, zValidator("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user") as any;
  const session = c.get("session") as any;

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.id, id),
        eq(schema.orders.organization_id, user.org),
        eq(schema.orders.branch_id, user.branch),
        eq(schema.orders.table_session_id, session.id),
      ),
    )
    .limit(1);

  if (!order) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
      404,
    );
  }

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.order_id, order.id));

  return c.json({ success: true, data: { ...order, items } });
});

// POST /validate-coupon - Validate coupon code (customer auth)
customer.post(
  "/validate-coupon",
  customerAuth,
  zValidator("json", z.object({ code: z.string().min(1) })),
  async (c) => {
    const user = c.get("user") as any;
    const { code } = c.req.valid("json");

    const [coupon] = await db
      .select()
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.organization_id, user.org),
          eq(schema.coupons.code, code.toUpperCase()),
        ),
      )
      .limit(1);

    if (!coupon) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Cupon no encontrado" } },
        404,
      );
    }

    if (coupon.status !== "active") {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon no esta activo" } },
        400,
      );
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon aun no esta vigente" } },
        400,
      );
    }
    if (coupon.expires_at && now > coupon.expires_at) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha expirado" } },
        400,
      );
    }
    if (coupon.max_uses_total && coupon.current_uses >= coupon.max_uses_total) {
      return c.json(
        { success: false, error: { code: "INVALID", message: "El cupon ha alcanzado el limite de usos" } },
        400,
      );
    }

    return c.json({
      success: true,
      data: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        discount_value: coupon.discount_value,
        min_order_amount: coupon.min_order_amount,
        max_discount_amount: coupon.max_discount_amount,
        menu_item_id: coupon.menu_item_id,
      },
    });
  },
);

// POST /orders/:id/cancel - Cancel order before kitchen starts (customer auth)
customer.post(
  "/orders/:id/cancel",
  customerAuth,
  requireActiveSession,
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const user = c.get("user") as any;
    const session = c.get("session") as any;
    const branchId = user.branch;
    const organizationId = user.org;

    // Verify order belongs to the caller's OWN active session (not just branch)
    // to prevent IDOR; also scope by organization for tenant isolation.
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, id),
          eq(schema.orders.organization_id, organizationId),
          eq(schema.orders.branch_id, branchId),
          eq(schema.orders.table_session_id, session.id),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    // Chequeo temprano y barato: si la cocina ya arrancó, se responde sin abrir
    // transacción. NO es la autoridad —entre esta lectura y el commit la cocina
    // puede empezar—; la decisión firme se toma dentro de la transacción.
    const preview = await db
      .select({ status: schema.orderItems.status })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.order_id, id));

    if (preview.some((item) => item.status !== "pending")) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El pedido ya está siendo preparado" } },
        409,
      );
    }

    const cancelledAt = new Date();

    // Toda la secuencia de anulación y reversión va en una transacción para que
    // un fallo a medias no deje cupones, puntos o canjes descuadrados.
    //
    // El aborto se señaliza LANZANDO, nunca devolviendo: en drizzle, salir del
    // callback con un valor CONFIRMA la transacción. Un `return false` después
    // de haber tocado `order_items` dejaría los platos anulados y el pedido
    // vivo, que es justo el descuadre que esta transacción existe para evitar.
    let cancelled = true;
    try {
      await db.transaction(async (tx) => {
        // Cerrojo sobre el pedido: serializa esta anulación contra cualquier
        // otra que entre a la vez y fija un punto estable desde el que releer
        // los ítems.
        const [locked] = await tx
          .select({ id: schema.orders.id, status: schema.orders.status })
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.id, id),
              eq(schema.orders.organization_id, organizationId),
              eq(schema.orders.branch_id, branchId),
              eq(schema.orders.table_session_id, session.id),
            ),
          )
          .limit(1)
          .for("update");

        if (!locked || (locked.status !== "pending" && locked.status !== "preparing")) {
          throw new Error(CANCEL_CONFLICT);
        }

        // Relectura DENTRO del cerrojo: el chequeo previo es de hace unos
        // milisegundos y la cocina pudo pulsar "preparando" en ese hueco. Sin
        // esto el comensal anulaba un plato que ya estaba en la plancha y el
        // local se comía la pérdida.
        const freshItems = await tx
          .select({ id: schema.orderItems.id, status: schema.orderItems.status })
          .from(schema.orderItems)
          .where(eq(schema.orderItems.order_id, id));

        if (freshItems.some((item) => item.status !== "pending")) {
          throw new Error(CANCEL_CONFLICT);
        }

        // Compare-and-swap sobre los ítems: solo caen los que SIGUEN
        // pendientes. Si la cocina gana la carrera justo ahora saldrán menos
        // filas de las leídas y se aborta la transacción entera.
        const cancelledItems = await tx
          .update(schema.orderItems)
          .set({
            status: "cancelled",
            cancelled_at: cancelledAt,
            cancel_reason: "Cancelado por el comensal",
          })
          .where(
            and(
              eq(schema.orderItems.order_id, id),
              eq(schema.orderItems.status, "pending"),
            ),
          )
          .returning({ id: schema.orderItems.id });

        if (cancelledItems.length !== freshItems.length) {
          throw new Error(CANCEL_CONFLICT);
        }

        const updatedOrders = await tx
          .update(schema.orders)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(schema.orders.id, id),
              eq(schema.orders.organization_id, organizationId),
              eq(schema.orders.branch_id, branchId),
              eq(schema.orders.table_session_id, session.id),
              inArray(schema.orders.status, ["pending", "preparing"]),
            ),
          )
          .returning({ id: schema.orders.id });

        if (updatedOrders.length === 0) {
          throw new Error(CANCEL_CONFLICT);
        }

        // Revert coupon if order had one
        const [redemption] = await tx
          .select()
          .from(schema.couponRedemptions)
          .where(eq(schema.couponRedemptions.order_id, id))
          .limit(1);

        if (redemption) {
          // Decrement current_uses
          await tx
            .update(schema.coupons)
            .set({ current_uses: sql`GREATEST(${schema.coupons.current_uses} - 1, 0)` })
            .where(eq(schema.coupons.id, redemption.coupon_id));

          // Delete redemption record
          await tx
            .delete(schema.couponRedemptions)
            .where(eq(schema.couponRedemptions.id, redemption.id));

          // Clear used_at on assignment if customer is known
          if (order.customer_id) {
            await tx
              .update(schema.couponAssignments)
              .set({ used_at: null })
              .where(
                and(
                  eq(schema.couponAssignments.coupon_id, redemption.coupon_id),
                  eq(schema.couponAssignments.customer_id, order.customer_id),
                ),
              );
          }
        }

        // Revert reward redemption if order had one
        const [rewardRedemption] = await tx
          .select({
            id: schema.rewardRedemptions.id,
            customer_loyalty_id: schema.rewardRedemptions.customer_loyalty_id,
            reward_id: schema.rewardRedemptions.reward_id,
          })
          .from(schema.rewardRedemptions)
          .where(eq(schema.rewardRedemptions.order_id, id))
          .limit(1);

        if (rewardRedemption) {
          const [reward] = await tx
            .select({ points_cost: schema.rewards.points_cost, name: schema.rewards.name })
            .from(schema.rewards)
            .where(eq(schema.rewards.id, rewardRedemption.reward_id))
            .limit(1);

          if (reward) {
            // Refund points
            await tx
              .update(schema.customerLoyalty)
              .set({
                points_balance: sql`${schema.customerLoyalty.points_balance} + ${reward.points_cost}`,
              })
              .where(eq(schema.customerLoyalty.id, rewardRedemption.customer_loyalty_id));

            // Record refund transaction
            await tx.insert(schema.loyaltyTransactions).values({
              customer_loyalty_id: rewardRedemption.customer_loyalty_id,
              order_id: id,
              points: reward.points_cost,
              type: "adjusted",
              description: `Reembolso por cancelación: ${reward.name}`,
            });
          }

          // Unlink redemption from order so it can be reused
          await tx
            .update(schema.rewardRedemptions)
            .set({ order_id: null })
            .where(eq(schema.rewardRedemptions.id, rewardRedemption.id));
        }
      });
    } catch (err) {
      // El centinela distingue "llegaste tarde" (409, con la transacción ya
      // deshecha) de un fallo real, que debe seguir propagándose como 500.
      if (err instanceof Error && err.message === CANCEL_CONFLICT) {
        cancelled = false;
      } else {
        throw err;
      }
    }

    if (!cancelled) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El pedido ya está siendo preparado" } },
        409,
      );
    }

    // Traza: una anulación es un movimiento con dinero detrás y hasta ahora no
    // dejaba rastro de quién la pidió. No hay usuario de staff (lo hizo el
    // comensal desde su móvil), así que el actor queda marcado como tal.
    await audit(
      {
        organizationId,
        branchId,
        userId: null,
        userEmail: null,
        userRole: "customer",
        ip:
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          c.req.header("x-real-ip") ??
          null,
      },
      {
        action: "order.cancel",
        entityType: "order",
        entityId: id,
        summary: `Pedido ${order.order_number} anulado por el comensal`,
        before: { status: order.status, total: order.total },
        after: { status: "cancelled" },
      },
    );

    // Difusión de la anulación. Cocina incluida: si el pedido desaparece de la
    // pantalla del comensal pero sigue en la comanda, se cocina comida que nadie
    // va a pagar. El payload lleva los mismos campos que el del POS (orders.ts)
    // para que cualquier pantalla suscrita pueda tratarlos igual.
    const cancelPayload = {
      type: "order:cancelled",
      payload: {
        orderId: id,
        orderNumber: order.order_number,
        tableSessionId: order.table_session_id,
        tableNumber: session.table_number ?? null,
      },
      timestamp: Date.now(),
    };

    await realtime.publish(`branch:${branchId}`, cancelPayload);
    await realtime.publish(`branch:${branchId}:kitchen`, cancelPayload);
    if (order.table_session_id) {
      await realtime.publish(`session:${order.table_session_id}`, cancelPayload);
    }

    return c.json({ success: true, data: { message: "Pedido cancelado exitosamente" } });
  },
);

// POST /table-action - Request bill or call waiter (customer auth)
customer.post(
  "/table-action",
  customerAuth,
  requireActiveSession,
  bloquearSiCartaEstatica,
  zValidator(
    "json",
    z.object({
      action: z.enum(["request_bill", "call_waiter"]),
      tableSessionId: z.string().min(1),
    }),
  ),
  async (c) => {
    const user = c.get("user") as any;
    const activeSession = c.get("session") as {
      id: string;
      customer_name: string | null;
    };
    const { action, tableSessionId } = c.req.valid("json");
    const branchId = user.branch;
    const tableId = user.table;

    if (tableSessionId !== activeSession.id) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Sesion inválida para esta mesa" } },
        403,
      );
    }

    // El aviso se PERSISTE. Antes solo se emitía por realtime: si nadie tenía la
    // pantalla abierta en ese instante, el aviso no había existido nunca, y el
    // antispam vivía en un Map del proceso (se evaporaba en cada despliegue y no
    // servía con más de una instancia). Ahora el "ya hay uno pendiente" lo
    // resuelve un índice único parcial en la base de datos.
    //
    // El servicio valida la mesa dentro del tenant del token y devuelve su
    // número ya resuelto, así que aquí no se repite la consulta.
    let request: Awaited<ReturnType<typeof createServiceRequest>>["request"];
    let alreadyPending: boolean;
    try {
      ({ request, alreadyPending } = await createServiceRequest({
        organizationId: user.org,
        branchId,
        tableId,
        tableSessionId: activeSession.id,
        type: action,
        note: null,
      }));
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      // Ambos casos son "el token apunta a una mesa/sesión que ya no encaja":
      // no es un fallo del servidor, así que no se devuelve un 500.
      if (code === "TABLE_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
          404,
        );
      }
      if (code === "SESSION_TABLE_MISMATCH") {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "Sesion inválida para esta mesa" } },
          403,
        );
      }
      throw err;
    }

    if (alreadyPending) {
      // No se vuelve a emitir el evento: el mozo ya lo tiene en su bandeja y
      // repetirlo solo añade ruido. Se responde 200 con tranquilidad, no un
      // error: para el comensal no ha pasado nada malo.
      return c.json({
        success: true,
        data: {
          message:
            action === "request_bill"
              ? "Ya pedimos tu cuenta, están preparándola"
              : "Ya avisamos al mozo, está en camino",
          requestId: request.id,
          alreadyPending: true,
          created_at: request.created_at,
        },
      });
    }

    const eventType = action === "request_bill" ? "table:request_bill" : "table:call_waiter";
    const message = action === "request_bill" ? "La cuenta ha sido solicitada" : "El mozo ha sido llamado";

    await realtime.publish(`branch:${branchId}`, {
      type: eventType,
      payload: {
        requestId: request.id,
        tableSessionId: activeSession.id,
        tableId,
        tableNumber: request.table_number,
        customerName: activeSession.customer_name || "Cliente",
        action,
      },
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      data: {
        message,
        requestId: request.id,
        alreadyPending: false,
        created_at: request.created_at,
      },
    });
  },
);

// POST /redeem-reward - Self-service reward redemption (customer auth)
customer.post(
  "/redeem-reward",
  customerAuth,
  zValidator("json", z.object({ rewardId: z.string().uuid() })),
  async (c) => {
    const user = c.get("user") as any;
    const customerId = user.customerId;

    if (!customerId) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "No tienes cuenta de fidelidad" } },
        400,
      );
    }

    // Inscripción acotada a un programa de la organización del token: sin este
    // JOIN la inscripción se resolvía solo por customer_id, sin ninguna barrera
    // de tenant en la propia consulta.
    const [enrollment] = await db
      .select({ id: schema.customerLoyalty.id })
      .from(schema.customerLoyalty)
      .innerJoin(
        schema.loyaltyPrograms,
        and(
          eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
          eq(schema.loyaltyPrograms.organization_id, user.org),
        ),
      )
      .where(eq(schema.customerLoyalty.customer_id, customerId))
      .limit(1);

    if (!enrollment) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "No estas inscrito en el programa de fidelidad" } },
        400,
      );
    }

    const { rewardId } = c.req.valid("json");

    try {
      const result = await redeemReward({
        rewardId,
        customerLoyaltyId: enrollment.id,
        organizationId: user.org,
      });
      return c.json({ success: true, data: result }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "REWARD_NOT_FOUND") {
        return c.json({ success: false, error: { code: "NOT_FOUND", message: "Recompensa no encontrada" } }, 404);
      }
      if (message === "INSUFFICIENT_POINTS") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Puntos insuficientes" } }, 400);
      }
      if (message === "PROGRAM_MISMATCH") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "La recompensa no pertenece a tu programa" } }, 400);
      }
      if (message === "LOYALTY_NOT_FOUND") {
        return c.json({ success: false, error: { code: "NOT_FOUND", message: "No estas inscrito en el programa de fidelidad" } }, 404);
      }
      if (message === "REWARD_NOT_AVAILABLE") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Recompensa no disponible" } }, 400);
      }
      if (message === "MAX_PER_CUSTOMER") {
        return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Ya alcanzaste el limite de canjes de esta recompensa" } }, 400);
      }
      if (message === "AGOTADO") {
        return c.json({ success: false, error: { code: "CONFLICT", message: "Recompensa agotada" } }, 409);
      }
      throw err;
    }
  },
);

// GET /my-orders - Orders for the current session (customer auth)
customer.get("/my-orders", customerAuth, async (c) => {
  // user.sub IS the session ID minted at registration — no active-session gate
  // needed for read-only history; the customer should see their orders even
  // while the session is still pending or after it has been closed.
  const user = c.get("user") as any;
  const sessionId = user.sub;

  // El id de sesión ya es único, pero la consulta se acota igualmente al tenant
  // del token: ninguna lectura de este archivo debe depender de que un uuid sea
  // imposible de adivinar para no cruzar de organización.
  const orders = await db
    .select({
      id: schema.orders.id,
      order_number: schema.orders.order_number,
      status: schema.orders.status,
      total: schema.orders.total,
      created_at: schema.orders.created_at,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.table_session_id, sessionId),
        eq(schema.orders.organization_id, user.org),
        eq(schema.orders.branch_id, user.branch),
      ),
    )
    .orderBy(desc(schema.orders.created_at));

  if (orders.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const orderIds = orders.map((o) => o.id);
  const allItems = await db
    .select({
      id: schema.orderItems.id,
      name: schema.orderItems.name,
      quantity: schema.orderItems.quantity,
      status: schema.orderItems.status,
      order_id: schema.orderItems.order_id,
    })
    .from(schema.orderItems)
    .where(
      orderIds.length === 1
        ? eq(schema.orderItems.order_id, orderIds[0])
        : inArray(schema.orderItems.order_id, orderIds),
    );

  const data = orders.map((o) => ({
    ...o,
    items: allItems.filter((i) => i.order_id === o.id),
  }));

  return c.json({ success: true, data });
});

// GET /my-redemptions - Pending redemptions not yet applied to an order (customer auth)
customer.get("/my-redemptions", customerAuth, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;

  if (!customerId) {
    return c.json({ success: true, data: [] });
  }

  // Inscripción del comensal, acotada a un programa DE SU ORGANIZACIÓN. No se
  // filtra por `is_active`: si el local desactiva el programa, lo ya canjeado
  // sigue siendo suyo y tiene que poder verlo (y aplicarlo) en el carrito.
  const [enrollment] = await db
    .select({ id: schema.customerLoyalty.id })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, user.org),
      ),
    )
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (!enrollment) {
    return c.json({ success: true, data: [] });
  }

  // Se prefiere la FOTO tomada al canjear (columnas de reward_redemptions): si
  // el administrador edita la recompensa después, lo ya canjeado no cambia de
  // valor. Solo se cae a la recompensa viva cuando la foto no existe (canjes
  // anteriores a que se guardara). `reward_type` viaja igual que en /my-loyalty
  // para que el carrito no muestre "S/ 0,00" en un producto gratis.
  const redemptions = await db
    .select({
      id: schema.rewardRedemptions.id,
      reward_name: schema.rewards.name,
      reward_type: sql<string>`COALESCE(${schema.rewardRedemptions.reward_type}, ${schema.rewards.reward_type})`,
      discount_type: sql<string | null>`COALESCE(${schema.rewardRedemptions.discount_type}, ${schema.rewards.discount_type})`,
      discount_value: sql<number | null>`COALESCE(${schema.rewardRedemptions.discount_value}, ${schema.rewards.discount_value})`,
      menu_item_id: sql<string | null>`COALESCE(${schema.rewardRedemptions.menu_item_id}, ${schema.rewards.menu_item_id})`,
      // Nombre del plato de la recompensa. Sin él, un "Postre gratis" se le
      // mostraba al comensal como "S/ 0.00 de descuento" y nadie lo canjeaba.
      // El LEFT JOIN es a propósito: si el plato se borró de la carta, la
      // recompensa sigue existiendo y debe poder listarse.
      menu_item_name: schema.menuItems.name,
      points_spent: schema.rewardRedemptions.points_spent,
      redeemed_at: schema.rewardRedemptions.redeemed_at,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.rewards, eq(schema.rewardRedemptions.reward_id, schema.rewards.id))
    .leftJoin(
      schema.menuItems,
      eq(
        schema.menuItems.id,
        sql`COALESCE(${schema.rewardRedemptions.menu_item_id}, ${schema.rewards.menu_item_id})`,
      ),
    )
    .where(
      and(
        eq(schema.rewardRedemptions.customer_loyalty_id, enrollment.id),
        isNull(schema.rewardRedemptions.order_id),
      ),
    );

  return c.json({ success: true, data: redemptions });
});

// GET /my-referral-code - Get (or lazily create) this customer's referral code (customer auth)
customer.get("/my-referral-code", customerAuth, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;

  if (!customerId) {
    return c.json(
      { success: false, error: { code: "BAD_REQUEST", message: "No tienes cuenta de cliente" } },
      400,
    );
  }

  const code = await referralService.getOrCreateReferralCode({
    organizationId: user.org,
    customerId,
  });

  return c.json({ success: true, data: { code } });
});

// GET /my-transactions - Points history for the current customer (customer auth)
customer.get("/my-transactions", customerAuth, async (c) => {
  const user = c.get("user") as any;
  const customerId = user.customerId;
  const orgId = user.org;

  if (!customerId) {
    return c.json({ success: true, data: [] });
  }

  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);

  // Resolve the caller's enrollment in the org's ACTIVE program, scoped strictly
  // to their own customerId (never another customer's history).
  const [enrollment] = await db
    .select({ id: schema.customerLoyalty.id })
    .from(schema.customerLoyalty)
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.organization_id, orgId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .where(eq(schema.customerLoyalty.customer_id, customerId))
    .limit(1);

  if (!enrollment) {
    return c.json({ success: true, data: [] });
  }

  const transactions = await db
    .select({
      id: schema.loyaltyTransactions.id,
      points: schema.loyaltyTransactions.points,
      type: schema.loyaltyTransactions.type,
      description: schema.loyaltyTransactions.description,
      created_at: schema.loyaltyTransactions.created_at,
      expires_at: schema.loyaltyTransactions.expires_at,
      expired: schema.loyaltyTransactions.expired,
    })
    .from(schema.loyaltyTransactions)
    .where(eq(schema.loyaltyTransactions.customer_loyalty_id, enrollment.id))
    .orderBy(desc(schema.loyaltyTransactions.created_at))
    .limit(limit);

  return c.json({ success: true, data: transactions });
});

export { customer };
