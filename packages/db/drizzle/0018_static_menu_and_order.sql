-- Dos cosas que el local decide y hasta ahora no podía: si su carta se pide o
-- solo se lee, y en qué orden se ve.
--
-- ---------------------------------------------------------------------------
-- 1. MODO DE CARTA
--
-- Hoy el sistema asume que todo local que pone un QR quiere pedidos desde la
-- mesa: el comensal escanea, pide entrar, un mozo aprueba, y solo entonces ve
-- la carta. Para la mayoría de restaurantes eso es exactamente lo que quieren.
-- Para muchos otros —una cevichería con dos mesas, una cafetería, un local que
-- solo quiere dejar de reimprimir cartas de papel— es una barrera: el comensal
-- quería LEER, y se le pide permiso a un mozo que está ocupado.
--
-- `static` sirve la carta a quien escanee, sin sesión, sin espera y sin
-- carrito. `dynamic` es lo de siempre. Se cambia en caliente y sin reimprimir
-- nada: el mismo QR de la mesa vale para los dos modos.
--
-- No va dentro de `settings` (jsonb) a propósito. Es una regla que el servidor
-- aplica en la ruta pública, en cada pedido, y que necesita CHECK y un valor
-- por defecto explícito. Un ajuste que decide si se puede cobrar no puede vivir
-- en una bolsa sin esquema.
--
-- ---------------------------------------------------------------------------
-- 2. CÓDIGO PÚBLICO DE SEDE
--
-- El slug de sede NO es único globalmente: la restricción es
-- (organization_id, slug), así que dos cadenas distintas pueden tener su
-- "miraflores". El flujo público de hoy se salva porque resuelve por el código
-- de la mesa, que sí es único, y usa el slug solo para confirmar.
--
-- Una carta de sede —sin mesa— no tiene esa ancla. Sin un identificador único
-- propio, `/miraflores/carta` serviría la carta de otro restaurante el día que
-- alguien registre el mismo nombre. Este código es esa ancla: corto, dictable,
-- y con el mismo alfabeto sin caracteres ambiguos que los códigos de mesa.
--
-- ---------------------------------------------------------------------------
-- 3. ORDEN DE MODIFICADORES
--
-- `sort_order` existía en categorías y platos, pero no en las opciones ni en la
-- relación plato–grupo. Resultado: "Sin ají, Suave, Picante, Bien picante" salía
-- en el orden que quisiera Postgres, que para una escala es peor que inútil.
-- El orden de los grupos va en la tabla puente y no en el grupo, porque un mismo
-- grupo se comparte entre platos y no tiene por qué ir en el mismo sitio en
-- todos: en un lomo, el término va primero; en una parrillada, la guarnición.

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "menu_mode" varchar(10) DEFAULT 'dynamic' NOT NULL;

DO $$
BEGIN
  ALTER TABLE "branches" ADD CONSTRAINT "chk_branches_menu_mode"
    CHECK ("menu_mode" IN ('dynamic', 'static'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "public_code" varchar(8);

-- Relleno para las sedes que ya existen. Se hace fila a fila y reintentando
-- porque el código es aleatorio: dos sedes podrían sacar el mismo, y aquí eso
-- sería servir la carta equivocada.
DO $$
DECLARE
  fila RECORD;
  candidato text;
  intentos int;
BEGIN
  FOR fila IN SELECT "id" FROM "branches" WHERE "public_code" IS NULL LOOP
    intentos := 0;
    LOOP
      SELECT string_agg(
               substr('23456789ABCDEFGHJKMNPQRSTVWXYZ', (floor(random() * 30) + 1)::int, 1),
               ''
             )
        INTO candidato
        FROM generate_series(1, 6);

      EXIT WHEN NOT EXISTS (SELECT 1 FROM "branches" WHERE "public_code" = candidato);

      intentos := intentos + 1;
      IF intentos > 50 THEN
        RAISE EXCEPTION 'No se pudo generar un código público único para la sede %', fila."id";
      END IF;
    END LOOP;

    UPDATE "branches" SET "public_code" = candidato WHERE "id" = fila."id";
  END LOOP;
END $$;

ALTER TABLE "branches" ALTER COLUMN "public_code" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "branches" ADD CONSTRAINT "uq_branches_public_code" UNIQUE ("public_code");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "modifiers"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;

ALTER TABLE "menu_item_modifier_groups"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;

-- A las opciones que ya existen se les da una posición ESTABLE, no la correcta:
-- no hay forma de recuperar el orden en que se crearon —`modifiers` no guarda
-- fecha y el uuid es aleatorio— así que se numeran por id. Deja de bailar entre
-- recargas, que es lo que se puede arreglar aquí; ponerlas en el orden que el
-- dueño quiere es cosa suya, arrastrando. Una escala de picante mal ordenada ya
-- estaba mal ordenada antes de esta migración.
WITH numeradas AS (
  SELECT "id", row_number() OVER (PARTITION BY "group_id" ORDER BY "id") - 1 AS pos
  FROM "modifiers"
)
UPDATE "modifiers" m
SET "sort_order" = numeradas.pos
FROM numeradas
WHERE m."id" = numeradas."id" AND m."sort_order" = 0;

-- La carta pública se lee por sede en cada escaneo: sin este índice, el modo
-- estático hace un recorrido completo de la tabla por cada comensal.
CREATE INDEX IF NOT EXISTS "idx_modifiers_group_order"
  ON "modifiers" ("group_id", "sort_order");
