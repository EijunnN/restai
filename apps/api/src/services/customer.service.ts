import { eq, and } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { enrollCustomer } from "./loyalty.service.js";

// ---------------------------------------------------------------------------
// Internal: insert customer + auto-enroll in loyalty (requires existing tx)
// ---------------------------------------------------------------------------

async function insertAndEnroll(
  tx: DbOrTx,
  params: {
    organizationId: string;
    name: string;
    email?: string;
    phone?: string;
    birthDate?: string;
    marketingOptIn?: boolean;
  },
) {
  const { organizationId, name, email, phone, birthDate, marketingOptIn } = params;

  // Conflict-safe insert: the partial unique indexes uq_customers_org_phone /
  // uq_customers_org_email close the SELECT-then-INSERT race. onConflictDoNothing
  // makes a concurrent duplicate a no-op; we then re-select the winner instead of
  // creating a split identity.
  const [inserted] = await tx
    .insert(schema.customers)
    .values({
      organization_id: organizationId,
      name,
      email,
      phone,
      birth_date: birthDate,
      marketing_opt_in: marketingOptIn ?? false,
      consent_at: marketingOptIn ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    const loyalty = await enrollCustomer(
      { customerId: inserted.id, organizationId },
      tx,
    );
    return { customer: inserted, loyalty };
  }

  // A concurrent insert won the race — resolve the existing row by email or phone.
  let existing:
    | typeof schema.customers.$inferSelect
    | undefined;
  if (email) {
    [existing] = await tx
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organization_id, organizationId),
          eq(schema.customers.email, email),
        ),
      )
      .limit(1);
  }
  if (!existing && phone) {
    [existing] = await tx
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organization_id, organizationId),
          eq(schema.customers.phone, phone),
        ),
      )
      .limit(1);
  }
  if (!existing) {
    // Should not happen (a conflict implies a matching row exists), but fail
    // loudly rather than silently creating nothing.
    throw new Error("CUSTOMER_CONFLICT_UNRESOLVED");
  }

  if (marketingOptIn && !existing.marketing_opt_in) {
    await tx
      .update(schema.customers)
      .set({ marketing_opt_in: true, consent_at: new Date() })
      .where(eq(schema.customers.id, existing.id));
  }

  let [loyalty] = await tx
    .select()
    .from(schema.customerLoyalty)
    .where(eq(schema.customerLoyalty.customer_id, existing.id))
    .limit(1);
  if (!loyalty) {
    loyalty = (await enrollCustomer(
      { customerId: existing.id, organizationId },
      tx,
    )) as typeof schema.customerLoyalty.$inferSelect;
  }

  return { customer: existing, loyalty: loyalty ?? null };
}

// Upgrade marketing consent on an already-existing customer (tx-scoped).
async function applyConsent(
  tx: DbOrTx,
  customer: { id: string; marketing_opt_in: boolean },
  marketingOptIn?: boolean,
) {
  if (marketingOptIn && !customer.marketing_opt_in) {
    await tx
      .update(schema.customers)
      .set({ marketing_opt_in: true, consent_at: new Date() })
      .where(eq(schema.customers.id, customer.id));
  }
}

// ---------------------------------------------------------------------------
// createCustomer — standalone insert + enroll (own transaction)
// ---------------------------------------------------------------------------

export async function createCustomer(params: {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  marketingOptIn?: boolean;
}) {
  return db.transaction((tx) => insertAndEnroll(tx, params));
}

// ---------------------------------------------------------------------------
// findOrCreate — dedup by email (preferred) then phone, else create new
// All reads + potential write run in a single transaction.
// ---------------------------------------------------------------------------

export async function findOrCreate(params: {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  marketingOptIn?: boolean;
}) {
  const { organizationId, name, email, phone, birthDate, marketingOptIn } = params;

  return db.transaction(async (tx) => {
    // 1. Search by email (most reliable identifier)
    if (email) {
      const [byEmail] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.organization_id, organizationId),
            eq(schema.customers.email, email),
          ),
        )
        .limit(1);

      if (byEmail) {
        await applyConsent(tx, byEmail, marketingOptIn);
        // Backfill missing fields
        if ((phone && !byEmail.phone) || (birthDate && !byEmail.birth_date)) {
          await tx
            .update(schema.customers)
            .set({
              ...(phone && !byEmail.phone ? { phone } : {}),
              ...(birthDate && !byEmail.birth_date
                ? { birth_date: birthDate }
                : {}),
            })
            .where(eq(schema.customers.id, byEmail.id));
        }
        const [loyalty] = await tx
          .select()
          .from(schema.customerLoyalty)
          .where(eq(schema.customerLoyalty.customer_id, byEmail.id))
          .limit(1);
        return { customer: byEmail, loyalty: loyalty || null, isNew: false };
      }
    }

    // 2. Search by phone
    if (phone) {
      const [byPhone] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.organization_id, organizationId),
            eq(schema.customers.phone, phone),
          ),
        )
        .limit(1);

      if (byPhone) {
        await applyConsent(tx, byPhone, marketingOptIn);
        // Backfill missing fields
        if ((email && !byPhone.email) || (birthDate && !byPhone.birth_date)) {
          await tx
            .update(schema.customers)
            .set({
              ...(email && !byPhone.email ? { email } : {}),
              ...(birthDate && !byPhone.birth_date
                ? { birth_date: birthDate }
                : {}),
            })
            .where(eq(schema.customers.id, byPhone.id));
        }
        const [loyalty] = await tx
          .select()
          .from(schema.customerLoyalty)
          .where(eq(schema.customerLoyalty.customer_id, byPhone.id))
          .limit(1);
        return { customer: byPhone, loyalty: loyalty || null, isNew: false };
      }
    }

    // 3. No match — create new customer + enroll
    const result = await insertAndEnroll(tx, {
      organizationId,
      name,
      email,
      phone,
      birthDate,
    });
    return { ...result, isNew: true };
  });
}

// ---------------------------------------------------------------------------
// findByEmail — resolve a customer by org + email (for email-code login)
// ---------------------------------------------------------------------------

export async function findByEmail(params: {
  organizationId: string;
  email: string;
}) {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.organization_id, params.organizationId),
        eq(schema.customers.email, params.email),
      ),
    )
    .limit(1);
  return customer ?? null;
}

// ---------------------------------------------------------------------------
// findOrCreateByPhone — used by loyalty.ts for phone-based customer lookup
// ---------------------------------------------------------------------------

export async function findOrCreateByPhone(params: {
  organizationId: string;
  phone: string;
  name: string;
  email?: string;
  birthDate?: string;
  marketingOptIn?: boolean;
}) {
  const { organizationId, phone, name, email, birthDate, marketingOptIn } = params;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organization_id, organizationId),
          eq(schema.customers.phone, phone),
        ),
      )
      .limit(1);

    if (existing) {
      await applyConsent(tx, existing, marketingOptIn);
      // Backfill missing fields
      if ((email && !existing.email) || (birthDate && !existing.birth_date)) {
        await tx
          .update(schema.customers)
          .set({
            ...(email && !existing.email ? { email } : {}),
            ...(birthDate && !existing.birth_date
              ? { birth_date: birthDate }
              : {}),
          })
          .where(eq(schema.customers.id, existing.id));
      }
      const [loyaltyInfo] = await tx
        .select()
        .from(schema.customerLoyalty)
        .where(eq(schema.customerLoyalty.customer_id, existing.id))
        .limit(1);
      return { customer: existing, loyalty: loyaltyInfo || null, isNew: false };
    }

    const result = await insertAndEnroll(tx, {
      organizationId,
      name,
      email,
      phone,
      birthDate,
    });
    return { ...result, isNew: true };
  });
}
