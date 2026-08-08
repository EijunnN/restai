import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    /**
     * Código corto dictable por teléfono (alfabeto sin caracteres ambiguos).
     * Es el plan B cuando el comensal no puede escanear el QR: sin cámara, sin
     * datos, sticker despegado. Único por sede, no globalmente.
     */
    short_code: varchar("short_code", { length: 8 }).notNull(),
    status: tableStatusEnum("status").default("available").notNull(),
    position_x: integer("position_x").default(0).notNull(),
    position_y: integer("position_y").default(0).notNull(),
    /**
     * Forma en el plano: `round` | `square` | `rect` | `bar` (migración 0017).
     *
     * No es decoración: una redonda de dos y una tabla corrida de ocho se
     * dibujan y se usan distinto, y el mozo reconoce su sala por la silueta
     * antes que por el número.
     */
    shape: varchar("shape", { length: 12 }).default("square").notNull(),
    /** Giro en el plano, en grados [0, 360). Las terrazas rara vez se alinean. */
    rotation: integer("rotation").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tables_branch_number_unique").on(table.branch_id, table.number),
    unique("uq_tables_branch_short_code").on(table.branch_id, table.short_code),
  ],
);

/**
 * Mobiliario fijo del plano: cocina, barra, escalera, baños, entrada.
 *
 * No son mesas y no pueden serlo: no se ocupan, no se cobran, no tienen QR ni
 * aforo. Son las referencias que convierten un diagrama de rectángulos en una
 * sala reconocible, y las que permiten decir "la 12 es la del fondo, junto a la
 * escalera". Cuelgan del espacio: si se borra el ambiente, se van con él.
 */
export const spaceFixtures = pgTable(
  "space_fixtures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    space_id: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    branch_id: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Qué es. La interfaz elige el icono a partir de esto. */
    kind: varchar("kind", { length: 20 }).notNull(),
    /** Rótulo propio, para cuando "Barra 2" dice más que "Barra". */
    label: varchar("label", { length: 60 }),
    position_x: integer("position_x").default(0).notNull(),
    position_y: integer("position_y").default(0).notNull(),
    width: integer("width").default(120).notNull(),
    height: integer("height").default(60).notNull(),
    rotation: integer("rotation").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_space_fixtures_space").on(table.space_id)],
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
}, (table) => [
  unique("uq_table_assignments_table_user").on(table.table_id, table.user_id),
]);

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
  /**
   * Comensales sentados (migración 0016). NULO = no se declaró.
   *
   * `tables.capacity` es aforo de mobiliario; esto es gente real. La distinción
   * importa: una mesa de seis con dos personas no está llena, y el ticket por
   * persona sale mal si se divide entre las sillas. El comensal que entra por
   * QR nunca lo declara, así que el nulo es el caso normal y la pantalla no
   * puede tratarlo como cero.
   */
  guest_count: integer("guest_count"),
  token: text("token").notNull(),
  status: sessionStatusEnum("status").default("active").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  index("idx_sessions_table_status").on(table.table_id, table.status),
  index("idx_sessions_branch").on(table.branch_id),
  /**
   * Una sola visita ACTIVA por mesa (migración 0014).
   *
   * Con dos visitas activas sobre la misma mesa, el saldo que pinta el diálogo
   * de cobro y el que calcula el guard de "Liberar" se computan sobre conjuntos
   * distintos, y el mozo ve un 409 que contradice a su pantalla.
   *
   * Debe estar declarado AQUÍ y no solo en el SQL: el flujo de desarrollo usa
   * `drizzle-kit push`, que borra lo que no aparece en el esquema TS.
   */
  uniqueIndex("uq_table_sessions_one_active")
    .on(table.table_id)
    .where(sql`${table.status} = 'active'`),
]);
