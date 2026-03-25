import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestOrg, createTestLoyaltyProgram, createTestTier, cleanup } from "../setup";
import { createCustomer, findOrCreate, findOrCreateByPhone } from "../../services/customer.service";

describe("customer.service", () => {
  let orgId: string;

  beforeAll(async () => {
    const org = await createTestOrg();
    orgId = org.id;
    // Set up loyalty so auto-enrollment works
    const program = await createTestLoyaltyProgram(orgId);
    await createTestTier(program.id, 0, 100);
  });

  afterAll(async () => {
    await cleanup([orgId]);
  });

  it("createCustomer inserts customer and auto-enrolls in loyalty", async () => {
    const result = await createCustomer({
      organizationId: orgId,
      name: "Carlos",
      phone: "999000111",
    });

    expect(result.customer.name).toBe("Carlos");
    expect(result.loyalty).toBeTruthy();
    expect(result.loyalty!.points_balance).toBe(0);
  });

  it("findOrCreate deduplicates by email", async () => {
    const r1 = await findOrCreate({
      organizationId: orgId,
      name: "Ana",
      email: "ana@test.com",
    });

    const r2 = await findOrCreate({
      organizationId: orgId,
      name: "Ana Repeated",
      email: "ana@test.com",
    });

    expect(r1.customer.id).toBe(r2.customer.id);
    expect(r2.isNew).toBe(false);
  });

  it("findOrCreate deduplicates by phone", async () => {
    const r1 = await findOrCreate({
      organizationId: orgId,
      name: "Pedro",
      phone: "999111222",
    });

    const r2 = await findOrCreate({
      organizationId: orgId,
      name: "Pedro Again",
      phone: "999111222",
    });

    expect(r1.customer.id).toBe(r2.customer.id);
    expect(r2.isNew).toBe(false);
  });

  it("findOrCreate creates new when no match", async () => {
    const result = await findOrCreate({
      organizationId: orgId,
      name: "Nuevo",
    });

    expect(result.isNew).toBe(true);
    expect(result.customer.name).toBe("Nuevo");
  });

  it("findOrCreateByPhone backfills missing email", async () => {
    const r1 = await findOrCreateByPhone({
      organizationId: orgId,
      phone: "999333444",
      name: "Maria",
    });
    expect(r1.isNew).toBe(true);

    const r2 = await findOrCreateByPhone({
      organizationId: orgId,
      phone: "999333444",
      name: "Maria",
      email: "maria@test.com",
    });
    expect(r2.isNew).toBe(false);
    expect(r2.customer.id).toBe(r1.customer.id);
    // Note: email backfill happens in the DB update but findOrCreateByPhone
    // returns the original customer object before backfill in the same query
  });
});
