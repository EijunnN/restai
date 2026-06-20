import type { Ambiente } from "./types.js";

/** Endpoints SOAP del servicio de facturación GEM de SUNAT. */
export const ENDPOINTS: Record<Ambiente, string> = {
  beta: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
  production: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
};

export interface SoapCredentials {
  /** Usuario completo: RUC + usuario secundario SOL (ej. 20123456789MODDATOS). */
  username: string;
  password: string;
  endpoint: string;
}

/** Error de SOAP / SUNAT con el código devuelto por el servicio. */
export class SunatSoapError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SunatSoapError";
    this.code = code;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildEnvelope(creds: SoapCredentials, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(creds.username)}</wsse:Username>
        <wsse:Password>${escapeXml(creds.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
${body}
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function callSoap(creds: SoapCredentials, body: string): Promise<string> {
  const envelope = buildEnvelope(creds, body);
  const res = await fetch(creds.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: envelope,
  });
  const text = await res.text();

  // Detectar SOAP Fault
  const fault = matchTag(text, "faultstring");
  if (fault) {
    const code =
      matchTag(text, "faultcode") ?? matchTag(text, "faultcode", true);
    throw new SunatSoapError(fault, extractFaultCode(code));
  }
  if (!res.ok) {
    throw new SunatSoapError(
      `Error HTTP ${res.status} del servicio SUNAT`,
      String(res.status),
    );
  }
  return text;
}

/** Extrae el contenido de una etiqueta por su nombre local (ignora namespaces). */
function matchTag(xml: string, local: string, _withNs = false): string | null {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${local}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1]!.trim() : null;
}

/** De un faultcode tipo "soap-env:Client.1033" extrae "1033". */
function extractFaultCode(code: string | null): string | undefined {
  if (!code) return undefined;
  const m = code.match(/(\d{3,4})/);
  return m?.[1];
}

/**
 * sendBill — Envío síncrono de factura/boleta/nota. Devuelve el CDR
 * (applicationResponse) en base64.
 */
export async function sendBill(
  creds: SoapCredentials,
  fileName: string,
  zipBase64: string,
): Promise<string> {
  const body = `    <ser:sendBill>
      <fileName>${escapeXml(fileName)}</fileName>
      <contentFile>${zipBase64}</contentFile>
    </ser:sendBill>`;
  const res = await callSoap(creds, body);
  const cdr = matchTag(res, "applicationResponse");
  if (!cdr) {
    throw new SunatSoapError("SUNAT no devolvió el CDR (applicationResponse)");
  }
  return cdr;
}

/**
 * sendSummary — Envío asíncrono de resumen diario / comunicación de baja.
 * Devuelve el número de ticket para consultar el estado.
 */
export async function sendSummary(
  creds: SoapCredentials,
  fileName: string,
  zipBase64: string,
): Promise<string> {
  const body = `    <ser:sendSummary>
      <fileName>${escapeXml(fileName)}</fileName>
      <contentFile>${zipBase64}</contentFile>
    </ser:sendSummary>`;
  const res = await callSoap(creds, body);
  const ticket = matchTag(res, "ticket");
  if (!ticket) {
    throw new SunatSoapError("SUNAT no devolvió el ticket");
  }
  return ticket;
}

export interface StatusResult {
  /** 0 = aceptado (con CDR), 98 = en proceso, 99 = procesado con error. */
  statusCode: string;
  /** CDR en base64 cuando ya está disponible. */
  content?: string;
}

/**
 * getStatus — Consulta el estado de un envío asíncrono mediante su ticket.
 */
export async function getStatus(
  creds: SoapCredentials,
  ticket: string,
): Promise<StatusResult> {
  const body = `    <ser:getStatus>
      <ticket>${escapeXml(ticket)}</ticket>
    </ser:getStatus>`;
  const res = await callSoap(creds, body);
  const statusCode = matchTag(res, "statusCode") ?? "";
  const content = matchTag(res, "content") ?? undefined;
  return { statusCode, content };
}
