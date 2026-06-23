import type { PasswordHasher } from "../../core/ports/password-hasher.js";

/**
 * Adaptador de hashing con PBKDF2 vía WebCrypto (Web Crypto API estándar).
 * Es puro y portable: funciona en Node, Bun, Vercel y Cloudflare Workers (edge),
 * sin binarios nativos. Formato: `pbkdf2$<iter>$<saltB64>$<hashB64>`.
 */
// Cloudflare Workers (WebCrypto) limita PBKDF2 a 100 000 iteraciones como máximo;
// pedir más lanza NotSupportedError. 100 000 es el tope soportado en ese runtime.
// `verify` usa las iteraciones embebidas en cada hash, así que bajar este valor no
// rompe hashes ya creados.
const ITERATIONS = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 16;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

/** Comparación en tiempo constante. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export class WebCryptoHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const hashed = await derive(password, salt, ITERATIONS);
    return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hashed)}`;
  }

  async verify(stored: string, password: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1]!, 10);
    const salt = fromB64(parts[2]!);
    const expected = fromB64(parts[3]!);
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  }
}
