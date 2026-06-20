/** Escapa caracteres especiales de XML en valores de texto. */
export function xmlEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Formatea un número a string con la cantidad de decimales indicada (default 2). */
export function num(value: number, decimals = 2): string {
  return (Math.round(value * 1e6) / 1e6).toFixed(decimals);
}

const UNIDADES = [
  "",
  "UNO",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
];
const DECENAS = [
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISEIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
];
const DECENAS_10 = [
  "",
  "",
  "VEINTE",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];
const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

function seccion(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  let texto = "";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) texto += CENTENAS[c] + " ";
  if (resto >= 10 && resto < 20) {
    texto += DECENAS[resto - 10] + " ";
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d >= 2) {
      texto += DECENAS_10[d];
      texto += u > 0 ? " Y " + UNIDADES[u] + " " : " ";
    } else if (d === 1) {
      texto += DECENAS[0] + " ";
    } else if (u > 0) {
      texto += UNIDADES[u] + " ";
    }
  }
  return texto.trim() + " ";
}

function enteroEnLetras(n: number): string {
  if (n === 0) return "CERO";
  let texto = "";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const cientos = n % 1000;
  if (millones > 0) {
    texto +=
      millones === 1 ? "UN MILLON " : seccion(millones).trim() + " MILLONES ";
  }
  if (miles > 0) {
    texto += miles === 1 ? "MIL " : seccion(miles).trim() + " MIL ";
  }
  if (cientos > 0) texto += seccion(cientos);
  return texto.trim();
}

const MONEDA_LETRAS: Record<string, string> = {
  PEN: "SOLES",
  USD: "DOLARES AMERICANOS",
};

/**
 * Convierte un importe a la leyenda "monto en letras" requerida por SUNAT.
 * Ej: 1250.50 PEN -> "MIL DOSCIENTOS CINCUENTA Y 50/100 SOLES"
 */
export function montoEnLetras(monto: number, moneda = "PEN"): string {
  const entero = Math.floor(monto);
  const centimos = Math.round((monto - entero) * 100);
  const letras = enteroEnLetras(entero);
  const cent = String(centimos).padStart(2, "0");
  const unidad = MONEDA_LETRAS[moneda] ?? moneda;
  return `${letras} CON ${cent}/100 ${unidad}`;
}
