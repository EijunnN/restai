import { eq, and } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { verifyAccessToken } from "../lib/jwt.js";

/**
 * Autenticación del comensal.
 *
 * Vive aquí —y no dentro de `routes/customer.ts`, que es donde nació— porque
 * más de una ruta necesita exactamente esta comprobación (la carta por voz es
 * la primera). Duplicar un middleware de auth es la forma habitual de que dos
 * copias se separen y una se quede sin un control que la otra sí tiene.
 *
 * Acepta los DOS tokens de comensal: el de sesión de mesa (QR) y el de cuenta
 * por código de email. Distinguirlos es trabajo de `requireActiveSession`: solo
 * el de mesa tiene sesión activa detrás, y solo él habilita pedir.
 */
export const customerAuth = async (c: any, next: any) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Token requerido" } },
      401,
    );
  }

  try {
    const payload = await verifyAccessToken(header.slice(7));
    if ((payload as any).role !== "customer") {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Solo clientes" } },
        403,
      );
    }
    c.set("user", payload);
    return next();
  } catch {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Token inválido" } },
      401,
    );
  }
};

// Middleware to validate that the customer's session is still active.
// Resolve the session by the token's OWN session id (user.sub), not by table_id.
// This ties every action to the exact session the token was minted for, and we
// additionally assert it matches the token's org/branch/table so a reused token
// cannot act against a different tenant/table.
export const requireActiveSession = async (c: any, next: any) => {
  const user = c.get("user") as any;

  // Se trae también el NÚMERO de mesa: los eventos que salen de aquí
  // (`order:new`, `order:cancelled`) lo llevan igual que los del POS, y sin él
  // la comanda del comensal aparecía en cocina sin decir a qué mesa va. El JOIN
  // va acotado al tenant del token para que no pueda resolver una mesa ajena.
  const [session] = await db
    .select({
      id: schema.tableSessions.id,
      status: schema.tableSessions.status,
      customer_name: schema.tableSessions.customer_name,
      table_number: schema.tables.number,
    })
    .from(schema.tableSessions)
    .innerJoin(
      schema.tables,
      and(
        eq(schema.tableSessions.table_id, schema.tables.id),
        eq(schema.tables.organization_id, user.org),
        eq(schema.tables.branch_id, user.branch),
      ),
    )
    .where(
      and(
        eq(schema.tableSessions.id, user.sub),
        eq(schema.tableSessions.organization_id, user.org),
        eq(schema.tableSessions.branch_id, user.branch),
        eq(schema.tableSessions.table_id, user.table),
        eq(schema.tableSessions.status, "active"),
      ),
    )
    .limit(1);

  if (!session) {
    return c.json(
      { success: false, error: { code: "SESSION_ENDED", message: "Tu sesión ha finalizado" } },
      403,
    );
  }

  c.set("session", session);
  return next();
};
