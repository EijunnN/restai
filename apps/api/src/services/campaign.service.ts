import { and, eq, lte, gte, isNull, or } from "drizzle-orm";
import { db, schema } from "@restai/db";

// Peru is always UTC-5 (no DST).
const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Project a UTC `Date` into Lima wall-clock fields. Returns the Lima weekday
 * (0=Sun..6=Sat) and "HH:MM" 24h string, computed by shifting the instant by
 * the fixed -5h offset and reading the UTC components (same approach as
 * lib/timezone.ts).
 */
function limaWallClock(at: Date): { weekday: number; hhmm: string } {
  const lima = new Date(at.getTime() + PERU_OFFSET_MS);
  const weekday = lima.getUTCDay();
  const hh = String(lima.getUTCHours()).padStart(2, "0");
  const mm = String(lima.getUTCMinutes()).padStart(2, "0");
  return { weekday, hhmm: `${hh}:${mm}` };
}

/**
 * Whether `hhmm` falls inside the [start, end] Lima time-of-day window.
 * - Both null => always in window (all day).
 * - start <= end (normal window): start <= hhmm <= end.
 * - start > end (window crosses midnight): hhmm >= start OR hhmm <= end.
 * A single null bound is treated as open on that side.
 */
function inTimeWindow(
  hhmm: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start && !end) return true;
  if (start && !end) return hhmm >= start;
  if (!start && end) return hhmm <= end;
  // both present
  if (start! <= end!) return hhmm >= start! && hhmm <= end!;
  return hhmm >= start! || hhmm <= end!;
}

/**
 * getActiveCampaignBoost
 *
 * Combined earning boost from every campaign currently active for `at`:
 *   - status = "active"
 *   - starts_at null or <= at, and ends_at null or >= at
 *   - days_of_week empty (= all days) or includes the Lima weekday of `at`
 *   - start_time/end_time Lima window contains the Lima time of `at`
 *   - tier_id null (= all members) or equal to the customer's tierId
 *
 * When several campaigns match, their multipliers are multiplied together
 * (kept in integer "100 = 1x" space) and their bonus_points summed. Returns
 * { multiplier: 100, bonusPoints: 0 } when none match. Pure / read-only.
 */
export async function getActiveCampaignBoost(params: {
  organizationId: string;
  tierId: string | null;
  at: Date;
}): Promise<{ multiplier: number; bonusPoints: number }> {
  const { organizationId, tierId, at } = params;

  // Narrow by org, status and the date range in SQL; finer-grained day/time/tier
  // matching happens in JS below (days_of_week is a jsonb array; the time window
  // is Lima wall-clock).
  const rows = await db
    .select({
      days_of_week: schema.campaigns.days_of_week,
      start_time: schema.campaigns.start_time,
      end_time: schema.campaigns.end_time,
      multiplier: schema.campaigns.multiplier,
      bonus_points: schema.campaigns.bonus_points,
      tier_id: schema.campaigns.tier_id,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.organization_id, organizationId),
        eq(schema.campaigns.status, "active"),
        or(isNull(schema.campaigns.starts_at), lte(schema.campaigns.starts_at, at)),
        or(isNull(schema.campaigns.ends_at), gte(schema.campaigns.ends_at, at)),
      ),
    );

  if (rows.length === 0) {
    return { multiplier: 100, bonusPoints: 0 };
  }

  const { weekday, hhmm } = limaWallClock(at);

  // Multipliers compose multiplicatively in "100 = 1x" space, so the running
  // product is divided by 100 per extra match to stay in that space.
  let multiplier = 100;
  let bonusPoints = 0;

  for (const row of rows) {
    // Tier segment: null = all members, else must equal the customer's tier.
    if (row.tier_id != null && row.tier_id !== tierId) continue;

    // Day-of-week: empty array = every day, else the Lima weekday must be listed.
    const days = Array.isArray(row.days_of_week)
      ? (row.days_of_week as unknown[]).map((d) => Number(d))
      : [];
    if (days.length > 0 && !days.includes(weekday)) continue;

    // Time-of-day window (Lima HH:MM).
    if (!inTimeWindow(hhmm, row.start_time, row.end_time)) continue;

    multiplier = Math.floor((multiplier * row.multiplier) / 100);
    bonusPoints += row.bonus_points;
  }

  return { multiplier, bonusPoints };
}
