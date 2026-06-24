import { AsyncLocalStorage } from "node:async_hooks";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";

type DB = PostgresJsDatabase<typeof schema>;

const connectionString = process.env.DATABASE_URL!;

/**
 * Driver seleccionable por entorno para que el MISMO código corra:
 *  - `postgres-js` (default): conexión TCP persistente. Contenedor (Bun) y Postgres local.
 *  - `neon`: driver serverless de Neon (WebSocket). Soporta transacciones interactivas
 *    y funciona en Node/Bun y en Cloudflare Workers.
 *
 * Se elige con `DATABASE_DRIVER`; si no, se autodetecta por la URL (`*.neon.tech` → neon).
 */
const driver =
  process.env.DATABASE_DRIVER ??
  (connectionString?.includes("neon.tech") ? "neon" : "postgres-js");

async function buildDb(url: string | undefined): Promise<DB> {
  if (driver === "neon") {
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    if (typeof WebSocket !== "undefined") {
      neonConfig.webSocketConstructor = WebSocket as unknown as never;
    }
    return drizzle(new Pool({ connectionString: url }), {
      schema,
    }) as unknown as DB;
  }
  // Especificadores en variable para que el bundler de Workers NO empaquete
  // postgres-js (que usa sockets TCP de Node y no corre en edge). Solo se ejecuta
  // en runtimes con proceso persistente (Bun/Node), donde sí resuelve.
  const pgDrizzleMod = "drizzle-orm/postgres-js";
  const pgMod = "postgres";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { drizzle } = (await import(pgDrizzleMod)) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postgres = ((await import(pgMod)) as any).default;
  return drizzle(postgres(url!), { schema }) as DB;
}

/**
 * Conexión por-request (Cloudflare Workers aísla el I/O por petición, así que no
 * se puede reusar una conexión entre requests). El entrypoint del Worker crea una
 * conexión Neon por petición y ejecuta el handler dentro de `runWithDb`.
 */
const requestScope = new AsyncLocalStorage<DB>();

// Detección de Cloudflare Workers (globals propios del runtime). Ahí NO se
// construye conexión de módulo (se usa siempre la por-request del ALS) y se evita
// importar postgres-js.
const isWorkers =
  typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !==
    "undefined" ||
  (typeof navigator !== "undefined" &&
    (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers");

// Conexión a nivel de módulo: la usan los runtimes con proceso persistente
// (contenedor Bun). En Workers nunca se usa (siempre runWithDb por-request).
//
// IMPORTANTE: sin top-level await. Un TLA en este paquete compartido hace que la
// validación del Worker de Cloudflare falle con "Top-level await in module is
// unsettled". Por eso la conexión de módulo se inicia con `.then` (no se espera
// aquí) y el entrypoint del contenedor llama a `await whenDbReady()` antes de
// servir. En Workers `isWorkers` es true → no se construye nada.
let moduleDb: DB | null = null;
const moduleDbReady: Promise<void> = isWorkers
  ? Promise.resolve()
  : buildDb(connectionString).then((d) => {
      moduleDb = d;
    });

/** Resuelve cuando la conexión de módulo está lista (contenedor/Bun). */
export const whenDbReady = (): Promise<void> => moduleDbReady;

function activeDb(): DB {
  const scoped = requestScope.getStore();
  if (scoped) return scoped;
  if (moduleDb) return moduleDb;
  throw new Error(
    isWorkers
      ? "En Cloudflare Workers la conexión de DB es por-request: usa runWithDb()"
      : "La conexión de DB aún no está lista: usa `await whenDbReady()` en el arranque",
  );
}

/**
 * `db` resuelve dinámicamente a la conexión por-request (si hay una en el ALS) o,
 * en su defecto, a la conexión de módulo. Así los ~13 sitios que hacen
 * `import { db }` no cambian, pero en Workers cada request usa su propia conexión.
 */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const active = activeDb();
    const value = Reflect.get(active as object, prop, receiver);
    return typeof value === "function" ? value.bind(active) : value;
  },
});

/** Crea una conexión Neon dedicada (para usar por-request en serverless). */
export async function createRequestDb(
  url: string,
): Promise<{ db: DB; close: () => Promise<void> }> {
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  if (typeof WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = WebSocket as unknown as never;
  }
  const pool = new Pool({ connectionString: url });
  const requestDb = drizzle(pool, { schema }) as unknown as DB;
  return { db: requestDb, close: () => pool.end() };
}

/** Ejecuta `fn` con `db` apuntando a la conexión indicada (scope de request). */
export function runWithDb<T>(database: DB, fn: () => T): T {
  return requestScope.run(database, fn);
}

export { schema };
export type Database = DB;
export type DbOrTx =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];
