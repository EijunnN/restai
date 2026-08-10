/**
 * Las notas que se escriben todas las noches.
 *
 * Teclear "sin sal" en una tablet con el cliente delante es lento, y sobre todo
 * cada uno lo escribe distinto ("s/ sal", "SIN SAL", "sin sal x favor"): la
 * cocina lee mejor una frase que siempre es la misma. Son un atajo sobre el
 * campo libre, no un sustituto: lo tecleado a mano se respeta tal cual.
 *
 * Por qué van cableadas y no en la base de datos: son fórmulas de PREPARACIÓN,
 * no carta. Cambian con el idioma del local, no con el menú, y darles pantalla
 * de administración obligaría a todo restaurante nuevo a escribir cinco frases
 * antes de poder vender.
 */
export const NOTAS_RAPIDAS = [
  "Sin sal",
  "Poco picante",
  "Para llevar",
  "Bien cocido",
  "Aparte",
] as const;

/** Lo que separa dos notas en el mismo campo. */
export const SEPARADOR = " · ";

/** Trocea el campo en notas sueltas, sin vacíos. */
export function trocearNotas(texto: string): string[] {
  return texto
    .split("·")
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
}

function igual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * ¿Está ya esta nota en el campo?
 *
 * Compara sin distinguir mayúsculas: la nota que el cajero tecleó a mano en
 * minúsculas es la misma que la del atajo, y marcarla dos veces manda a cocina
 * "sin sal · Sin sal".
 */
export function tieneNota(texto: string, nota: string): boolean {
  return trocearNotas(texto).some((parte) => igual(parte, nota));
}

/** Pone la nota si falta, la quita si sobra. Lo demás no se toca. */
export function alternarNota(texto: string, nota: string): string {
  const partes = trocearNotas(texto);
  const sinElla = partes.filter((parte) => !igual(parte, nota));
  if (sinElla.length !== partes.length) return sinElla.join(SEPARADOR);
  return [...partes, nota.trim()].join(SEPARADOR);
}
