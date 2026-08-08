-- El plano de sala deja de ser un diagrama de puntos y pasa a parecerse al local.
--
-- Hasta ahora una mesa en el plano era un rectángulo con un número: todas
-- iguales, sin orientación y flotando sobre un fondo vacío. Con eso el mozo no
-- reconocía su propia sala, que es lo único que hace útil un plano frente a una
-- lista. Faltaban tres cosas y las tres se añaden aquí.
--
-- 1. FORMA. Una mesa redonda de dos y una tabla corrida de ocho no se dibujan
--    igual ni se usan igual. `square` por defecto porque es lo que ya había.
--
-- 2. ROTACIÓN. Las mesas de una terraza rara vez están alineadas al eje. Se
--    guarda en grados enteros [0, 360); el editor mueve de 15 en 15, pero la
--    columna no impone ese paso para no atarse a la interfaz.
--
-- 3. MOBILIARIO. La cocina, la barra, los baños y la entrada no son mesas y no
--    pueden serlo: no se ocupan, no se cobran y no tienen QR. Son referencias
--    fijas, y son justo lo que permite decir "la 12 es la del fondo, junto a la
--    escalera". Viven en su propia tabla, colgando del espacio.

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS "shape" varchar(12) DEFAULT 'square' NOT NULL;

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS "rotation" integer DEFAULT 0 NOT NULL;

DO $$
BEGIN
  ALTER TABLE "tables" ADD CONSTRAINT "chk_tables_shape"
    CHECK ("shape" IN ('round', 'square', 'rect', 'bar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "tables" ADD CONSTRAINT "chk_tables_rotation"
    CHECK ("rotation" >= 0 AND "rotation" < 360);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "space_fixtures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- Qué es. La interfaz elige el icono a partir de esto.
  "kind" varchar(20) NOT NULL,
  -- Rótulo propio, para cuando "Barra 2" dice más que "Barra".
  "label" varchar(60),
  "position_x" integer DEFAULT 0 NOT NULL,
  "position_y" integer DEFAULT 0 NOT NULL,
  "width" integer DEFAULT 120 NOT NULL,
  "height" integer DEFAULT 60 NOT NULL,
  "rotation" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_space_fixtures_kind" CHECK (
    "kind" IN ('kitchen', 'bar', 'stairs', 'restroom', 'entrance', 'wall', 'plant', 'other')
  ),
  -- Tope defensivo: un elemento de 4000 px es un arrastre que se fue de las
  -- manos, no una barra.
  CONSTRAINT "chk_space_fixtures_size" CHECK (
    "width" > 0 AND "width" <= 2000 AND "height" > 0 AND "height" <= 2000
  ),
  CONSTRAINT "chk_space_fixtures_rotation" CHECK ("rotation" >= 0 AND "rotation" < 360)
);

-- El plano se carga por espacio, siempre.
CREATE INDEX IF NOT EXISTS "idx_space_fixtures_space"
  ON "space_fixtures" ("space_id");
