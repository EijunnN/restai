-- 0013_ruc_prefix_16
--
-- Alinea el CHECK del RUC del emisor con el resto del sistema.
--
-- La migración 0012 aceptaba los prefijos 10/15/17/20, pero el validador de
-- facturación y `PUT /api/sunat/config` aceptan además el **16** (contribuyentes
-- no domiciliados). El desajuste dejaba a un emisor con RUC 16 configurar SUNAT
-- y luego fallar al guardar sus propios datos fiscales, con un error de base de
-- datos en vez de un mensaje entendible.

ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "chk_organizations_ruc";
ALTER TABLE "organizations" ADD CONSTRAINT "chk_organizations_ruc"
  CHECK ("ruc" IS NULL OR "ruc" ~ '^(10|15|16|17|20)[0-9]{9}$');
