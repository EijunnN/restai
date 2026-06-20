import { SignedXml } from "xml-crypto";
import forge from "node-forge";
import { SIGNATURE_ID } from "./ubl/common.js";

export interface SigningKeys {
  /** Clave privada en formato PEM. */
  privateKeyPem: string;
  /** Certificado X.509 en formato PEM. */
  certificatePem: string;
}

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/**
 * Convierte un certificado PKCS#12 (.pfx/.p12) en base64 a llaves PEM
 * (clave privada + certificado), tal como los necesita el firmador.
 */
export function pfxToPem(pfxBase64: string, password: string): SigningKeys {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  let privateKeyPem = "";
  let certificatePem = "";

  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (
        safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag ||
        safeBag.type === forge.pki.oids.keyBag
      ) {
        if (safeBag.key) {
          privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
        }
      } else if (safeBag.type === forge.pki.oids.certBag) {
        if (safeBag.cert) {
          certificatePem = forge.pki.certificateToPem(safeBag.cert);
        }
      }
    }
  }

  if (!privateKeyPem || !certificatePem) {
    throw new Error(
      "No se pudo extraer la clave privada o el certificado del PFX (¿clave incorrecta?)",
    );
  }
  return { privateKeyPem, certificatePem };
}

/** Limpia un PEM de certificado dejando solo el base64 (para X509Certificate). */
function certBody(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\r?\n|\r/g, "")
    .trim();
}

/** Resultado de la firma. */
export interface SignedResult {
  xml: string;
  /** DigestValue del documento (hash que SUNAT usa para identificar el CPE). */
  digestValue: string;
}

/**
 * Firma un XML UBL con firma digital enveloped (XML-DSig), insertándola dentro
 * del nodo ext:ExtensionContent. Usa RSA-SHA1 + C14N, el algoritmo aceptado por SUNAT.
 */
export function signXml(xml: string, keys: SigningKeys): SignedResult {
  const sig = new SignedXml({
    privateKey: keys.privateKeyPem,
    publicCert: keys.certificatePem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certBody(keys.certificatePem)}</X509Certificate></X509Data>`,
  });

  sig.addReference({
    xpath: "/*",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });

  sig.computeSignature(xml, {
    prefix: "ds",
    attrs: { Id: SIGNATURE_ID },
    location: {
      reference: "//*[local-name(.)='ExtensionContent']",
      action: "append",
    },
  });

  const signedXml = sig.getSignedXml();
  const digestValue = extractDigestValue(signedXml);
  return { xml: signedXml, digestValue };
}

/** Extrae el primer DigestValue del XML firmado. */
function extractDigestValue(signedXml: string): string {
  const match = signedXml.match(/<ds:DigestValue>([^<]*)<\/ds:DigestValue>/);
  return match?.[1] ?? "";
}
