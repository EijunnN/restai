/**
 * Catálogos oficiales de SUNAT usados en la facturación electrónica (UBL 2.1).
 * Referencia: Anexos del Manual del Programador / Catálogos SUNAT.
 */

/** Catálogo 01 — Tipo de comprobante */
export const TIPO_COMPROBANTE = {
  FACTURA: "01",
  BOLETA: "03",
  NOTA_CREDITO: "07",
  NOTA_DEBITO: "08",
  RESUMEN_DIARIO: "RC",
  COMUNICACION_BAJA: "RA",
} as const;

/** Catálogo 06 — Tipo de documento de identidad del adquiriente */
export const TIPO_DOCUMENTO_IDENTIDAD = {
  SIN_DOCUMENTO: "0",
  DNI: "1",
  CARNET_EXTRANJERIA: "4",
  RUC: "6",
  PASAPORTE: "7",
} as const;

/** Catálogo 07 — Tipo de afectación del IGV */
export const TIPO_AFECTACION_IGV = {
  GRAVADO: "10", // Gravado - Operación onerosa
  EXONERADO: "20",
  INAFECTO: "30",
  GRATUITO: "11",
} as const;

/** Catálogo 05 — Tributos */
export const TRIBUTO = {
  IGV: { id: "1000", nombre: "IGV", codigo: "VAT" },
  EXONERADO: { id: "9997", nombre: "EXO", codigo: "VAT" },
  INAFECTO: { id: "9998", nombre: "INA", codigo: "FRE" },
  GRATUITO: { id: "9996", nombre: "GRA", codigo: "FRE" },
} as const;

/** Catálogo 09 — Tipo de nota de crédito */
export const TIPO_NOTA_CREDITO = {
  ANULACION_OPERACION: "01",
  ANULACION_ERROR_RUC: "02",
  CORRECCION_DESCRIPCION: "03",
  DESCUENTO_GLOBAL: "04",
  DESCUENTO_ITEM: "05",
  DEVOLUCION_TOTAL: "06",
  DEVOLUCION_ITEM: "07",
  BONIFICACION: "08",
  DISMINUCION_VALOR: "09",
} as const;

/** Catálogo 10 — Tipo de nota de débito */
export const TIPO_NOTA_DEBITO = {
  INTERESES_MORA: "01",
  AUMENTO_VALOR: "02",
  PENALIDADES: "03",
} as const;

/** Catálogo 16 — Tipo de precio de venta unitario */
export const TIPO_PRECIO = {
  PRECIO_UNITARIO: "01", // Precio unitario (incluye IGV)
  VALOR_REFERENCIAL_GRATUITO: "02",
} as const;

/** Catálogo 03 — Unidad de medida (Internacional). Default para items de restaurante. */
export const UNIDAD_MEDIDA = {
  UNIDAD: "NIU", // Productos
  SERVICIO: "ZZ",
} as const;

/** Moneda ISO 4217 */
export const MONEDA = {
  SOLES: "PEN",
  DOLARES: "USD",
} as const;

/** Tasa del IGV vigente (18%). */
export const IGV_TASA = 0.18;

/** Mapea el doc_type interno (dni/ruc/ce) al catálogo 06 de SUNAT. */
export function mapDocType(
  internal: "dni" | "ruc" | "ce" | string,
): string {
  switch (internal) {
    case "dni":
      return TIPO_DOCUMENTO_IDENTIDAD.DNI;
    case "ruc":
      return TIPO_DOCUMENTO_IDENTIDAD.RUC;
    case "ce":
      return TIPO_DOCUMENTO_IDENTIDAD.CARNET_EXTRANJERIA;
    default:
      return TIPO_DOCUMENTO_IDENTIDAD.SIN_DOCUMENTO;
  }
}

/** Mapea el tipo interno de comprobante (boleta/factura) al catálogo 01. */
export function mapTipoComprobante(
  internal: "boleta" | "factura" | string,
): string {
  return internal === "factura"
    ? TIPO_COMPROBANTE.FACTURA
    : TIPO_COMPROBANTE.BOLETA;
}
