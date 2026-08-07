import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatea céntimos como importe.
 *
 * La moneda es configurable por sede (branches.currency) desde hace tiempo, pero
 * esto devolvía "S/" a fuego, así que cambiarla en Ajustes decía "Guardado
 * correctamente" y no cambiaba nada. Con `Intl` el símbolo, el separador de
 * miles y la posición del signo salen correctos para cualquier moneda.
 *
 * El valor por defecto sigue siendo PEN: es el mercado principal y la inmensa
 * mayoría de las llamadas no pasan moneda.
 */
export function formatCurrency(cents: number, currency: string = "PEN"): string {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Código de moneda inválido guardado en la sede: no rompas la pantalla.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(new Date(date));
}
