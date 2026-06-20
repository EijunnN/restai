import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "../../core/ports/password-hasher.js";

/**
 * Adaptador de hashing con argon2 (binario nativo @node-rs/argon2).
 * Recomendado en contenedor/Node. No corre en edge/Workers.
 */
export class Argon2Hasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password);
  }

  verify(hashed: string, password: string): Promise<boolean> {
    return verify(hashed, password);
  }
}
