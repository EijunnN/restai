/**
 * Exportación CSV en el cliente.
 *
 * Los reportes acaban en la hoja de cálculo del contador, así que el formato
 * apunta a Excel en español: separador `;`, BOM UTF-8 (sin él Excel rompe las
 * tildes) y decimales con coma.
 */

const SEPARATOR = ";";

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Una celda que empiece por =, +, - o @ puede ejecutarse como fórmula al
  // abrirla en Excel (CSV injection). Se neutraliza con un apóstrofo.
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (safe.includes(SEPARATOR) || safe.includes('"') || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Céntimos -> "123,45" (formato decimal español, listo para Excel). */
export function csvMoney(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(SEPARATOR);
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(SEPARATOR))
    .join("\r\n");
  return `${head}\r\n${body}`;
}

/** Genera el CSV y dispara la descarga. `filename` sin extensión. */
export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const csv = buildCsv(columns, rows);
  // ﻿ = BOM: sin él, Excel en Windows muestra "Ã±" en lugar de "ñ".
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revocar en el siguiente tick: Safari necesita que la URL siga viva al hacer click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
