-- Idempotencia de los puntos de fidelización respaldada por la base de datos.
--
-- Hasta ahora la garantía de "un pedido otorga puntos UNA sola vez" vivía solo
-- en un SELECT-y-luego-INSERT dentro de `awardPoints` (apps/api/src/services/
-- loyalty.service.ts). Sin candado ni índice único, dos otorgamientos
-- simultáneos del mismo pedido (p. ej. el cobro que finaliza la orden y el
-- cambio de estado de cocina llegando a la vez) pasaban los dos la guarda y
-- sumaban los puntos por duplicado. Este índice cierra el hueco a nivel de
-- motor: el segundo INSERT revienta con 23505 y el servicio lo traduce a "ya
-- otorgados".
--
-- Es un índice PARCIAL a propósito:
--   * `type = 'earned'` — los movimientos 'redeemed', 'adjusted' (reversiones,
--     reembolsos, cumpleaños) y 'expired' SÍ pueden repetirse por pedido.
--   * `order_id IS NOT NULL` — los ajustes manuales y las expiraciones no
--     llevan pedido y no deben competir entre sí por el índice.

-- 1) Saneado previo de los datos existentes.
--
-- Si ya hubiera dos o más filas 'earned' para un mismo pedido (justo el defecto
-- que este índice corrige), la creación fallaría. NO se borran: los puntos ya
-- están sumados en `customer_loyalty.points_balance` y eliminarlos dejaría el
-- libro mayor descuadrado con el saldo. Se conserva la fila más antigua ligada
-- al pedido y a las demás se les quita el `order_id` (quedan fuera del índice
-- parcial) dejando constancia en la descripción, de modo que la corrección sea
-- auditable y el saldo del cliente no cambie.
--
-- En una base sin duplicados —lo esperable— este UPDATE afecta a 0 filas.
UPDATE "loyalty_transactions" AS lt
SET "order_id" = NULL,
    "description" = COALESCE(lt."description", '') || ' [duplicado desvinculado en la migración 0015]'
WHERE lt."type" = 'earned'
  AND lt."order_id" IS NOT NULL
  AND lt."id" <> (
    SELECT conservada."id"
    FROM "loyalty_transactions" AS conservada
    WHERE conservada."order_id" = lt."order_id"
      AND conservada."type" = 'earned'
    ORDER BY conservada."created_at" ASC, conservada."id" ASC
    LIMIT 1
  );
--> statement-breakpoint

-- 2) El índice único parcial.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_loyalty_tx_order_earned"
  ON "loyalty_transactions" ("order_id")
  WHERE "type" = 'earned' AND "order_id" IS NOT NULL;
