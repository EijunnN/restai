import { sign, verify } from "hono/jwt";

// Lectura perezosa de los secretos: se resuelven al primer uso, no al importar el
// módulo. Así el entrypoint (Worker o Bun) puede poblar process.env antes, y el
// import no tumba el proceso en runtimes donde process.env se hidrata tras el arranque.
function requireSecret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const JWT_SECRET = (): string => requireSecret("JWT_SECRET");
const JWT_REFRESH_SECRET = (): string => requireSecret("JWT_REFRESH_SECRET");

export async function signAccessToken(payload: {
  sub: string;
  org: string;
  role: string;
  branches: string[];
}) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, iat: now, exp: now + 15 * 60 },
    JWT_SECRET(),
  );
}

export async function signRefreshToken(payload: { sub: string }) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 },
    JWT_REFRESH_SECRET(),
  );
}

export async function signCustomerToken(payload: {
  sub: string;
  org: string;
  branch: string;
  table: string;
  customerId?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, role: "customer", iat: now, exp: now + 4 * 60 * 60 },
    JWT_SECRET(),
  );
}

/**
 * Account token for a customer who logged in with an email code (OTP). Unlike
 * signCustomerToken it is NOT bound to a branch/table/session: it carries only
 * { sub = customerId, customerId, org } so it can power profile/loyalty reads
 * (customerAuth checks role==="customer" + reads customerId/org). It does NOT
 * grant ordering, which still requires an active QR table session
 * (requireActiveSession looks up a session row by sub and would not find one).
 */
export async function signCustomerAccountToken(payload: {
  customerId: string;
  org: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: payload.customerId,
      customerId: payload.customerId,
      org: payload.org,
      role: "customer",
      account: true,
      iat: now,
      exp: now + 30 * 24 * 60 * 60, // 30 días: una sesión de "mi cuenta" persistente
    },
    JWT_SECRET(),
  );
}

export async function verifyAccessToken(token: string) {
  return verify(token, JWT_SECRET(), "HS256");
}

export async function verifyRefreshToken(token: string) {
  return verify(token, JWT_REFRESH_SECRET(), "HS256");
}
