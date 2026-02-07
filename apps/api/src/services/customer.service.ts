import { eq, and } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { enrollCustomer } from "./loyalty.service.js";

// ---------------------------------------------------------------------------
// createCustomer
// ---------------------------------------------------------------------------

export async function createCustomer(params: {
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
}) {
  const { organizationId, name, email, phone, birthDate } = params;

  return await db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(schema.customers)
      .values({
        organization_id: organizationId,
        name,
        email,
        phone,
        birth_date: birthDate,
      })
      .returning();

    // Auto-enroll in loyalty program (within same transaction)
    const loyalty = await enrollCustomer({
      customerId: customer.id,
      organizationId,
    }, tx);

    return { customer, loyalty };
  });
}

// ---------------------------------------------------------------------------
// findOrCreateByPhone
// ---------------------------------------------------------------------------

export async function findOrCreateByPhone(params: {
  organizationId: string;
  phone: string;
  name: string;
  email?: string;
  birthDate?: string;
}) {
  const { organizationId, phone, name, email, birthDate } = params;

  // Check if customer exists by phone
  const [existing] = await db
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
    // Get loyalty info
    const [loyaltyInfo] = await db
      .select()
      .from(schema.customerLoyalty)
      .where(eq(schema.customerLoyalty.customer_id, existing.id))
      .limit(1);

    return { customer: existing, loyalty: loyaltyInfo || null, isNew: false };
  }

  // Create new customer + auto-enroll
  const { customer, loyalty } = await createCustomer({
    organizationId,
    name,
    email,
    phone,
    birthDate,
  });

  return { customer, loyalty, isNew: true };
}
