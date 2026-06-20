import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRealtimeProvider } from "../infrastructure/container.js";

/**
 * Endpoints de realtime, agnósticos al proveedor:
 *  - GET  /config  → config pública para que el cliente se conecte (provider, key…).
 *  - POST /auth    → autoriza la suscripción a canales privados (Pusher/Ably),
 *                    acotada a las salas que el usuario puede ver (multi-tenant).
 */
const realtime = new Hono<AppEnv>();

realtime.use("*", authMiddleware);

/** Salas a las que el usuario tiene acceso, derivadas del token. */
function allowedRoomsFor(user: any): string[] {
  const rooms: string[] = [];
  if (user.role === "customer") {
    if (user.branch) rooms.push(`branch:${user.branch}`);
    if (user.table) rooms.push(`table:${user.table}`);
    if (user.sub) rooms.push(`session:${user.sub}`);
  } else if (Array.isArray(user.branches)) {
    for (const branchId of user.branches) {
      rooms.push(`branch:${branchId}`);
      rooms.push(`branch:${branchId}:kitchen`);
    }
  }
  return rooms;
}

// GET /config — configuración pública del proveedor para el cliente
realtime.get("/config", (c) => {
  const provider = getRealtimeProvider();
  return c.json({ success: true, data: provider.clientConfig() });
});

// POST /auth — autorización de canal privado (delega en el proveedor)
realtime.post("/auth", async (c) => {
  const provider = getRealtimeProvider();
  if (!provider.authorize) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_SUPPORTED",
          message: `El proveedor ${provider.name} no requiere autorización de canal`,
        },
      },
      400,
    );
  }

  const user = c.get("user") as any;
  let socketId: string | undefined;
  let channel: string | undefined;
  let clientId: string | undefined;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body: any = await c.req.json().catch(() => ({}));
    socketId = body.socket_id ?? body.socketId;
    channel = body.channel_name ?? body.channel;
    clientId = body.client_id ?? body.clientId;
  } else {
    const body = await c.req.parseBody();
    socketId = body["socket_id"] as string | undefined;
    channel = body["channel_name"] as string | undefined;
    clientId = body["client_id"] as string | undefined;
  }

  try {
    // El resultado se devuelve TAL CUAL (lo consume el SDK del proveedor).
    const result = await provider.authorize({
      socketId,
      channel,
      clientId: clientId ?? user.sub,
      allowedRooms: allowedRoomsFor(user),
    });
    return c.json(result as object);
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: err instanceof Error ? err.message : "No autorizado",
        },
      },
      403,
    );
  }
});

export { realtime };
