/**
 * Peru timezone utilities.
 * Peru is always UTC-5 (no DST).
 */

const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Returns the start of "today" in Peru timezone (UTC-5),
 * expressed as a UTC Date object.
 */
export function peruStartOfDay(date: Date = new Date()): Date {
  const peruTime = new Date(date.getTime() + PERU_OFFSET_MS);
  return new Date(
    Date.UTC(peruTime.getUTCFullYear(), peruTime.getUTCMonth(), peruTime.getUTCDate()) - PERU_OFFSET_MS,
  );
}

/**
 * Returns the end of "today" in Peru timezone (UTC-5),
 * expressed as a UTC Date object (start of next day).
 */
export function peruEndOfDay(date: Date = new Date()): Date {
  return new Date(peruStartOfDay(date).getTime() + 24 * 60 * 60 * 1000);
}
