-- 0014_one_active_session_per_table
--
-- Una mesa, una cuenta.
--
-- Hasta ahora nada impedía que la misma mesa tuviera DOS visitas activas a la
-- vez (el mozo canta un pedido en la mesa 5 mientras el comensal espera que le
-- aprueben su ingreso: el pedido abre una visita y la aprobación abre otra). A
-- partir de ahí el dinero se parte en dos conjuntos distintos: el diálogo de
-- cobro pinta el de una visita y el guard de «Liberar» suma el de todas, así
-- que el mozo ve "no debe nada" en pantalla y un 409 al liberar.
--
-- El código ya toma el candado de la fila de `tables` en los cuatro caminos que
-- pueden abrir una visita activa (alta del comensal, sentar walk-in, pedido de
-- staff y aprobación de ingreso), de modo que este índice no debería saltar
-- nunca: es la red que garantiza el invariante aunque aparezca un quinto camino.
--
-- Escrita a mano (NO generada con drizzle-kit): los snapshots de drizzle están
-- congelados en 0003 y `generate` recrearía tablas existentes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reparación de datos: fusionar las visitas activas duplicadas
-- ─────────────────────────────────────────────────────────────────────────────
-- Sobrevive la MÁS ANTIGUA de cada mesa (es la visita real; las demás son el
-- duplicado accidental). Sus pedidos se reasignan a la superviviente, con lo que
-- no se pierde ni un céntimo: la cuenta queda completa en una sola visita, que
-- es exactamente lo que hace "juntar cuentas". Las duplicadas se cierran.

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY table_id
      ORDER BY started_at ASC, id ASC
    ) AS survivor_id
  FROM table_sessions
  WHERE status = 'active'
)
UPDATE orders o
SET table_session_id = r.survivor_id,
    updated_at = now()
FROM ranked r
WHERE o.table_session_id = r.id
  AND r.id <> r.survivor_id;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY table_id
      ORDER BY started_at ASC, id ASC
    ) AS survivor_id
  FROM table_sessions
  WHERE status = 'active'
)
UPDATE table_sessions ts
SET status = 'completed',
    ended_at = now()
FROM ranked r
WHERE ts.id = r.id
  AND r.id <> r.survivor_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El invariante, en la base de datos
-- ─────────────────────────────────────────────────────────────────────────────
-- Parcial a propósito: las visitas cerradas (completed/rejected) son histórico y
-- se acumulan sin límite por mesa. Las `pending` tampoco entran: una solicitud
-- de ingreso caducada puede convivir con la visita en curso hasta que el
-- expirador la barra, y bloquear ese caso rompería la entrada por QR.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_table_sessions_one_active"
  ON "table_sessions" ("table_id")
  WHERE "status" = 'active';
