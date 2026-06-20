import type { Comprobante } from "../types.js";
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
 * Construye el XML UBL 2.1 de una Factura o Boleta (sin firmar).
 * El nodo ext:ExtensionContent queda vacío para que el firmador inserte la firma.
 */
export function buildInvoiceXml(doc: Comprobante): string {
  const serieNumero = `${doc.serie}-${doc.correlativo}`;
  const tipoOperacion = doc.tipoOperacion ?? "0101";
  const leyendas = (doc.leyendas ?? [])
    .map(
      (l) =>
        `  <cbc:Note languageLocaleID="${xmlEscape(l.codigo)}"><![CDATA[${l.valor}]]></cbc:Note>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ${NS.cac} ${NS.cbc} ${NS.ext} ${NS.ds}>
${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${xmlEscape(serieNumero)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(doc.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${xmlEscape(doc.horaEmision ?? "00:00:00")}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${xmlEscape(tipoOperacion)}" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${xmlEscape(doc.tipoComprobante)}</cbc:InvoiceTypeCode>
${leyendas}
  <cbc:DocumentCurrencyCode>${xmlEscape(doc.moneda)}</cbc:DocumentCurrencyCode>
${signatureBlock(doc.emisor)}
${supplierParty(doc.emisor)}
${customerParty(doc.cliente)}
${taxTotal(doc.moneda, doc.totales)}
${legalMonetaryTotal(doc.moneda, doc.totales)}
${lines(doc.moneda, doc.detalles, "InvoiceLine", "InvoicedQuantity")}
</Invoice>`;
}
