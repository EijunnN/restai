import { XMLParser } from "fast-xml-parser";
import { unzipBase64First } from "./zip.js";

export interface CdrResult {
  /** Código de respuesta: "0" = aceptado. 2000-3999 = rechazado. >=4000 = observado. */
  responseCode: string;
  /** Descripción legible de la respuesta. */
  description: string;
  /** true si SUNAT aceptó el comprobante (código 0 o con observaciones). */
  aceptado: boolean;
  /** true si el comprobante fue rechazado. */
  rechazado: boolean;
  /** Observaciones / notas devueltas por SUNAT. */
  notas: string[];
  /** ID del comprobante referenciado en el CDR (ej. F001-1). */
  documentReference?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parsea el XML de un CDR (ApplicationResponse) y resume la respuesta de SUNAT. */
export function parseCdrXml(cdrXml: string): CdrResult {
  const doc = parser.parse(cdrXml);
  const appResponse =
    doc.ApplicationResponse ?? doc["ar:ApplicationResponse"] ?? doc;

  const docResponse = toArray(appResponse?.DocumentResponse)[0];
  const response = docResponse?.Response ?? {};

  const responseCode = String(response.ResponseCode ?? "");
  const description = String(response.Description ?? "");
  const documentReference =
    docResponse?.DocumentReference?.ID !== undefined
      ? String(docResponse.DocumentReference.ID)
      : undefined;

  const notas = toArray(appResponse?.Note ?? response?.Note).map((n) =>
    String(n),
  );

  const code = parseInt(responseCode, 10);
  const aceptado = responseCode === "0" || (code >= 4000 && code < 4000 + 1000);
  const rechazado = code >= 2000 && code < 4000;

  return {
    responseCode,
    description,
    aceptado: aceptado || (!rechazado && responseCode === "0"),
    rechazado,
    notas,
    documentReference,
  };
}

/** Descomprime un CDR en base64 (R-*.zip) y lo parsea. */
export function parseCdrBase64(cdrBase64: string): CdrResult & { xml: string } {
  const { content } = unzipBase64First(cdrBase64);
  return { ...parseCdrXml(content), xml: content };
}
