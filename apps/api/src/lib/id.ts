import { randomInt } from "node:crypto";

export function generateOrderNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${date}-${rand}`;
}

export function generateQrCode(branchSlug: string, tableNumber: number): string {
  return `${branchSlug}-T${tableNumber}-${Date.now().toString(36)}`;
}

/**
 * Alfabeto para códigos que un humano tiene que leer en voz alta o teclear.
 *
 * Excluye I, L, O, U, 0 y 1: la confusión entre O/0 y I/1/L es la causa número
 * uno de "el código no funciona" cuando el mozo lo dicta por teléfono o el
 * comensal lo copia de un cartel. La U se quita para evitar palabras soeces
 * accidentales en español.
 */
const HUMAN_SAFE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Código corto de mesa, dictable y tecleable.
 *
 * No pretende ser secreto —está impreso en la mesa— sino corto. La seguridad la
 * aporta el flujo de aprobación de sesión, no la entropía del código. Aun así,
 * 30^5 ≈ 24M combinaciones hacen inviable adivinar la mesa de un local concreto.
 */
export function generateShortCode(length = 5): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += HUMAN_SAFE_ALPHABET[randomInt(HUMAN_SAFE_ALPHABET.length)];
  }
  return out;
}

/**
 * Normaliza lo que teclea el comensal antes de buscar la mesa: mayúsculas y sin
 * separadores, que es lo que la gente añade sola ("nx nv2", "NX-NV2").
 *
 * Deliberadamente NO intenta corregir caracteres ambiguos: como el alfabeto ya
 * los excluye, un 0/1/I/L/O/U en la entrada no tiene una lectura alternativa
 * válida, y adivinar produciría el código de OTRA mesa. Mejor fallar limpio con
 * "mesa no encontrada" que sentar a alguien en la mesa equivocada.
 */
export function normalizeShortCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-_.]/g, "").slice(0, 8);
}
