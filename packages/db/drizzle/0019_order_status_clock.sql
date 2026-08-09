-- Una orden sabe cuándo nació, pero no desde cuándo lleva esperando.
--
-- La pantalla de órdenes trata igual una orden de hace tres minutos y una
-- cerrada hace dos horas, y eso no es un problema de estilo: el fallo más caro
-- de un servicio es un plato LISTO que lleva doce minutos en el pase. Nadie lo
-- ve porque la única marca de tiempo que existe es `created_at`, y una orden que
-- entró a las 20:14 lleva "26 minutos" tanto si la cocina la acaba de terminar
-- como si lleva media hora enfriándose.
--
-- `status_changed_at` responde a la única pregunta que ordena el trabajo del
-- salón: ¿cuánto lleva ESTO parado donde está? Con ella se puede separar
-- "necesita atención" de "va en marcha" sin inventarse nada.
--
-- Por qué una sola columna y no una marca por estado (`ready_at`, `served_at`…):
-- para lo que decide el servicio hace falta el tiempo en el estado ACTUAL, y
-- seis columnas nullables obligan a un COALESCE encadenado en cada consulta y a
-- recordar rellenar la correcta en cada transición. El historial detallado de
-- transiciones ya existe donde debe: en la auditoría.
--
-- El relleno usa `updated_at` y no `now()`: las órdenes que ya están cerradas no
-- pueden aparecer de golpe como si acabaran de cambiar de estado, o la pantalla
-- estrenaría el rediseño con veinte falsas urgencias. `updated_at` es lo más
-- cercano a la verdad que hay guardado.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone;

UPDATE "orders"
SET "status_changed_at" = COALESCE("updated_at", "created_at")
WHERE "status_changed_at" IS NULL;

ALTER TABLE "orders"
  ALTER COLUMN "status_changed_at" SET DEFAULT now();

ALTER TABLE "orders"
  ALTER COLUMN "status_changed_at" SET NOT NULL;

-- La lista del servicio pide "lo que no está cerrado, de esta sede, y lo más
-- parado primero". Sin este índice son recorridos completos de una tabla que
-- crece con cada comanda del año.
CREATE INDEX IF NOT EXISTS "idx_orders_branch_status_changed"
  ON "orders" ("branch_id", "status_changed_at");
