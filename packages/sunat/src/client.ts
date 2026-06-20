import type {
  Comprobante,
  ComunicacionBaja,
  Nota,
  ResumenDiario,
  SunatConfig,
  SunatResult,
} from "./types.js";
import { buildInvoiceXml } from "./ubl/invoice.js";
import { buildCreditNoteXml } from "./ubl/credit-note.js";
import { bajaId, buildSummaryXml, buildVoidedXml, resumenId } from "./ubl/summary.js";
import { signXml, type SigningKeys, type SignedResult } from "./sign.js";
import { zipXmlBase64 } from "./zip.js";
import {
  ENDPOINTS,
  getStatus,
  sendBill,
  sendSummary,
  SunatSoapError,
  type SoapCredentials,
} from "./soap.js";
import { parseCdrBase64 } from "./cdr.js";

/** Nombre de archivo de un comprobante: RUC-tipo-serie-correlativo */
function nombreComprobante(
  ruc: string,
  tipo: string,
  serie: string,
  correlativo: string,
): string {
  return `${ruc}-${tipo}-${serie}-${correlativo}`;
}

/**
 * Cliente de alto nivel para emitir comprobantes electrónicos ante SUNAT.
 * Encapsula: construir XML UBL → firmar → comprimir → enviar (SOAP) → leer CDR.
 */
export class SunatClient {
  private config: SunatConfig;

  constructor(config: SunatConfig) {
    this.config = config;
  }

  private keys(): SigningKeys {
    return {
      certificatePem: this.config.certificadoPem,
      privateKeyPem: this.config.llavePrivadaPem ?? this.config.certificadoPem,
    };
  }

  private creds(): SoapCredentials {
    return {
      username: `${this.config.emisor.ruc}${this.config.usuarioSol}`,
      password: this.config.claveSol,
      endpoint:
        this.config.endpointOverride ?? ENDPOINTS[this.config.ambiente],
    };
  }

  /** Firma un XML UBL ya construido. */
  firmar(xml: string): SignedResult {
    return signXml(xml, this.keys());
  }

  /**
   * Envía una factura/boleta a SUNAT (síncrono, vía sendBill) y devuelve el CDR.
   */
  async enviarComprobante(doc: Comprobante): Promise<SunatResult> {
    const xml = buildInvoiceXml(doc);
    return this.enviarSync(
      xml,
      nombreComprobante(
        doc.emisor.ruc,
        doc.tipoComprobante,
        doc.serie,
        doc.correlativo,
      ),
    );
  }

  /** Envía una nota de crédito a SUNAT (síncrono, vía sendBill). */
  async enviarNotaCredito(nota: Nota): Promise<SunatResult> {
    const xml = buildCreditNoteXml(nota);
    return this.enviarSync(
      xml,
      nombreComprobante(
        nota.emisor.ruc,
        nota.tipoComprobante,
        nota.serie,
        nota.correlativo,
      ),
    );
  }

  private async enviarSync(
    xml: string,
    baseName: string,
  ): Promise<SunatResult> {
    const { xml: signed, digestValue } = this.firmar(xml);
    const fileName = `${baseName}.zip`;
    const zipB64 = zipXmlBase64(`${baseName}.xml`, signed);

    try {
      const cdrB64 = await sendBill(this.creds(), fileName, zipB64);
      const cdr = parseCdrBase64(cdrB64);
      return {
        exito: cdr.aceptado,
        codigo: cdr.responseCode,
        descripcion: cdr.description,
        nombreArchivo: fileName,
        hash: digestValue,
        xmlFirmado: signed,
        cdrXml: cdr.xml,
        notas: cdr.notas,
      };
    } catch (err) {
      return this.errorResult(err, fileName, digestValue, signed);
    }
  }

  /**
   * Envía un resumen diario de boletas (asíncrono, vía sendSummary).
   * Devuelve un ticket que luego se consulta con consultarTicket().
   */
  async enviarResumen(resumen: ResumenDiario): Promise<SunatResult> {
    const xml = buildSummaryXml(resumen);
    const baseName = `${resumen.emisor.ruc}-${resumenId(resumen.fechaGeneracion, resumen.correlativo)}`;
    return this.enviarAsync(xml, baseName);
  }

  /** Envía una comunicación de baja (asíncrono, vía sendSummary). */
  async enviarBaja(baja: ComunicacionBaja): Promise<SunatResult> {
    const xml = buildVoidedXml(baja);
    const baseName = `${baja.emisor.ruc}-${bajaId(baja.fechaGeneracion, baja.correlativo)}`;
    return this.enviarAsync(xml, baseName);
  }

  private async enviarAsync(
    xml: string,
    baseName: string,
  ): Promise<SunatResult> {
    const { xml: signed, digestValue } = this.firmar(xml);
    const fileName = `${baseName}.zip`;
    const zipB64 = zipXmlBase64(`${baseName}.xml`, signed);

    try {
      const ticket = await sendSummary(this.creds(), fileName, zipB64);
      return {
        exito: true,
        ticket,
        nombreArchivo: fileName,
        hash: digestValue,
        xmlFirmado: signed,
        descripcion: "Enviado, pendiente de procesamiento (ticket asignado)",
      };
    } catch (err) {
      return this.errorResult(err, fileName, digestValue, signed);
    }
  }

  /** Consulta el estado de un ticket (resumen/baja) y procesa el CDR si está listo. */
  async consultarTicket(ticket: string): Promise<SunatResult> {
    try {
      const status = await getStatus(this.creds(), ticket);
      if (status.statusCode === "98") {
        return {
          exito: false,
          ticket,
          codigo: "98",
          descripcion: "En proceso, vuelva a consultar más tarde",
        };
      }
      if (status.content) {
        const cdr = parseCdrBase64(status.content);
        return {
          exito: cdr.aceptado && status.statusCode === "0",
          ticket,
          codigo: cdr.responseCode || status.statusCode,
          descripcion: cdr.description,
          cdrXml: cdr.xml,
          notas: cdr.notas,
        };
      }
      return {
        exito: status.statusCode === "0",
        ticket,
        codigo: status.statusCode,
        descripcion:
          status.statusCode === "0" ? "Aceptado" : "Procesado con error",
      };
    } catch (err) {
      return this.errorResult(err, undefined, undefined, undefined, ticket);
    }
  }

  private errorResult(
    err: unknown,
    nombreArchivo?: string,
    hash?: string,
    xmlFirmado?: string,
    ticket?: string,
  ): SunatResult {
    const code = err instanceof SunatSoapError ? err.code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    return {
      exito: false,
      codigo: code,
      descripcion: message,
      nombreArchivo,
      hash,
      xmlFirmado,
      ticket,
    };
  }
}
