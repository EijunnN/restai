import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { serviceRequestTypeEnum, serviceRequestStatusEnum } from "./enums";
import { organizations, branches } from "./tenants";
import { users } from "./auth";
import { tables, tableSessions } from "./tables";

/**
 * Arqueo de caja.
 *
 * Un cajero abre caja con un fondo, cobra durante su turno y al cerrar declara
 * el efectivo contado. El sistema calcula lo esperado (fondo + cobros en
 * efectivo − anulados) y registra la diferencia. Sin esto no se puede cuadrar
 * el dinero ni atribuir un faltante.
 *
 * Solo puede haber una caja abierta por sede: lo garantiza un índice único
 * parcial en la migración 0012, no el código de aplicación.
 */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branch_id: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    opened_by: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    closed_by: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    /** Fecha civil de Lima (YYYY-MM-DD): el día operativo, no el día UTC. */
    business_date: varchar("business_date", { length: 10 }).notNull(),
    /** Fondo inicial, en céntimos. */
    opening_float: integer("opening_float").default(0).notNull(),
    /** Efectivo contado al cierre, en céntimos. */
    counted_cash: integer("counted_cash"),
    /** Efectivo esperado según los cobros registrados, en céntimos. */
    expected_cash: integer("expected_cash"),
    /** counted_cash − expected_cash. Negativo = faltante. */
    difference: integer("difference"),
    /** 'open' | 'closed' */
    status: varchar("status", { length: 20 }).default("open").notNull(),
    opening_notes: text("opening_notes"),
    closing_notes: text("closing_notes"),
    opened_at: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closed_at: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_cash_sessions_branch_date").on(t.branch_id, t.business_date),
    /**
     * Como máximo una caja abierta por sede.
     *
     * El servicio NO comprueba "¿ya hay una abierta?" antes de insertar: esa
     * comprobación es una carrera con dos cajeros abriendo a la vez. Se inserta
     * y se traduce el 23505 a un 409, así que este índice ES la garantía, no un
     * refuerzo. Sin él se abren dos cajas y el arqueo del turno deja de cuadrar.
     *
     * Debe estar declarado AQUÍ y no solo en el SQL: el flujo de desarrollo usa
     * `drizzle-kit push`, que borra lo que no aparece en el esquema TS.
     */
    uniqueIndex("uq_cash_sessions_open_per_branch")
      .on(t.branch_id)
      .where(sql`${t.status} = 'open'`),
  ],
);

/**
 * Traza inmutable de acciones sensibles.
 *
 * Responde "quién anuló la orden de S/ 380 del viernes", "quién bajó el IGV",
 * "quién cambió el precio del ceviche". `user_email` y `user_role` son
 * snapshots deliberados: la traza debe seguir siendo legible aunque después se
 * borre al usuario.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branch_id: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    user_email: varchar("user_email", { length: 255 }),
    user_role: varchar("user_role", { length: 50 }),
    /** Verbo canónico: "payment.void", "order.cancel", "settings.update"... */
    action: varchar("action", { length: 100 }).notNull(),
    entity_type: varchar("entity_type", { length: 50 }).notNull(),
    entity_id: uuid("entity_id"),
    /** Frase legible para la pantalla de auditoría. */
    summary: text("summary"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 64 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_audit_logs_org_created").on(t.organization_id, t.created_at),
    index("idx_audit_logs_branch_created").on(t.branch_id, t.created_at),
    index("idx_audit_logs_entity").on(t.entity_type, t.entity_id),
    index("idx_audit_logs_action").on(t.organization_id, t.action),
  ],
);

/**
 * Avisos de mesa: "llamar al mozo" y "pedir la cuenta".
 *
 * Antes esto era solo un `realtime.publish`: si nadie tenía la pantalla abierta
 * en ese instante, el aviso no había existido nunca. Persistirlo permite una
 * bandeja de pendientes, medir el tiempo de respuesta y sobrevivir a un
 * refresco o a un cambio de turno.
 *
 * El antispam también vive aquí: un índice único parcial impide más de un aviso
 * pendiente por mesa y tipo, sin depender de un Map en memoria del proceso.
 */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branch_id: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    table_id: uuid("table_id").references(() => tables.id, { onDelete: "set null" }),
    table_session_id: uuid("table_session_id").references(() => tableSessions.id, {
      onDelete: "set null",
    }),
    type: serviceRequestTypeEnum("type").notNull(),
    status: serviceRequestStatusEnum("status").default("pending").notNull(),
    note: text("note"),
    acknowledged_by: uuid("acknowledged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acknowledged_at: timestamp("acknowledged_at", { withTimezone: true }),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_service_requests_branch_status").on(t.branch_id, t.status, t.created_at),
    index("idx_service_requests_table").on(t.table_id, t.status),
    /**
     * Un solo aviso pendiente por mesa y tipo.
     *
     * Es el antispam: el servicio inserta y captura el 23505 en vez de mirar
     * antes si ya existe, porque entre mirar e insertar caben los diez toques
     * seguidos de un comensal impaciente. Sin este índice, esa ráfaga crea diez
     * avisos y la bandeja del mozo deja de ser legible.
     *
     * Debe estar declarado AQUÍ y no solo en el SQL: el flujo de desarrollo usa
     * `drizzle-kit push`, que borra lo que no aparece en el esquema TS.
     */
    uniqueIndex("uq_service_requests_open_per_table_type")
      .on(t.table_id, t.type)
      .where(sql`${t.status} = 'pending'`),
  ],
);
