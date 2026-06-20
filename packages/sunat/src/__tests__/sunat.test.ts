import { describe, expect, it } from "bun:test";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { buildInvoiceXml } from "../ubl/invoice.js";
import { buildCreditNoteXml } from "../ubl/credit-note.js";
import { buildSummaryXml, buildVoidedXml } from "../ubl/summary.js";
import { signXml } from "../sign.js";
import { unzipBase64First, zipXmlBase64 } from "../zip.js";
import { parseCdrXml } from "../cdr.js";
import { montoEnLetras, num } from "../util.js";
import type { Comprobante, Nota, ResumenDiario } from "../types.js";

// Certificado autofirmado para pruebas
function testKeys() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(2020, 0, 1);
  cert.validity.notAfter = new Date(2030, 0, 1);
  const attrs = [{ name: "commonName", value: "TEST" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const emisor = {
  ruc: "20123456789",
  razonSocial: "RESTAURANTE DEMO SAC",
  ubigeo: "150101",
  departamento: "LIMA",
  provincia: "LIMA",
  distrito: "LIMA",
  direccion: "AV. PRINCIPAL 123",
};

const factura: Comprobante = {
  tipoComprobante: "01",
  serie: "F001",
  correlativo: "123",
  fechaEmision: "2026-06-20",
  horaEmision: "10:30:00",
  moneda: "PEN",
  emisor,
  cliente: {
    tipoDoc: "6",
    numDoc: "20987654321",
    razonSocial: "CLIENTE EMPRESA SAC",
  },
  detalles: [
    {
      cantidad: 2,
      unidad: "NIU",
      descripcion: "Lomo Saltado",
      codigo: "P001",
      valorUnitario: 25.42372881,
      precioUnitario: 30.0,
      valorVenta: 50.85,
      igv: 9.15,
      porcentajeIgv: 18,
      tipoAfectacionIgv: "10",
    },
  ],
  totales: { gravadas: 50.85, igv: 9.15, importeTotal: 60.0 },
  leyendas: [{ codigo: "1000", valor: montoEnLetras(60.0, "PEN") }],
};

describe("montoEnLetras", () => {
  it("convierte importes a letras", () => {
    expect(montoEnLetras(60, "PEN")).toBe("SESENTA CON 00/100 SOLES");
    expect(montoEnLetras(1250.5, "PEN")).toBe(
      "MIL DOSCIENTOS CINCUENTA CON 50/100 SOLES",
    );
    expect(montoEnLetras(100, "PEN")).toBe("CIEN CON 00/100 SOLES");
    expect(montoEnLetras(0, "PEN")).toBe("CERO CON 00/100 SOLES");
  });
  it("formatea números con decimales", () => {
    expect(num(9.156)).toBe("9.16");
    expect(num(9.154)).toBe("9.15");
    expect(num(2, 3)).toBe("2.000");
  });
});

describe("buildInvoiceXml", () => {
  it("genera UBL de factura válido", () => {
    const xml = buildInvoiceXml(factura);
    expect(xml).toContain("<cbc:ID>F001-123</cbc:ID>");
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="0101"');
    expect(xml).toContain(">01</cbc:InvoiceTypeCode>");
    expect(xml).toContain("<ext:ExtensionContent></ext:ExtensionContent>");
    expect(xml).toContain("RESTAURANTE DEMO SAC");
    expect(xml).toContain("Lomo Saltado");
    // El XML debe parsear sin errores
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.documentElement?.nodeName).toBe("Invoice");
  });
});

describe("signXml", () => {
  it("inserta una firma enveloped válida dentro de ExtensionContent", () => {
    const { certificatePem, privateKeyPem } = testKeys();
    const xml = buildInvoiceXml(factura);
    const { xml: signed, digestValue } = signXml(xml, {
      certificatePem,
      privateKeyPem,
    });

    expect(signed).toContain('<ds:Signature');
    expect(signed).toContain('Id="SignatureSP"');
    expect(signed).toContain("X509Certificate");
    expect(digestValue.length).toBeGreaterThan(10);
    expect(/<ext:ExtensionContent>\s*<ds:Signature/.test(signed)).toBe(true);

    // Verificar la firma criptográficamente
    const doc = new DOMParser().parseFromString(signed, "text/xml");
    const sigNode = doc.getElementsByTagName("ds:Signature")[0]!;
    const verifier = new SignedXml({ publicCert: certificatePem });
    verifier.loadSignature(sigNode as any);
    const ok = verifier.checkSignature(signed);
    expect(ok).toBe(true);
  });
});

describe("zip", () => {
  it("comprime y descomprime sin pérdida", () => {
    const xml = buildInvoiceXml(factura);
    const b64 = zipXmlBase64("20123456789-01-F001-123.xml", xml);
    const back = unzipBase64First(b64);
    expect(back.content).toBe(xml);
    expect(back.name).toBe("20123456789-01-F001-123.xml");
  });
});

describe("parseCdrXml", () => {
  it("detecta un comprobante aceptado", () => {
    const cdr = parseCdrXml(`<ar:ApplicationResponse
      xmlns:ar="urn:x" xmlns:cac="urn:y" xmlns:cbc="urn:z">
      <cac:DocumentResponse><cac:Response>
        <cbc:ResponseCode>0</cbc:ResponseCode>
        <cbc:Description>aceptada</cbc:Description>
      </cac:Response>
      <cac:DocumentReference><cbc:ID>F001-123</cbc:ID></cac:DocumentReference>
      </cac:DocumentResponse>
    </ar:ApplicationResponse>`);
    expect(cdr.responseCode).toBe("0");
    expect(cdr.aceptado).toBe(true);
    expect(cdr.rechazado).toBe(false);
    expect(cdr.documentReference).toBe("F001-123");
  });

  it("detecta un comprobante rechazado", () => {
    const cdr = parseCdrXml(`<ApplicationResponse xmlns="urn:x">
      <DocumentResponse><Response>
        <ResponseCode>2335</ResponseCode>
        <Description>El documento ya fue informado</Description>
      </Response></DocumentResponse>
    </ApplicationResponse>`);
    expect(cdr.responseCode).toBe("2335");
    expect(cdr.rechazado).toBe(true);
    expect(cdr.aceptado).toBe(false);
  });
});

describe("notas y resúmenes", () => {
  it("genera nota de crédito con referencia al documento afectado", () => {
    const nota: Nota = {
      ...factura,
      tipoComprobante: "07",
      serie: "FC01",
      correlativo: "1",
      codigoMotivo: "01",
      descripcionMotivo: "Anulación de la operación",
      documentoAfectado: { tipoDoc: "01", serieNumero: "F001-123" },
    };
    const xml = buildCreditNoteXml(nota);
    expect(xml).toContain("<CreditNote");
    expect(xml).toContain("<cbc:ResponseCode>01</cbc:ResponseCode>");
    expect(xml).toContain("<cbc:ID>F001-123</cbc:ID>");
    expect(xml).toContain("CreditNoteLine");
  });

  it("genera resumen diario de boletas", () => {
    const resumen: ResumenDiario = {
      emisor,
      fechaGeneracion: "2026-06-20",
      fechaEmisionDocumentos: "2026-06-19",
      correlativo: 1,
      items: [
        {
          tipoComprobante: "03",
          serie: "B001",
          correlativo: "1",
          estado: "1",
          moneda: "PEN",
          cliente: { tipoDoc: "1", numDoc: "44556677", razonSocial: "CLIENTE" },
          totales: { gravadas: 50.85, igv: 9.15, importeTotal: 60.0 },
        },
      ],
    };
    const xml = buildSummaryXml(resumen);
    expect(xml).toContain("<SummaryDocuments");
    expect(xml).toContain("RC-20260620-1");
    expect(xml).toContain("<cbc:ID>B001-1</cbc:ID>");
  });

  it("genera comunicación de baja", () => {
    const xml = buildVoidedXml({
      emisor,
      fechaGeneracion: "2026-06-20",
      fechaEmisionDocumentos: "2026-06-19",
      correlativo: 1,
      items: [
        {
          tipoComprobante: "01",
          serie: "F001",
          correlativo: "123",
          motivo: "ERROR EN EL MONTO",
        },
      ],
    });
    expect(xml).toContain("<VoidedDocuments");
    expect(xml).toContain("RA-20260620-1");
    expect(xml).toContain("<sac:DocumentSerialID>F001</sac:DocumentSerialID>");
  });
});
