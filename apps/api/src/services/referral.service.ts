import { eq, and, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { adjustPoints } from "./loyalty.service.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Referral code generation
// ---------------------------------------------------------------------------

// 8-char uppercase codes from an unambiguous alphabet (no easily-confused
// characters like 0/O or 1/I/L) so codes are safe to read aloud / type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// ---------------------------------------------------------------------------
// getOrCreateReferralCode
// ---------------------------------------------------------------------------

/**
 * Return the customer's existing referral_code, or generate a unique one and
 * persist it. Uniqueness is per organization (enforced by the partial unique
 * index uq_customers_org_referral_code). On a conflict we retry with a fresh
 * code. Org-scoped: only updates the row when it belongs to organizationId.
 */
export async function getOrCreateReferralCode(params: {
  organizationId: string;
  customerId: string;
}): Promise<string> {
  const { organizationId, customerId } = params;

  const [existing] = await db
    .select({ referral_code: schema.customers.referral_code })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, customerId),
        eq(schema.customers.organization_id, organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("CUSTOMER_NOT_FOUND");
  }

  if (existing.referral_code) {
    return existing.referral_code;
  }

  // Generate-and-persist with retry on the per-org unique conflict.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    // Only set the code if it is still null (another concurrent call may have
    // won the race and set it first); scope strictly to the org.
    const updated = await db
      .update(schema.customers)
      .set({ referral_code: code })
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organization_id, organizationId),
          sql`${schema.customers.referral_code} IS NULL`,
        ),
      )
      .returning({ referral_code: schema.customers.referral_code })
      .catch((err) => {
        // Unique violation on (organization_id, referral_code): treat as retry.
        if (isUniqueViolation(err)) return [] as { referral_code: string | null }[];
        throw err;
      });

    if (updated.length > 0 && updated[0].referral_code) {
      return updated[0].referral_code;
    }

    // 0 rows updated => a concurrent call already set a code; re-read and return.
    const [refreshed] = await db
      .select({ referral_code: schema.customers.referral_code })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (refreshed?.referral_code) {
      return refreshed.referral_code;
    }
    // Otherwise the code was still null (unique conflict) — loop and retry.
  }

  throw new Error("REFERRAL_CODE_GENERATION_FAILED");
}

// Best-effort detection of a Postgres unique-violation (SQLSTATE 23505).
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// registerReferral
// ---------------------------------------------------------------------------

/**
 * Bind a newly-registered referee to the referrer identified by `code` and open
 * a pending referrals row stamped with the program's configured reward amounts.
 *
 * Idempotent: if the referee already has referred_by set, this is a no-op.
 * Rejects self-referral and unknown/foreign codes (resolved within the org).
 * Returns { ok } indicating whether a referral was registered.
 */
export async function registerReferral(params: {
  organizationId: string;
  refereeCustomerId: string;
  code: string;
}): Promise<{ ok: boolean }> {
  const { organizationId, refereeCustomerId } = params;
  const code = params.code.trim().toUpperCase();

  if (!code) return { ok: false };

  return await db.transaction(async (tx) => {
    // Referee must exist in this org and not already be referred.
    const [referee] = await tx
      .select({
        id: schema.customers.id,
        referred_by: schema.customers.referred_by,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, refereeCustomerId),
          eq(schema.customers.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (!referee || referee.referred_by) {
      // Unknown referee or already referred -> idempotent no-op.
      return { ok: false };
    }

    // Resolve referrer by code within the same org.
    const [referrer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organization_id, organizationId),
          eq(schema.customers.referral_code, code),
        ),
      )
      .limit(1);

    if (!referrer) {
      return { ok: false };
    }

    // Reject self-referral.
    if (referrer.id === refereeCustomerId) {
      return { ok: false };
    }

    // Stamp the referral with the active program's reward amounts (0 if none).
    const [program] = await tx
      .select({
        referrer_points: schema.loyaltyPrograms.referral_referrer_points,
        referee_points: schema.loyaltyPrograms.referral_referee_points,
      })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.organization_id, organizationId),
          eq(schema.loyaltyPrograms.is_active, true),
        ),
      )
      .limit(1);

    const referrerPoints = program?.referrer_points ?? 0;
    const refereePoints = program?.referee_points ?? 0;

    // Bind referee -> referrer. Guard on referred_by IS NULL to keep the
    // SELECT-then-UPDATE race idempotent: only the first writer succeeds.
    const bound = await tx
      .update(schema.customers)
      .set({ referred_by: referrer.id })
      .where(
        and(
          eq(schema.customers.id, refereeCustomerId),
          eq(schema.customers.organization_id, organizationId),
          sql`${schema.customers.referred_by} IS NULL`,
        ),
      )
      .returning({ id: schema.customers.id });

    if (bound.length === 0) {
      // Lost the race; another caller already registered the referral.
      return { ok: false };
    }

    await tx.insert(schema.referrals).values({
      organization_id: organizationId,
      referrer_customer_id: referrer.id,
      referee_customer_id: refereeCustomerId,
      code,
      status: "pending",
      referrer_points: referrerPoints,
      referee_points: refereePoints,
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// completeReferralForFirstOrder
// ---------------------------------------------------------------------------

/**
 * On a referee's first completed order, mark their pending referral completed
 * and award the configured points to BOTH parties via adjustPoints.
 *
 * Idempotent via the pending->completed transition: the status update only
 * affects a row that is still 'pending', so a second call awards nothing.
 * Accepts an optional tx so it can join an order-completion transaction.
 */
export async function completeReferralForFirstOrder(params: {
  organizationId: string;
  customerId: string;
  tx?: DbOrTx;
}): Promise<void> {
  const { organizationId, customerId } = params;
  const runner: DbOrTx = params.tx ?? db;

  // Find a pending referral for this referee within the org.
  const [pending] = await runner
    .select({
      id: schema.referrals.id,
      referrer_customer_id: schema.referrals.referrer_customer_id,
      referee_customer_id: schema.referrals.referee_customer_id,
      referrer_points: schema.referrals.referrer_points,
      referee_points: schema.referrals.referee_points,
    })
    .from(schema.referrals)
    .where(
      and(
        eq(schema.referrals.organization_id, organizationId),
        eq(schema.referrals.referee_customer_id, customerId),
        eq(schema.referrals.status, "pending"),
      ),
    )
    .limit(1);

  if (!pending) return;

  // Atomically claim the referral: only proceed if THIS call flips it from
  // pending -> completed. A concurrent caller that lost gets 0 rows back.
  const claimed = await runner
    .update(schema.referrals)
    .set({ status: "completed", completed_at: new Date() })
    .where(
      and(
        eq(schema.referrals.id, pending.id),
        eq(schema.referrals.status, "pending"),
      ),
    )
    .returning({ id: schema.referrals.id });

  if (claimed.length === 0) return;

  // Award points to both parties. adjustPoints clamps >= 0 and writes a ledger
  // row; skip zero awards (e.g. when referrals are configured at 0 points).
  if (pending.referrer_points > 0) {
    try {
      await adjustPoints({
        organizationId,
        customerId: pending.referrer_customer_id,
        amount: pending.referrer_points,
        reason: "Referido",
      });
    } catch (err) {
      // Referrer may not be enrolled in the active program; log and continue so
      // the referee still gets their reward.
      logger.warn("completeReferralForFirstOrder: referrer award failed", {
        referralId: pending.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pending.referee_points > 0) {
    try {
      await adjustPoints({
        organizationId,
        customerId: pending.referee_customer_id,
        amount: pending.referee_points,
        reason: "Referido",
      });
    } catch (err) {
      logger.warn("completeReferralForFirstOrder: referee award failed", {
        referralId: pending.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
