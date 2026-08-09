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
  /**
   * Datos fiscales del emisor. Sin RUC no se puede imprimir un ticket válido ni
   * emitir un comprobante electrónico: el CHECK de la migración 0012 valida el
   * formato peruano (10/15/17/20 + 9 dígitos).
   */
  ruc: varchar("ruc", { length: 11 }),
  legal_name: varchar("legal_name", { length: 255 }),
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
    /**
     * Qué hace el QR de esta sede (migración 0018).
     *
     * `dynamic`: el comensal pide entrar, un mozo aprueba y se pide desde la
     * mesa. `static`: la carta se sirve a quien escanee, sin sesión y sin
     * carrito — el QR sustituye a la carta de papel y nada más.
     *
     * No es solo pantalla: en `static` el servidor rechaza abrir sesiones y
     * crear pedidos desde el flujo público. Un enlace guardado en el navegador
     * no puede saltarse el modo.
     */
    menu_mode: varchar("menu_mode", { length: 10 }).default("dynamic").notNull(),
    /**
     * Identificador público y único de la sede (migración 0018).
     *
     * El `slug` NO sirve: es único por organización, así que dos cadenas pueden
     * tener su "miraflores". El flujo con mesa se salva resolviendo por el
     * código de la mesa; una carta de sede no tiene esa ancla y necesita la
     * suya. Mismo alfabeto sin caracteres ambiguos que los códigos de mesa.
     */
    public_code: varchar("public_code", { length: 8 }).notNull(),
    is_active: boolean("is_active").default(true).notNull(),
    settings: jsonb("settings").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("branches_org_slug_unique").on(table.organization_id, table.slug),
    unique("uq_branches_public_code").on(table.public_code),
  ],
);
