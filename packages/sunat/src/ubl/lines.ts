import type { DetalleItem, Totales } from "../types.js";
import { TRIBUTO } from "../catalogs.js";
import { num, xmlEscape } from "../util.js";

/** TaxTotal global del comprobante (resumen de tributos). */
export function taxTotal(moneda: string, totales: Totales): string {
  const subtotales: string[] = [];

  if (totales.gravadas > 0) {
    subtotales.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${num(totales.gravadas)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${num(totales.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>${TRIBUTO.IGV.id}</cbc:ID>
          <cbc:Name>${TRIBUTO.IGV.nombre}</cbc:Name>
          <cbc:TaxTypeCode>${TRIBUTO.IGV.codigo}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
  }
  if (totales.exoneradas && totales.exoneradas > 0) {
    subtotales.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${num(totales.exoneradas)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>${TRIBUTO.EXONERADO.id}</cbc:ID>
          <cbc:Name>${TRIBUTO.EXONERADO.nombre}</cbc:Name>
          <cbc:TaxTypeCode>${TRIBUTO.EXONERADO.codigo}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
  }
  if (totales.inafectas && totales.inafectas > 0) {
    subtotales.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${num(totales.inafectas)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>${TRIBUTO.INAFECTO.id}</cbc:ID>
          <cbc:Name>${TRIBUTO.INAFECTO.nombre}</cbc:Name>
          <cbc:TaxTypeCode>${TRIBUTO.INAFECTO.codigo}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
  }

  return `  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${moneda}">${num(totales.igv)}</cbc:TaxAmount>
${subtotales.join("\n")}
  </cac:TaxTotal>`;
}

/** LegalMonetaryTotal del comprobante. */
export function legalMonetaryTotal(moneda: string, totales: Totales): string {
  const valorVenta =
    totales.gravadas + (totales.exoneradas ?? 0) + (totales.inafectas ?? 0);
  return `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${moneda}">${num(valorVenta)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${num(totales.importeTotal)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${num(totales.importeTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
}

/**
 * Líneas del comprobante. `lineTag` es "InvoiceLine", "CreditNoteLine" o
 * "DebitNoteLine"; `qtyTag` es "InvoicedQuantity" / "CreditedQuantity" / "DebitedQuantity".
 */
export function lines(
  moneda: string,
  detalles: DetalleItem[],
  lineTag: string,
  qtyTag: string,
): string {
  return detalles
    .map((d, i) => {
      const id = i + 1;
      return `  <cac:${lineTag}>
    <cbc:ID>${id}</cbc:ID>
    <cbc:${qtyTag} unitCode="${xmlEscape(d.unidad)}">${num(d.cantidad, 3)}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${moneda}">${num(d.valorVenta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${moneda}">${num(d.precioUnitario)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${num(d.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${moneda}">${num(d.valorVenta)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${moneda}">${num(d.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${num(d.porcentajeIgv)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${xmlEscape(d.tipoAfectacionIgv)}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>${TRIBUTO.IGV.id}</cbc:ID>
            <cbc:Name>${TRIBUTO.IGV.nombre}</cbc:Name>
            <cbc:TaxTypeCode>${TRIBUTO.IGV.codigo}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${d.descripcion}]]></cbc:Description>${
        d.codigo
          ? `\n      <cac:SellersItemIdentification>\n        <cbc:ID>${xmlEscape(d.codigo)}</cbc:ID>\n      </cac:SellersItemIdentification>`
          : ""
      }
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${moneda}">${num(d.valorUnitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${lineTag}>`;
    })
    .join("\n");
}
