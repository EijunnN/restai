import { logger } from "./logger.js";

/**
 * Manejadores de errores no capturados del proceso.
 *
 * Compartidos por los entrypoints de proceso persistente (Bun `index.ts` y Node
 * `server.node.ts`). Estaban SOLO en el de Bun: en Node ≥15 una promesa
 * rechazada sin manejar termina el proceso por defecto, así que el entrypoint
 * `start:node` se caía entero por cualquier promesa lanzada sin `await` que
 * rechazara (un envío de correo fire-and-forget, un `realtime.publish` contra un
 * proveedor cloud que devuelve error), mientras el mismo código en Bun solo
 * dejaba una línea de log.
 *
 * Criterio, deliberadamente distinto para cada caso:
 *  - `unhandledRejection`: se registra y el proceso SIGUE. Es casi siempre un
 *    efecto secundario opcional (correo, telemetría, publicación realtime); no
 *    tiene sentido tirar el servidor y cortar el servicio del local por eso.
 *  - `uncaughtException`: se registra y se SALE con código 1. Aquí el estado del
 *    proceso ya no es de fiar, y lo correcto es que el orquestador lo reinicie.
 *
 * No se registra en Workers: ese runtime no expone `process.on` ni tiene un
 * proceso que reiniciar.
 */
export function registerProcessErrorHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
