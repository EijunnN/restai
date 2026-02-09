import { sign, verify } from "hono/jwt";

if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET environment variables are required");
}

const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET;

export async function signAccessToken(payload: {
  sub: string;
  org: string;
  role: string;
  branches: string[];
}) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, iat: now, exp: now + 15 * 60 },
    JWT_SECRET,
  );
}

export async function signRefreshToken(payload: { sub: string }) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 },
    JWT_REFRESH_SECRET,
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
    JWT_SECRET,
  );
}

export async function verifyAccessToken(token: string) {
  return verify(token, JWT_SECRET, "HS256");
}

export async function verifyRefreshToken(token: string) {
  return verify(token, JWT_REFRESH_SECRET, "HS256");
}
