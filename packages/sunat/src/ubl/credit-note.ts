import type { Nota } from "../types.js";
import { xmlEscape } from "../util.js";
import {
  NS,
  UBL_EXTENSIONS_PLACEHOLDER,
  customerParty,
  signatureBlock,
  supplierParty,
} from "./common.js";
import { legalMonetaryTotal, lines, taxTotal } from "./lines.js";

/**
 * Construye el XML UBL 2.1 de una Nota de Crédito (sin firmar).
 * La nota referencia al comprobante que modifica mediante cac:DiscrepancyResponse
 * y cac:BillingReference.
 */
export function buildCreditNoteXml(doc: Nota): string {
  const serieNumero = `${doc.serie}-${doc.correlativo}`;
  const leyendas = (doc.leyendas ?? [])
    .map(
      (l) =>
        `  <cbc:Note languageLocaleID="${xmlEscape(l.codigo)}"><![CDATA[${l.valor}]]></cbc:Note>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" ${NS.cac} ${NS.cbc} ${NS.ext} ${NS.ds}>
${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${xmlEscape(serieNumero)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(doc.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${xmlEscape(doc.horaEmision ?? "00:00:00")}</cbc:IssueTime>
${leyendas}
  <cbc:DocumentCurrencyCode>${xmlEscape(doc.moneda)}</cbc:DocumentCurrencyCode>
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${xmlEscape(doc.documentoAfectado.serieNumero)}</cbc:ReferenceID>
    <cbc:ResponseCode>${xmlEscape(doc.codigoMotivo)}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${doc.descripcionMotivo}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${xmlEscape(doc.documentoAfectado.serieNumero)}</cbc:ID>
      <cbc:DocumentTypeCode>${xmlEscape(doc.documentoAfectado.tipoDoc)}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
${signatureBlock(doc.emisor)}
${supplierParty(doc.emisor)}
${customerParty(doc.cliente)}
${taxTotal(doc.moneda, doc.totales)}
${legalMonetaryTotal(doc.moneda, doc.totales)}
${lines(doc.moneda, doc.detalles, "CreditNoteLine", "CreditedQuantity")}
</CreditNote>`;
}
