import { logger } from "./logger.js";
import { expirePoints, awardBirthdayBonuses } from "../services/loyalty.service.js";
import { notifyExpiringPoints } from "../services/campaign.service.js";

/**
 * Cadencia y cuerpo de las tareas periódicas, COMPARTIDOS por los tres
 * entrypoints (Bun `index.ts`, Node `server.node.ts` y Worker `worker.ts`).
 *
 * Vivían duplicados en cada entrypoint y habían divergido: el Worker de
 * Cloudflare dispara su cron cada 5 minutos —cadencia pensada para expirar
 * sesiones— y acababa ejecutando los trabajos DIARIOS de fidelización 288 veces
 * al día. `awardBirthdayBonuses` recorre customers × customer_loyalty ×
 * loyalty_programs y abre una transacción por candidato; `notifyExpiringPoints`
 * agrega sobre loyalty_transactions por tandas de 1000. Son idempotentes, así
 * que no se veía nada roto: solo la factura de la base de datos.
 *
 * Aquí quedan la cadencia y el cuerpo en un único sitio; cada runtime decide
 * únicamente CÓMO programa el disparo (setInterval o Cron Trigger).
 */

/** Expiración de sesiones de mesa vencidas. */
export const SESSION_EXPIRY_INTERVAL_MS = 60_000;

/** Heartbeat del WS propio: cierra clientes con el JWT ya caducado. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** Retardo tras el arranque antes de la primera pasada (no bloquear el boot). */
export const LOYALTY_BOOT_DELAY_MS = 10_000;

/** Cadencia de los trabajos de fidelización en procesos persistentes. */
export const LOYALTY_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Días de antelación del aviso de puntos por vencer. */
export const EXPIRING_POINTS_DAYS_AHEAD = 7;

/**
 * Hora civil de Lima a la que corren los trabajos diarios en runtimes que solo
 * ofrecen crons (Workers). Las 3 de la madrugada: el local ya cerró, así que ni
 * la carga ni los correos caen en horario de servicio.
 */
export const LOYALTY_DAILY_PERU_HOUR = 3;

// Perú es UTC-5 todo el año (sin horario de verano). Mismo criterio que
// lib/timezone.ts, replicado aquí para no exportar internals de aquel módulo.
const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * ¿Cae este disparo dentro de la ventana diaria de fidelización?
 *
 * Pensado para un Cron Trigger de grano fino (el de cada 5 minutos, que es el
 * que necesita la expiración de sesiones): devuelve true en UN solo disparo al
 * día, el primero de la hora elegida en Lima.
 *
 * @param windowMinutes Ancho de la ventana; debe coincidir con el periodo del
 *                      cron para que encaje exactamente un disparo.
 */
export function isLoyaltyDailyWindow(now: Date = new Date(), windowMinutes = 5): boolean {
  const peru = new Date(now.getTime() + PERU_OFFSET_MS);
  return (
    peru.getUTCHours() === LOYALTY_DAILY_PERU_HOUR && peru.getUTCMinutes() < windowMinutes
  );
}

/**
 * Trabajos diarios de fidelización. Cada uno se aísla en su propio try: que
 * falle la expiración de puntos no puede impedir los cumpleaños ni los avisos.
 * Los tres son idempotentes (la expiración solo actúa sobre puntos vencidos, el
 * bono de cumpleaños está guardado por cliente y año, y el aviso por cliente y
 * ventana), así que repetir una pasada no duplica nada.
 */
export async function runLoyaltyJobs(): Promise<void> {
  try {
    const { expired } = await expirePoints();
    if (expired > 0) logger.info("Loyalty points expiry job ran", { expired });
  } catch (err) {
    logger.error("Loyalty points expiry job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { awarded } = await awardBirthdayBonuses();
    if (awarded > 0) logger.info("Birthday bonus job ran", { awarded });
  } catch (err) {
    logger.error("Birthday bonus job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Aviso previo a la caducidad: sin él, los puntos vencen en silencio y el
  // programa de fidelización quita valor en vez de darlo.
  try {
    const { notified, candidates } = await notifyExpiringPoints({
      daysAhead: EXPIRING_POINTS_DAYS_AHEAD,
    });
    if (notified > 0) {
      logger.info("Expiring points notice job ran", { notified, candidates });
    }
  } catch (err) {
    logger.error("Expiring points notice job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
