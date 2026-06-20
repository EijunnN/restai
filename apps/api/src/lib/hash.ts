import { passwordHasher } from "../infrastructure/container.js";

/**
 * Fachada de hashing: delega en el adaptador resuelto por el composition root
 * (argon2 en contenedor/Node; WebCrypto/PBKDF2 en edge). Las rutas siguen
 * importando estas funciones sin conocer la implementación concreta.
 */
export function hashPassword(password: string): Promise<string> {
  return passwordHasher.hash(password);
}

export function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  return passwordHasher.verify(hashed, password);
}
