import type {
  RealtimePublisher,
  RealtimeProvider,
} from "../core/ports/realtime.js";
import type { PasswordHasher } from "../core/ports/password-hasher.js";
import { NoopRealtime } from "./realtime/noop.adapter.js";
import { WebCryptoHasher } from "./security/webcrypto.adapter.js";

/**
 * Composition root (registro de dependencias).
 *
 * El dominio/HTTP resuelve sus puertos desde aquí. Los DEFAULTS son adaptadores
 * PUROS (sin Node/Bun nativo, Redis ni proveedores externos), por lo que importar
 * este módulo es seguro en cualquier runtime, incluido edge. Cada entrypoint
 * inyecta los adaptadores concretos con `useRealtime` / `useHasher` al arrancar.
 */
let realtimeImpl: RealtimeProvider = new NoopRealtime();
let hasherImpl: PasswordHasher = new WebCryptoHasher();

export function useRealtime(impl: RealtimeProvider): void {
  realtimeImpl = impl;
}

export function useHasher(impl: PasswordHasher): void {
  hasherImpl = impl;
}

/** Proveedor realtime completo (publish + clientConfig + authorize). */
export function getRealtimeProvider(): RealtimeProvider {
  return realtimeImpl;
}

/** Fachada estable del puerto de publicación realtime para el resto de la app. */
export const realtime: RealtimePublisher = {
  publish: (room, data) => realtimeImpl.publish(room, data),
};

/** Fachada estable del puerto de hashing. */
export const passwordHasher: PasswordHasher = {
  hash: (password) => hasherImpl.hash(password),
  verify: (hashed, password) => hasherImpl.verify(hashed, password),
};
