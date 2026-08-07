import { whenDbReady } from "@restai/db";

/**
 * Preload de la suite de tests.
 *
 * La conexión de base de datos se construye de forma asíncrona (ver
 * `packages/db/src/index.ts`): hasta que resuelve, cualquier acceso a `db` lanza
 * "La conexión de DB aún no está lista". Los tests que pasaban lo hacían por
 * azar, porque para cuando les tocaba el turno la conexión ya había resuelto; el
 * primer fichero en ejecutarse fallaba siempre, y el síntoma ("DB not ready")
 * se confundía con un fallo de lógica.
 *
 * Esperar aquí, una sola vez antes de toda la suite, elimina esa carrera para
 * todos los ficheros presentes y futuros.
 */
await whenDbReady();
