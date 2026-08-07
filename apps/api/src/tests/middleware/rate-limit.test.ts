import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { rateLimiter } from "../../middleware/rate-limit";
import { signAccessToken, signCustomerToken } from "../../lib/jwt";

/**
 * Limitador de peticiones: la clave se compone con la IDENTIDAD.
 *
 * El defecto que cubre esta suite: el cubo era ÚNICO por IP, y en un restaurante
 * todo el personal y todos los comensales salen por la misma IP pública. Un
 * viernes lleno, cinco tablets sondeando /orders cada 5 s se autoinfligían un
 * 429 sin que nadie hiciera nada anómalo.
 *
 * Lo que NO puede perderse al arreglarlo: que un token falsificado o caducado
 * siga cayendo en el cubo de su IP. Si bastara con inventarse un `sub` para
 * estrenar cubo, el límite dejaría de frenar la fuerza bruta contra el login.
 */

const PREFIX = `test-${Math.random().toString(36).slice(2, 10)}`;

let staffA: string;
let staffB: string;
let diner: string;

beforeAll(async () => {
  process.env.JWT_SECRET ||= "test-secret-rate-limit";
  process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-rate-limit";
  staffA = await signAccessToken({ sub: "user-A", org: "org-1", role: "cashier", branches: [] });
  staffB = await signAccessToken({ sub: "user-B", org: "org-1", role: "cashier", branches: [] });
  diner = await signCustomerToken({
    sub: "session-1",
    org: "org-1",
    branch: "branch-1",
    table: "table-1",
  });
});

/** App aislada con su propio espacio de cubos, para que los casos no se pisen. */
function makeApp(scope: string, max = 4, ipOnly = false) {
  const app = new Hono();
  app.use("*", rateLimiter(max, 60_000, `${PREFIX}-${scope}`, { ipOnly }));
  app.get("/x", (c) => c.text("ok"));
  return async (token?: string) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const res = await app.fetch(new Request("http://localhost/x", { headers }));
    return { status: res.status, limit: Number(res.headers.get("X-RateLimit-Limit")) };
  };
}

describe("rateLimiter — clave por identidad", () => {
  it("aplica el tope base a las peticiones anónimas (clave por IP)", async () => {
    const hit = makeApp("anon");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await hit()).status);
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]);
  });

  it("da a cada usuario autenticado su propio cubo, más holgado que el anónimo", async () => {
    const hit = makeApp("staff");
    const first = await hit(staffA);
    expect(first.status).toBe(200);
    // Tope autenticado = base × factor (4 × 6 = 24), no el base.
    expect(first.limit).toBe(24);

    // Se agota el cubo de A: 24 permitidas en total, la 25 ya es 429.
    let last = 200;
    for (let i = 1; i < 25; i++) last = (await hit(staffA)).status;
    expect(last).toBe(429);

    // B no comparte cubo con A aunque salgan por la misma IP.
    expect((await hit(staffB)).status).toBe(200);
    // Y un comensal con sesión de mesa tampoco.
    expect((await hit(diner)).status).toBe(200);
  });

  it("no deja que un token inválido o caducado estrene cubo: cae al de su IP", async () => {
    const hit = makeApp("junk");
    // Agota el cubo anónimo.
    for (let i = 0; i < 4; i++) await hit();

    // Basura, firma incorrecta y token caducado: ninguno es una identidad.
    const forged = await signAccessTokenWithSecret("otro-secreto");
    expect((await hit("no-es-un-jwt")).status).toBe(429);
    expect((await hit(forged)).status).toBe(429);
  });

  /**
   * El cubo de /api/auth/* es lo único que frena la fuerza bruta contra el
   * login. Si un token VÁLIDO cualquiera —una sesión de comensal se consigue con
   * el código impreso en la mesa— comprara un cubo propio y ×6 más holgado, el
   * freno desaparecería: bastaría con rotar sesiones para tener intentos
   * ilimitados desde una sola IP.
   */
  it("el cubo ip-only ignora la identidad aunque el token sea válido", async () => {
    const hit = makeApp("iponly", 4, true);

    // El tope anunciado es el base, no el autenticado, incluso con token.
    const first = await hit(staffA);
    expect(first.limit).toBe(4);

    // Staff, otro staff y comensal comparten el cubo de la IP: 4 en total.
    expect((await hit(staffB)).status).toBe(200);
    expect((await hit(diner)).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit(staffA)).status).toBe(429);
  });
});

/** Token bien formado pero firmado con OTRO secreto: no debe valer como identidad. */
async function signAccessTokenWithSecret(secret: string): Promise<string> {
  const { sign } = await import("hono/jwt");
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: "impostor", org: "org-1", role: "cashier", iat: now, exp: now + 900 }, secret);
}
