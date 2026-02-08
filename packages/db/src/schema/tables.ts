import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { tableStatusEnum, sessionStatusEnum } from "./enums";
import { organizations, branches } from "./tenants";
import { users } from "./auth";

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branch_id: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    floor_number: integer("floor_number").default(1).notNull(),
    is_active: boolean("is_active").default(true).notNull(),
    sort_order: integer("sort_order").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("spaces_branch_name_unique").on(table.branch_id, table.name),
  ],
);

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branch_id: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    number: integer("number").notNull(),
    capacity: integer("capacity").default(4).notNull(),
    qr_code: varchar("qr_code", { length: 100 }).unique().notNull(),
    status: tableStatusEnum("status").default("available").notNull(),
    position_x: integer("position_x").default(0).notNull(),
    position_y: integer("position_y").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tables_branch_number_unique").on(table.branch_id, table.number),
  ],
);

export const tableAssignments = pgTable("table_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  table_id: uuid("table_id")
    .notNull()
    .references(() => tables.id, { onDelete: "cascade" }),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tableSessions = pgTable("table_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  table_id: uuid("table_id")
    .notNull()
    .references(() => tables.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  customer_name: varchar("customer_name", { length: 255 }).notNull(),
  customer_phone: varchar("customer_phone", { length: 20 }),
  token: text("token").notNull(),
  status: sessionStatusEnum("status").default("active").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
});
