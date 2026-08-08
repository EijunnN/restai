-- Cuántos comensales se sentaron de verdad en la mesa.
--
-- Hasta ahora la sala solo sabía el AFORO de cada mesa (`tables.capacity`), que
-- es un dato de mobiliario: una mesa de seis con dos personas figuraba igual de
-- llena que con seis. Sin este número no se puede responder la pregunta que el
-- gerente hace todos los días —"¿cuánta gente tengo dentro?"— ni calcular la
-- ocupación real frente al aforo del local, y el ticket por persona es
-- inventado.
--
-- Es NULLABLE a propósito. Dos motivos, los dos reales:
--   - Las visitas que ya existen no lo saben y no se puede adivinar; un DEFAULT
--     las llenaría de datos falsos que luego alguien sumaría.
--   - El comensal que entra escaneando el QR nunca declara cuántos son. Solo lo
--     sabe el mozo cuando sienta a la mesa, y es opcional incluso para él: en
--     hora punta nadie va a bloquear el servicio por un campo.
-- La pantalla distingue "no lo sé" de "cero" y no cuenta las visitas sin dato.
--
-- El tope superior es una defensa contra el tecleo, no una regla de negocio:
-- 200 comensales en UNA mesa es un dedo que se quedó pulsado.

ALTER TABLE "table_sessions"
  ADD COLUMN IF NOT EXISTS "guest_count" integer;

DO $$
BEGIN
  ALTER TABLE "table_sessions"
    ADD CONSTRAINT "chk_table_sessions_guest_count"
    CHECK ("guest_count" IS NULL OR ("guest_count" > 0 AND "guest_count" <= 200));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
