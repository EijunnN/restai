/** Nombres de los métodos de cobro tal y como los llama el personal en Perú. */
export const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

/** Etiqueta del método, o el código crudo si la API añade uno nuevo. */
export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}
