import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@restai/db";
import type { AppEnv } from "../types.js";

/**
 * Roles con visibilidad sobre TODAS las sedes.
 *
 * - `super_admin`: acceso global real (soporte de la plataforma).
 * - `org_admin`: dueño de la cadena; ve todas las sedes de SU organización.
 *
 * Cualquier otro rol (incluido `branch_manager`) solo alcanza las sedes de las
 * que es miembro explícito en `user_branches`. El gerente de Surco no tiene por
 * qué poder renombrar —ni re-sluggear— la sede de Miraflores.
 */
export function hasGlobalBranchAccess(role?: string | null): boolean {
  return role === "super_admin" || role === "org_admin";
}

/**
 * Sedes de las que el usuario es miembro explícito, leídas de `user_branches`
 * y acotadas a la organización indicada.
 *
 * Se consulta la BD y no el claim `branches` del JWT a propósito: el token vive
 * 15 minutos, así que quitarle una sede a alguien tardaría hasta 15 minutos en
 * surtir efecto si nos fiáramos solo del claim.
 */
export async function getMemberBranchIds(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.branches.id })
    .from(schema.userBranches)
    .innerJoin(schema.branches, eq(schema.userBranches.branch_id, schema.branches.id))
    .where(
      and(
        eq(schema.userBranches.user_id, userId),
        eq(schema.branches.organization_id, organizationId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Sedes que el usuario del contexto puede consultar.
 *
 * Devuelve `null` cuando el rol ve todas las sedes de la organización: en ese
 * caso NO hay que filtrar por sede, pero la consulta sigue teniendo que filtrar
 * por `organization_id` (eso no lo cubre este helper).
 *
 * Devuelve un array —posiblemente vacío— para el resto de roles. Un array vacío
 * significa "ninguna sede": hay que responder un listado vacío, no omitir el
 * filtro.
 */
export async function getAccessibleBranchIds(c: Context): Promise<string[] | null> {
  const user = c.get("user") as any;
  const tenant = c.get("tenant") as any;
  if (hasGlobalBranchAccess(user?.role)) return null;
  if (!user?.sub || !tenant?.organizationId) return [];
  return getMemberBranchIds(user.sub, tenant.organizationId);
}

/**
 * ¿Puede este usuario operar sobre esta sede concreta?
 *
 * Para roles globales devuelve `true`; la pertenencia de la sede a la
 * organización debe seguir comprobándose en la consulta que la carga
 * (`eq(branches.organization_id, tenant.organizationId)`).
 */
export async function canAccessBranch(c: Context, branchId: string): Promise<boolean> {
  const accessible = await getAccessibleBranchIds(c);
  if (accessible === null) return true;
  return accessible.includes(branchId);
}

export const tenantMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user") as any;
  if (!user) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } },
      401,
    );
  }

  if (user.role === "customer") {
    c.set("tenant", {
      organizationId: user.org,
      branchId: user.branch,
    });
    return next();
  }

  // Staff user
  const organizationId = user.org;
  const branchId =
    c.req.header("x-branch-id") || c.req.query("branchId") || null;

  if (branchId) {
    // super_admin is the ONLY true global bypass: it may address any branch
    // across organizations without an ownership check.
    //
    // PERO el par (organización, sede) tiene que ser COHERENTE. Antes se
    // combinaba el `org` de su token con el `x-branch-id` recibido sin
    // comprobar nada, así que un super_admin apuntando a la sede de otra
    // organización quedaba con un contexto imposible: las consultas que filtran
    // por ambos campos no devolvían nada, y las que filtran solo por sede
    // escribían con el organization_id equivocado. Se resuelve la sede en la
    // base y se adopta SU organización, que es la única lectura correcta de
    // "quiero trabajar en esta sede".
    if (user.role === "super_admin") {
      const [branch] = await db
        .select({
          id: schema.branches.id,
          organization_id: schema.branches.organization_id,
        })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);

      if (!branch) {
        return c.json(
          {
            success: false,
            error: { code: "NOT_FOUND", message: "Sede no encontrada" },
          },
          404,
        );
      }

      c.set("tenant", {
        organizationId: branch.organization_id,
        branchId: branch.id,
      });
      return next();
    }

    if (user.role === "org_admin") {
      // org_admin has global access *within its own org* only: the supplied
      // branch must belong to the caller's organization. Verify ownership
      // against the DB before trusting the client-supplied branch id.
      const [branch] = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.id, branchId),
            eq(schema.branches.organization_id, organizationId),
          ),
        )
        .limit(1);

      if (!branch) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
          403,
        );
      }
    } else {
      // Roles no globales: tienen que ser miembros explícitos de la sede.
      //
      // La ÚNICA fuente de verdad es `user_branches`, no el claim `branches` del
      // JWT. El claim no aporta seguridad —un token viejo con sedes de más lo
      // frena igualmente la comprobación en BD, que es más restrictiva— y en
      // cambio introducía una incoherencia visible: al añadirle una sede a un
      // gerente, GET /api/branches (que lee la BD) ya se la mostraba en el
      // selector, pero seleccionarla devolvía 403 hasta que caducara el token.
      // Consultar la BD además hace que REVOCAR una sede surta efecto de
      // inmediato en lugar de esperar 15 minutos.
      if (!user.sub) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
          403,
        );
      }

      const [membership] = await db
        .select({ branch_id: schema.userBranches.branch_id })
        .from(schema.userBranches)
        .innerJoin(schema.branches, eq(schema.userBranches.branch_id, schema.branches.id))
        .where(
          and(
            eq(schema.userBranches.user_id, user.sub),
            eq(schema.userBranches.branch_id, branchId),
            eq(schema.branches.organization_id, organizationId),
          ),
        )
        .limit(1);

      if (!membership) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
          403,
        );
      }
    }
  }

  c.set("tenant", { organizationId, branchId: branchId! });
  return next();
});

export const requireBranch = createMiddleware<AppEnv>(async (c, next) => {
  const tenant = c.get("tenant");
  if (!tenant?.branchId) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Se requiere x-branch-id header o branchId query param" },
      },
      400,
    );
  }
  return next();
});
