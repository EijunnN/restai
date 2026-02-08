import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { planEnum } from "./enums";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  logo_url: text("logo_url"),
  plan: planEnum("plan").default("free").notNull(),
  is_active: boolean("is_active").default(true).notNull(),
  settings: jsonb("settings").default({}).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    address: text("address"),
    phone: varchar("phone", { length: 20 }),
    timezone: varchar("timezone", { length: 50 }).default("America/Lima").notNull(),
    currency: varchar("currency", { length: 3 }).default("PEN").notNull(),
    tax_rate: integer("tax_rate").default(1800).notNull(), // 18.00%
    is_active: boolean("is_active").default(true).notNull(),
    settings: jsonb("settings").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("branches_org_slug_unique").on(table.organization_id, table.slug),
  ],
);
