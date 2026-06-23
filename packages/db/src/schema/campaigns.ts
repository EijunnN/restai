import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "./tenants";

// A time-boxed earning promotion. When active and matching "now" (date range,
// optional days-of-week and time-of-day window in Lima, optional tier segment),
// awardPoints applies the extra multiplier and/or flat bonus_points.
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: text("status").default("draft").notNull(), // draft | active | paused | ended
    starts_at: timestamp("starts_at", { withTimezone: true }),
    ends_at: timestamp("ends_at", { withTimezone: true }),
    // Array of ints 0-6 (Sun..Sat). Empty array = every day.
    days_of_week: jsonb("days_of_week").default([]).notNull(),
    // Optional time-of-day window in Lima, "HH:MM" 24h. Null = all day.
    start_time: varchar("start_time", { length: 5 }),
    end_time: varchar("end_time", { length: 5 }),
    multiplier: integer("multiplier").default(100).notNull(), // extra multiplier, 100 = 1x (no boost)
    bonus_points: integer("bonus_points").default(0).notNull(),
    // Optional segment: only customers in this tier qualify (null = all members).
    tier_id: uuid("tier_id"), // FK to loyalty_tiers -- via migration (set null)
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_campaigns_org_status").on(t.organization_id, t.status),
  ],
);
