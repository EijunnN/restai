import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { sunatAmbienteEnum } from "./enums";
import { organizations } from "./tenants";

/**
 * Configuración del emisor electrónico ante SUNAT (una por organización).
 * Las credenciales SOL y el certificado se almacenan cifrados (AES-256-GCM)
 * por la capa de aplicación; este esquema solo guarda el texto cifrado.
 */
export const sunatConfig = pgTable("sunat_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),

  // Datos del emisor
  ruc: varchar("ruc", { length: 11 }).notNull(),
  razon_social: varchar("razon_social", { length: 255 }).notNull(),
  nombre_comercial: varchar("nombre_comercial", { length: 255 }),
  ubigeo: varchar("ubigeo", { length: 6 }),
  departamento: varchar("departamento", { length: 100 }),
  provincia: varchar("provincia", { length: 100 }),
  distrito: varchar("distrito", { length: 100 }),
  direccion: text("direccion"),

  // Conexión SUNAT
  ambiente: sunatAmbienteEnum("ambiente").default("beta").notNull(),
  endpoint_override: text("endpoint_override"),

  // Credenciales SOL (cifradas)
  sol_user_enc: text("sol_user_enc"),
  sol_pass_enc: text("sol_pass_enc"),

  // Certificado digital (cifrado). Se acepta PFX (base64) o PEM.
  cert_enc: text("cert_enc"),
  cert_pass_enc: text("cert_pass_enc"),
  /** "pfx" | "pem" — formato del certificado almacenado. */
  cert_format: varchar("cert_format", { length: 10 }).default("pfx"),

  enabled: boolean("enabled").default(false).notNull(),

  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
