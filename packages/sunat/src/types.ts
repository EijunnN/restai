/**
 * Tipos de dominio para la facturación electrónica SUNAT.
 * Todos los montos se expresan en unidades monetarias (soles), NO en céntimos.
 * El mapeo desde céntimos (la base de datos) se hace en el servicio de la API.
 */

export type Ambiente = "beta" | "production";

/** Datos del emisor (empresa que factura). */
export interface Emisor {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string;
  /** Código de ubigeo de 6 dígitos (INEI). */
  ubigeo?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  urbanizacion?: string;
  direccion?: string;
  /** Código de país ISO (PE). */
  codigoPais?: string;
}

/** Datos del adquiriente (cliente). */
export interface Cliente {
  tipoDoc: string; // catálogo 06
  numDoc: string;
  razonSocial: string;
  direccion?: string;
}

/** Una línea (item) del comprobante. */
export interface DetalleItem {
  /** Cantidad. */
  cantidad: number;
  /** Unidad de medida (catálogo 03). */
  unidad: string;
  /** Descripción del producto/servicio. */
  descripcion: string;
  /** Código interno del producto (opcional). */
  codigo?: string;
  /** Valor unitario SIN IGV. */
  valorUnitario: number;
  /** Precio unitario CON IGV (catálogo 16 = 01). */
  precioUnitario: number;
  /** Valor de venta de la línea (cantidad * valorUnitario). */
  valorVenta: number;
  /** Monto del IGV de la línea. */
  igv: number;
  /** Porcentaje del IGV aplicado (ej. 18). */
  porcentajeIgv: number;
  /** Código de afectación del IGV (catálogo 07). */
  tipoAfectacionIgv: string;
}

/** Totales del comprobante. */
export interface Totales {
  /** Total de operaciones gravadas (valor de venta sin IGV). */
  gravadas: number;
  /** Total de operaciones exoneradas. */
  exoneradas?: number;
  /** Total de operaciones inafectas. */
  inafectas?: number;
  /** Total del IGV. */
  igv: number;
  /** Importe total del comprobante (con IGV). */
  importeTotal: number;
}

/** Documento de referencia (para notas de crédito/débito). */
export interface DocumentoReferencia {
  tipoDoc: string; // catálogo 01
  serieNumero: string; // ej. F001-123
}

/** Comprobante (factura o boleta). */
export interface Comprobante {
  tipoOperacion?: string; // catálogo 51, default 0101 (venta interna)
  tipoComprobante: string; // catálogo 01
  serie: string;
  correlativo: string;
  /** Fecha de emisión en formato YYYY-MM-DD. */
  fechaEmision: string;
  /** Hora de emisión en formato HH:MM:SS. */
  horaEmision?: string;
  moneda: string;
  emisor: Emisor;
  cliente: Cliente;
  detalles: DetalleItem[];
  totales: Totales;
  /** Leyendas (catálogo 52), ej. monto en letras. */
  leyendas?: { codigo: string; valor: string }[];
}

/** Nota de crédito o débito. */
export interface Nota extends Comprobante {
  /** Código del motivo (catálogo 09 para NC, catálogo 10 para ND). */
  codigoMotivo: string;
  descripcionMotivo: string;
  documentoAfectado: DocumentoReferencia;
}

/** Un comprobante a incluir en un resumen diario de boletas. */
export interface ResumenDiarioItem {
  tipoComprobante: string; // 03 boleta, 07 NC, 08 ND
  serie: string;
  correlativo: string;
  /** 1 = Adicionar, 2 = Modificar, 3 = Anular. */
  estado: "1" | "2" | "3";
  cliente: Cliente;
  totales: Totales;
  moneda: string;
  /** Para NC/ND: documento que modifica. */
  documentoAfectado?: DocumentoReferencia;
}

/** Resumen diario de boletas (RC). */
export interface ResumenDiario {
  emisor: Emisor;
  /** Fecha de generación del resumen (YYYY-MM-DD). */
  fechaGeneracion: string;
  /** Fecha de emisión de los documentos resumidos (YYYY-MM-DD). */
  fechaEmisionDocumentos: string;
  /** Correlativo del resumen del día (1, 2, ...). */
  correlativo: number;
  items: ResumenDiarioItem[];
}

/** Un comprobante a dar de baja (comunicación de baja). */
export interface BajaItem {
  tipoComprobante: string;
  serie: string;
  correlativo: string;
  motivo: string;
}

/** Comunicación de baja (RA). */
export interface ComunicacionBaja {
  emisor: Emisor;
  /** Fecha de generación de la comunicación (YYYY-MM-DD). */
  fechaGeneracion: string;
  /** Fecha de emisión de los documentos a dar de baja (YYYY-MM-DD). */
  fechaEmisionDocumentos: string;
  correlativo: number;
  items: BajaItem[];
}

/** Configuración del emisor para conectar con SUNAT. */
export interface SunatConfig {
  ambiente: Ambiente;
  /** Usuario secundario SOL. */
  usuarioSol: string;
  /** Clave del usuario SOL. */
  claveSol: string;
  /** Certificado digital en formato PEM (clave privada + certificado). */
  certificadoPem: string;
  /** Clave privada en PEM (si está separada del certificado). */
  llavePrivadaPem?: string;
  emisor: Emisor;
  /** URL del servicio SOAP (si se quiere sobreescribir el default por ambiente). */
  endpointOverride?: string;
}

/** Resultado del envío a SUNAT. */
export interface SunatResult {
  /** true si SUNAT aceptó (CDR con código 0) o devolvió un ticket. */
  exito: boolean;
  /** Código de respuesta de SUNAT (0 = aceptado). */
  codigo?: string;
  /** Descripción de la respuesta. */
  descripcion?: string;
  /** Ticket (para envíos asíncronos: resumen/baja). */
  ticket?: string;
  /** Nombre del archivo enviado. */
  nombreArchivo?: string;
  /** Hash (DigestValue) del XML firmado. */
  hash?: string;
  /** XML firmado (base64 o texto). */
  xmlFirmado?: string;
  /** CDR (Constancia de Recepción) en XML, si aplica. */
  cdrXml?: string;
  /** Notas/observaciones devueltas por SUNAT. */
  notas?: string[];
}
