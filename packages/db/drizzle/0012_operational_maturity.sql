-- 0012_operational_maturity
--
-- Cimientos que faltaban para operar un restaurante real y auditarlo:
--   1. Código corto de mesa  -> plan B cuando el comensal no puede escanear el QR
--   2. Autoría en ventas     -> quién tomó el pedido y quién cobró
--   3. Anulación de cobros    -> revertir un tecleo errado sin tocar la base
--   4. Anulación de ítems     -> el "86" de cocina cuando se acaba un plato
--   5. Arqueo de caja         -> abrir/cerrar caja y cuadrar el efectivo
--   6. Auditoría              -> traza inmutable de las acciones sensibles
--   7. Avisos de mesa         -> "llamar al mozo" / "la cuenta" persistentes
--   8. Alérgenos              -> información dietética en la carta
--   9. Datos fiscales emisor  -> RUC y razón social para el comprobante
--
-- Escrita a mano (NO generada con drizzle-kit): los snapshots de drizzle están
-- congelados en 0003 y `generate` recrearía tablas existentes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Código corto de mesa (fallback sin QR)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "short_code" varchar(8);

-- Backfill: 5 caracteres del alfabeto Crockford reducido (sin I, L, O, U, 0, 1)
-- para que se pueda dictar por teléfono sin ambigüedad. Reintenta ante colisión.
DO $$
DECLARE
  r RECORD;
  candidate text;
  alphabet text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  i int;
  attempts int;
BEGIN
  FOR r IN SELECT id, branch_id FROM "tables" WHERE short_code IS NULL LOOP
    attempts := 0;
    LOOP
      candidate := '';
      FOR i IN 1..5 LOOP
        candidate := candidate || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "tables" t
        WHERE t.branch_id = r.branch_id AND t.short_code = candidate
      );
      attempts := attempts + 1;
      IF attempts > 50 THEN
        RAISE EXCEPTION 'No se pudo generar short_code único para la mesa %', r.id;
      END IF;
    END LOOP;
    UPDATE "tables" SET short_code = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "tables" ALTER COLUMN "short_code" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tables_branch_short_code"
  ON "tables" ("branch_id", "short_code");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Autoría de la venta
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_orders_created_by";
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_created_by"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_orders_created_by" ON "orders" ("created_by");

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "fk_payments_user";
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_user"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_payments_user" ON "payments" ("user_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Anulación de cobros
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_at" timestamptz;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_by" uuid;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "void_reason" text;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "fk_payments_voided_by";
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_voided_by"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Un pago anulado debe llevar siempre sello de tiempo y motivo.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "chk_payments_void_complete";
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_void_complete"
  CHECK (
    ("voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Anulación de ítems de pedido ("86" de cocina)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid;
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "fk_order_items_cancelled_by";
ALTER TABLE "order_items" ADD CONSTRAINT "fk_order_items_cancelled_by"
  FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Arqueo de caja
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "opened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- Fecha civil de Lima (YYYY-MM-DD): el día operativo del local, no el día UTC.
  "business_date" varchar(10) NOT NULL,
  "opening_float" integer NOT NULL DEFAULT 0,
  "counted_cash" integer,
  "expected_cash" integer,
  "difference" integer,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "opening_notes" text,
  "closing_notes" text,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  CONSTRAINT "chk_cash_sessions_status" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "chk_cash_sessions_float" CHECK ("opening_float" >= 0)
);

-- Como máximo una caja abierta por sede: el índice parcial lo garantiza en la BD,
-- no en el código.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cash_sessions_open_per_branch"
  ON "cash_sessions" ("branch_id") WHERE "status" = 'open';

CREATE INDEX IF NOT EXISTS "idx_cash_sessions_branch_date"
  ON "cash_sessions" ("branch_id", "business_date");

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cash_session_id" uuid;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "fk_payments_cash_session";
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_cash_session"
  FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_payments_cash_session" ON "payments" ("cash_session_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Auditoría
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- Snapshots: la traza debe seguir siendo legible aunque el usuario se borre.
  "user_email" varchar(255),
  "user_role" varchar(50),
  "action" varchar(100) NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" uuid,
  "summary" text,
  "before" jsonb,
  "after" jsonb,
  "ip" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_audit_logs_org_created"
  ON "audit_logs" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_branch_created"
  ON "audit_logs" ("branch_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity"
  ON "audit_logs" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action"
  ON "audit_logs" ("organization_id", "action");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Avisos de mesa (llamar al mozo / pedir la cuenta)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "service_request_type" AS ENUM ('call_waiter', 'request_bill');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "service_request_status" AS ENUM ('pending', 'acknowledged', 'resolved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "service_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "table_id" uuid REFERENCES "tables"("id") ON DELETE SET NULL,
  "table_session_id" uuid REFERENCES "table_sessions"("id") ON DELETE SET NULL,
  "type" "service_request_type" NOT NULL,
  "status" "service_request_status" NOT NULL DEFAULT 'pending',
  "note" text,
  "acknowledged_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamptz,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_service_requests_branch_status"
  ON "service_requests" ("branch_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_service_requests_table"
  ON "service_requests" ("table_id", "status");

-- Un solo aviso pendiente por mesa y tipo: evita que el comensal genere 20
-- llamadas pulsando repetidamente, sin necesidad de estado en memoria.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_requests_open_per_table_type"
  ON "service_requests" ("table_id", "type") WHERE "status" = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Alérgenos e información dietética
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "allergens" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "dietary_tags" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "spice_level" integer;
ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "chk_menu_items_spice_level";
ALTER TABLE "menu_items" ADD CONSTRAINT "chk_menu_items_spice_level"
  CHECK ("spice_level" IS NULL OR ("spice_level" >= 0 AND "spice_level" <= 3));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Datos fiscales del emisor
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ruc" varchar(11);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "legal_name" varchar(255);
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "chk_organizations_ruc";
ALTER TABLE "organizations" ADD CONSTRAINT "chk_organizations_ruc"
  CHECK ("ruc" IS NULL OR "ruc" ~ '^(10|15|17|20)[0-9]{9}$');
