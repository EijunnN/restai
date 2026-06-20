import { app } from "../app.js";

/**
 * Entrypoint serverless / edge (adaptador de runtime).
 *
 * Reutiliza la MISMA app Hono que el contenedor. No arranca `Bun.serve` ni
 * registra adaptadores nativos: el composition root deja por defecto los
 * adaptadores PUROS (NoopRealtime + WebCryptoHasher), aptos para Cloudflare
 * Workers / Vercel Edge, donde no hay WebSockets persistentes ni binarios nativos.
 *
 * - El tiempo real (cocina/órdenes en vivo) requeriría aquí Durable Objects o SSE.
 * - Las tareas periódicas (expirar sesiones, heartbeat) se moverían a Cron Triggers.
 *
 * Handler con la firma estándar de Web Fetch, compatible con Workers y Bun.
 */
export default {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request);
  },
};
