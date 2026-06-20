import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Cifrado simétrico AES-256-GCM para almacenar secretos en reposo
 * (credenciales SOL y certificado digital de SUNAT).
 *
 * La clave se deriva de la variable de entorno SUNAT_ENCRYPTION_KEY mediante
 * SHA-256, por lo que admite cualquier cadena (idealmente 32+ caracteres aleatorios).
 */

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.SUNAT_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SUNAT_ENCRYPTION_KEY no está configurada (mínimo 16 caracteres)",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** Cifra un texto plano. Devuelve base64 de iv(12) | authTag(16) | ciphertext. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Descifra un texto cifrado con encryptSecret. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/** Indica si el cifrado está disponible (clave configurada). */
export function isEncryptionAvailable(): boolean {
  const secret = process.env.SUNAT_ENCRYPTION_KEY;
  return !!secret && secret.length >= 16;
}
