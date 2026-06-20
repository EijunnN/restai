import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";

/** Comprime un XML (string) dentro de un ZIP con el nombre de archivo dado. */
export function zipXml(fileName: string, xml: string): Uint8Array {
  return zipSync({ [fileName]: strToU8(xml) }, { level: 6 });
}

/** Devuelve el ZIP comprimido como string base64 (formato que espera SUNAT). */
export function zipXmlBase64(fileName: string, xml: string): string {
  const zipped = zipXml(fileName, xml);
  return Buffer.from(zipped).toString("base64");
}

/** Descomprime un ZIP (Uint8Array) y devuelve el primer archivo como texto. */
export function unzipFirst(buf: Uint8Array): { name: string; content: string } {
  const files = unzipSync(buf);
  const names = Object.keys(files);
  if (names.length === 0) throw new Error("ZIP vacío");
  const name = names[0]!;
  return { name, content: strFromU8(files[name]!) };
}

/** Descomprime un ZIP en base64 y devuelve el primer archivo como texto. */
export function unzipBase64First(base64: string): {
  name: string;
  content: string;
} {
  return unzipFirst(new Uint8Array(Buffer.from(base64, "base64")));
}
