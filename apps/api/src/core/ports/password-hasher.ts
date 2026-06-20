/**
 * Puerto de hashing de contraseñas (salida).
 *
 * El dominio no sabe si por debajo se usa argon2 (binario nativo, ideal en
 * contenedor/Node) o PBKDF2 vía WebCrypto (portable a edge/Workers). El
 * composition root elige el adaptador según el entorno.
 */
export interface PasswordHasher {
  /** Genera el hash de una contraseña. */
  hash(password: string): Promise<string>;
  /** Verifica una contraseña contra su hash. */
  verify(hashed: string, password: string): Promise<boolean>;
}
