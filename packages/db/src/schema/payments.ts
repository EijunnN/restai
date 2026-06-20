import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import {
  paymentMethodEnum,
  paymentStatusEnum,
  invoiceTypeEnum,
  docTypeEnum,
  sunatStatusEnum,
} from "./enums";
import { organizations, branches } from "./tenants";
import { orders } from "./orders";

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  order_id: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  method: paymentMethodEnum("method").notNull(),
  amount: integer("amount").notNull(), // in cents
  reference: varchar("reference", { length: 255 }),
  tip: integer("tip").default(0).notNull(), // in cents
  status: paymentStatusEnum("status").default("pending").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_payments_order").on(table.order_id),
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  order_id: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branch_id: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  type: invoiceTypeEnum("type").notNull(),
  series: varchar("series", { length: 10 }).notNull(),
  number: integer("number").notNull(),
  customer_name: varchar("customer_name", { length: 255 }).notNull(),
  customer_doc_type: docTypeEnum("customer_doc_type").notNull(),
  customer_doc_number: varchar("customer_doc_number", { length: 20 }).notNull(),
  subtotal: integer("subtotal").notNull(), // in cents
  igv: integer("igv").notNull(), // in cents
  total: integer("total").notNull(), // in cents

  // ── Integración SUNAT ──────────────────────────────────────────────
  sunat_status: sunatStatusEnum("sunat_status").default("pending").notNull(),
  sunat_response: jsonb("sunat_response"),
  /** Ticket devuelto en envíos asíncronos (resumen diario / baja). */
  sunat_ticket: varchar("sunat_ticket", { length: 50 }),
  /** DigestValue (hash) del XML firmado. */
  sunat_hash: varchar("sunat_hash", { length: 100 }),
  /** Código de respuesta de SUNAT (0 = aceptado). */
  sunat_code: varchar("sunat_code", { length: 10 }),
  /** Descripción legible de la respuesta de SUNAT. */
  sunat_description: text("sunat_description"),
  /** XML firmado (UBL). */
  xml_signed: text("xml_signed"),
  /** XML del CDR (Constancia de Recepción). */
  cdr_xml: text("cdr_xml"),
  sent_at: timestamp("sent_at", { withTimezone: true }),

  // ── Notas de crédito / débito ──────────────────────────────────────
  /** Comprobante afectado (para notas de crédito/débito). */
  reference_invoice_id: uuid("reference_invoice_id"),
  /** Código de motivo (catálogo 09 NC / 10 ND). */
  note_motive_code: varchar("note_motive_code", { length: 5 }),
  note_motive_description: text("note_motive_description"),

  pdf_url: text("pdf_url"),
  xml_url: text("xml_url"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_invoices_branch_series_number").on(table.branch_id, table.series, table.number),
  index("idx_invoices_branch_series").on(table.branch_id, table.series),
  index("idx_invoices_sunat_status").on(table.branch_id, table.sunat_status),
]);
