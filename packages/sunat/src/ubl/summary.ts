import type { ComunicacionBaja, Emisor, ResumenDiario } from "../types.js";
import { TRIBUTO } from "../catalogs.js";
import { num, xmlEscape } from "../util.js";
import { NS, UBL_EXTENSIONS_PLACEHOLDER, signatureBlock } from "./common.js";

/** Parte del emisor usada en RC/RA (estilo UBL 2.0 de SUNAT). */
function summarySupplierParty(e: Emisor): string {
  return `  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${xmlEscape(e.ruc)}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${e.razonSocial}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;
}

/** Identificador del resumen: RC-YYYYMMDD-correlativo */
export function resumenId(fechaGeneracion: string, correlativo: number): string {
  return `RC-${fechaGeneracion.replace(/-/g, "")}-${correlativo}`;
}

/** Identificador de la comunicación de baja: RA-YYYYMMDD-correlativo */
export function bajaId(fechaGeneracion: string, correlativo: number): string {
  return `RA-${fechaGeneracion.replace(/-/g, "")}-${correlativo}`;
}

/**
 * Construye el XML del Resumen Diario de Boletas (SummaryDocuments, RC) sin firmar.
 * Permite declarar boletas (y sus notas) en lote ante SUNAT.
 */
export function buildSummaryXml(resumen: ResumenDiario): string {
  const id = resumenId(resumen.fechaGeneracion, resumen.correlativo);

  const docLines = resumen.items
    .map((item, i) => {
      const moneda = item.moneda;
      const t = item.totales;
      const payments: string[] = [];
      if (t.gravadas > 0) {
        payments.push(`      <sac:BillingPayment>
        <cbc:PaidAmount currencyID="${moneda}">${num(t.gravadas)}</cbc:PaidAmount>
        <cbc:InstructionID>01</cbc:InstructionID>
      </sac:BillingPayment>`);
      }
      if (t.exoneradas && t.exoneradas > 0) {
        payments.push(`      <sac:BillingPayment>
        <cbc:PaidAmount currencyID="${moneda}">${num(t.exoneradas)}</cbc:PaidAmount>
        <cbc:InstructionID>02</cbc:InstructionID>
      </sac:BillingPayment>`);
      }
      if (t.inafectas && t.inafectas > 0) {
        payments.push(`      <sac:BillingPayment>
        <cbc:PaidAmount currencyID="${moneda}">${num(t.inafectas)}</cbc:PaidAmount>
        <cbc:InstructionID>03</cbc:InstructionID>
      </sac:BillingPayment>`);
      }

      const ref = item.documentoAfectado
        ? `      <cac:BillingReference>
        <cac:InvoiceDocumentReference>
          <cbc:ID>${xmlEscape(item.documentoAfectado.serieNumero)}</cbc:ID>
          <cbc:DocumentTypeCode>${xmlEscape(item.documentoAfectado.tipoDoc)}</cbc:DocumentTypeCode>
        </cac:InvoiceDocumentReference>
      </cac:BillingReference>\n`
        : "";

      return `  <sac:SummaryDocumentsLine>
    <cbc:LineID>${i + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>${xmlEscape(item.tipoComprobante)}</cbc:DocumentTypeCode>
    <cbc:ID>${xmlEscape(`${item.serie}-${item.correlativo}`)}</cbc:ID>
    <cac:AccountingCustomerParty>
      <cbc:CustomerAssignedAccountID>${xmlEscape(item.cliente.numDoc)}</cbc:CustomerAssignedAccountID>
      <cbc:AdditionalAccountID>${xmlEscape(item.cliente.tipoDoc)}</cbc:AdditionalAccountID>
    </cac:AccountingCustomerParty>
${ref}    <sac:Status>
      <cbc:ConditionCode>${item.estado}</cbc:ConditionCode>
    </sac:Status>
    <sac:TotalAmount currencyID="${moneda}">${num(t.importeTotal)}</sac:TotalAmount>
${payments.join("\n")}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${num(t.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxAmount currencyID="${moneda}">${num(t.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID>${TRIBUTO.IGV.id}</cbc:ID>
            <cbc:Name>${TRIBUTO.IGV.nombre}</cbc:Name>
            <cbc:TaxTypeCode>${TRIBUTO.IGV.codigo}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </sac:SummaryDocumentsLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" ${NS.cac} ${NS.cbc} ${NS.ext} ${NS.ds} ${NS.sac}>
${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:ReferenceDate>${xmlEscape(resumen.fechaEmisionDocumentos)}</cbc:ReferenceDate>
  <cbc:IssueDate>${xmlEscape(resumen.fechaGeneracion)}</cbc:IssueDate>
${signatureBlock(resumen.emisor)}
${summarySupplierParty(resumen.emisor)}
${docLines}
</SummaryDocuments>`;
}

/**
 * Construye el XML de la Comunicación de Baja (VoidedDocuments, RA) sin firmar.
 * Permite anular facturas/notas ya aceptadas por SUNAT.
 */
export function buildVoidedXml(baja: ComunicacionBaja): string {
  const id = bajaId(baja.fechaGeneracion, baja.correlativo);

  const docLines = baja.items
    .map(
      (item, i) => `  <sac:VoidedDocumentsLine>
    <cbc:LineID>${i + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>${xmlEscape(item.tipoComprobante)}</cbc:DocumentTypeCode>
    <sac:DocumentSerialID>${xmlEscape(item.serie)}</sac:DocumentSerialID>
    <sac:DocumentNumberID>${xmlEscape(item.correlativo)}</sac:DocumentNumberID>
    <sac:VoidReasonDescription><![CDATA[${item.motivo}]]></sac:VoidReasonDescription>
  </sac:VoidedDocumentsLine>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<VoidedDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1" ${NS.cac} ${NS.cbc} ${NS.ext} ${NS.ds} ${NS.sac}>
${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.0</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:ReferenceDate>${xmlEscape(baja.fechaEmisionDocumentos)}</cbc:ReferenceDate>
  <cbc:IssueDate>${xmlEscape(baja.fechaGeneracion)}</cbc:IssueDate>
${signatureBlock(baja.emisor)}
${summarySupplierParty(baja.emisor)}
${docLines}
</VoidedDocuments>`;
}
