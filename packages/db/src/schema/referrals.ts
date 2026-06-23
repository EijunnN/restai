import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "./tenants";
import { customers } from "./loyalty";

// One row per referral relationship. Created (pending) when a new customer
// registers with a referrer's code; marked completed and rewarded when the
// referee finishes their first order.
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    referrer_customer_id: uuid("referrer_customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    referee_customer_id: uuid("referee_customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 20 }).notNull(),
    status: text("status").default("pending").notNull(), // pending | completed
    referrer_points: integer("referrer_points").default(0).notNull(),
    referee_points: integer("referee_points").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_referrals_org").on(t.organization_id),
    index("idx_referrals_referrer").on(t.referrer_customer_id),
    index("idx_referrals_referee").on(t.referee_customer_id),
  ],
);
