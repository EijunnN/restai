import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";

const connectionString = process.env.DATABASE_URL!;

/**
 * Driver de base de datos seleccionable por entorno, para que el MISMO código
 * se despliegue de dos formas sin cambios:
 *
 *  - `postgres-js` (por defecto): conexión TCP clásica. Ideal para el contenedor
 *    Bun (docker-compose, Contabo, Railway, Render, Cloudflare Containers…).
 *  - `neon`: driver serverless de Neon (HTTP/WebSocket). Funciona en runtimes
 *    serverless y también en Bun/Node contra una base Neon.
 *
 * Se elige con `DATABASE_DRIVER=neon|postgres-js`. Si no se define, se autodetecta:
 * una URL `*.neon.tech` usa el driver de Neon; cualquier otra usa postgres-js.
 * Cada driver se carga con import dinámico, así el bundle del target solo incluye el suyo.
 */
const driver =
  process.env.DATABASE_DRIVER ??
  (connectionString?.includes("neon.tech") ? "neon" : "postgres-js");

let db: PostgresJsDatabase<typeof schema>;

if (driver === "neon") {
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  // En runtimes sin WebSocket global (Node), usar el constructor nativo si existe.
  if (typeof WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = WebSocket as unknown as never;
  }
  const pool = new Pool({ connectionString });
  db = drizzle(pool, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
} else {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const client = postgres(connectionString);
  db = drizzle(client, { schema });
}

export { db, schema };
export type Database = typeof db;
export type DbOrTx =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];
