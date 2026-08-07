"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Comprobantes electrónicos (boletas, facturas y notas) y su estado ante SUNAT.
 *
 * En Perú el comprobante emitido es una obligación tributaria del local: si se
 * queda en 'pending' o 'rejected' y nadie lo ve, el restaurante acumula
 * incumplimientos sin enterarse. Por eso estos hooks exponen SIEMPRE el estado
 * real (`sunat_status`), su etiqueta legible y el motivo del rechazo.
 *
 * Todo el dinero en CÉNTIMOS enteros.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type InvoiceType = "boleta" | "factura" | "nota_credito" | "nota_debito";

export type SunatStatus =
  | "pending"
  | "sent"
  | "accepted"
  | "observed"
  | "rejected"
  | "voided"
  | "error";

export interface Invoice {
  id: string;
  order_id: string;
  type: InvoiceType;
  series: string;
  number: number;
  customer_name: string;
  customer_doc_type: "dni" | "ruc" | "ce";
  customer_doc_number: string;
  /** Céntimos. */
  subtotal: number;
  igv: number;
  total: number;
  sunat_status: SunatStatus;
  sunat_code: string | null;
  sunat_description: string | null;
  sunat_ticket: string | null;
  sunat_hash: string | null;
  sent_at: string | null;
  reference_invoice_id: string | null;
  note_motive_code: string | null;
  note_motive_description: string | null;
  created_at: string;
  /** "F001-00000123": serie + correlativo con ceros, como exige SUNAT. */
  numero_completo: string;
  /** Etiqueta en español que redacta la API; se pinta tal cual. */
  sunat_status_label: string;
  has_cdr: boolean;
  has_xml: boolean;
  /** El documento ya está definitivamente resuelto ante SUNAT. */
  sunat_final: boolean;
  /** Conviene ofrecer "Reenviar". */
  puede_reenviar: boolean;
}

export interface InvoicesQuery {
  type?: InvoiceType;
  sunatStatus?: SunatStatus;
  /** Fechas civiles peruanas "YYYY-MM-DD" (lib/date, nunca toISOString()). */
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface InvoicesResponse {
  data: Invoice[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function buildQueryString(query: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const search = qs.toString();
  return search ? `?${search}` : "";
}

/**
 * Consulta suelta de una página del listado, fuera de React Query.
 *
 * La usa la exportación a CSV para recorrer TODO el rango: el listado en
 * pantalla está paginado, y exportar solo la página visible entregaría a la
 * contabilidad una parte del mes haciéndola pasar por el mes entero.
 */
export function fetchInvoicesPage(query: InvoicesQuery): Promise<InvoicesResponse> {
  const search = buildQueryString({
    type: query.type,
    sunatStatus: query.sunatStatus,
    startDate: query.startDate,
    endDate: query.endDate,
    page: query.page,
    limit: query.limit,
  });
  return apiFetchWithMeta<InvoicesResponse>(`/api/invoices${search}`);
}

export function useInvoices(query: InvoicesQuery = {}) {
  const search = buildQueryString({
    type: query.type,
    sunatStatus: query.sunatStatus,
    startDate: query.startDate,
    endDate: query.endDate,
    page: query.page,
    limit: query.limit,
  });

  return useQuery<InvoicesResponse>({
    queryKey: ["invoices", "list", query],
    // La paginación vive fuera de `data`: con `apiFetch` se perdía y el listado
    // no sabía cuántas páginas había.
    queryFn: () => apiFetchWithMeta<InvoicesResponse>(`/api/invoices${search}`),
  });
}

export interface PendingSunat {
  por_estado: Partial<Record<SunatStatus, number>>;
  /** pending + error + rejected: lo que exige acción del local. */
  sin_resolver: number;
  etiquetas: Record<string, string>;
}

export function usePendingSunat() {
  return useQuery<PendingSunat>({
    queryKey: ["invoices", "pendientes-sunat"],
    queryFn: () => apiFetch<PendingSunat>("/api/invoices/pendientes-sunat"),
    // Un envío asíncrono puede resolverse en SUNAT mientras la pantalla está
    // abierta: el contador de pendientes se refresca solo.
    refetchInterval: 60_000,
  });
}

export function useInvoice(id: string | null) {
  return useQuery<Invoice>({
    queryKey: ["invoices", "detail", id],
    queryFn: () => apiFetch<Invoice>(`/api/invoices/${id}`),
    enabled: !!id,
  });
}

export interface CreateInvoiceInput {
  orderId: string;
  type: "boleta" | "factura";
  customerName: string;
  customerDocType: "dni" | "ruc" | "ce";
  customerDocNumber: string;
}

/** Emite el comprobante. Devuelve serie y correlativo ya asignados. */
export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation<Invoice, Error, CreateInvoiceInput>({
    mutationFn: (data) =>
      apiFetch<Invoice>("/api/invoices", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

/**
 * Respuesta de los endpoints que hablan con SUNAT.
 *
 * Cuando SUNAT rechaza, la API responde 422 y `apiFetch` lanza un `ApiError`
 * cuyo mensaje YA es la descripción literal de SUNAT: basta con mostrarlo.
 */
export interface SunatActionResult {
  accion?: string;
  via?: "baja" | "nota_credito" | "local";
  motivo_via?: string;
  result?: {
    exito: boolean;
    codigo?: string;
    descripcion?: string;
    ticket?: string;
  } | null;
  nota?: Invoice | null;
  invoice?: Invoice | null;
}

/** Todas las acciones sobre SUNAT invalidan el listado y el contador. */
function useSunatMutation<TVariables>(
  request: (vars: TVariables) => Promise<SunatActionResult>,
) {
  const qc = useQueryClient();
  return useMutation<SunatActionResult, Error, TVariables>({
    mutationFn: request,
    onSettled: () => {
      // También en error: un rechazo de SUNAT CAMBIA el estado guardado del
      // comprobante (pasa a 'rejected' con su motivo), así que la fila de la
      // tabla tiene que refrescarse igual.
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

/** Primer envío a SUNAT. */
export function useDeclararInvoice() {
  return useSunatMutation<string>((id) =>
    apiFetch<SunatActionResult>(`/api/invoices/${id}/declarar`, { method: "POST" }),
  );
}

/** Reintento: reenvía o consulta el ticket abierto, según corresponda. */
export function useResendInvoice() {
  return useSunatMutation<string>((id) =>
    apiFetch<SunatActionResult>(`/api/invoices/${id}/resend`, { method: "POST" }),
  );
}

/** Consulta el ticket asíncrono y persiste el CDR si ya llegó. */
export function useConsultarEstadoInvoice() {
  return useSunatMutation<string>((id) =>
    apiFetch<SunatActionResult>(`/api/invoices/${id}/estado`),
  );
}

/**
 * Anulación inteligente: el servidor decide baja, nota de crédito o anulación
 * local según el tipo de comprobante, su estado y el plazo de SUNAT.
 */
export function useVoidInvoice() {
  return useSunatMutation<{ id: string; motivo: string; via?: "baja" | "nota_credito" }>(
    ({ id, motivo, via }) =>
      apiFetch<SunatActionResult>(`/api/invoices/${id}/void`, {
        method: "POST",
        body: JSON.stringify({ motivo, ...(via ? { via } : {}) }),
      }),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Descarga de XML y CDR
// ───────────────────────────────────────────────────────────────────────────
// `apiFetch` hace `res.json()` y aquí el cuerpo es XML, así que la descarga usa
// `fetch` directo. El emisor está OBLIGADO a conservar ambos archivos, de modo
// que un fallo aquí no puede quedarse en silencio: siempre se lanza con el
// mensaje real de la API.

async function requestFile(path: string): Promise<Response> {
  const { accessToken, selectedBranchId } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (selectedBranchId) headers["x-branch-id"] = selectedBranchId;
  return fetch(`${API_URL}${path}`, { headers });
}

async function fetchInvoiceFile(path: string): Promise<Blob> {
  let res = await requestFile(path);

  if (res.status === 401) {
    // `apiFetch` sabe renovar el token (y deduplica renovaciones simultáneas).
    // Se le pide algo barato para forzar la renovación y se reintenta una vez.
    await apiFetch("/api/invoices/pendientes-sunat").catch(() => undefined);
    res = await requestFile(path);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || contentType.includes("application/json")) {
    let message = "No se pudo descargar el archivo";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // Cuerpo ilegible: se queda el mensaje genérico.
    }
    throw new Error(message);
  }

  return res.blob();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Safari necesita que la URL siga viva durante el click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Descarga el XML UBL firmado del comprobante. */
export async function downloadInvoiceXml(invoice: Invoice): Promise<void> {
  const blob = await fetchInvoiceFile(`/api/invoices/${invoice.id}/xml`);
  saveBlob(blob, `${invoice.series}-${invoice.number}.xml`);
}

/** Descarga la Constancia de Recepción (CDR) devuelta por SUNAT. */
export async function downloadInvoiceCdr(invoice: Invoice): Promise<void> {
  const blob = await fetchInvoiceFile(`/api/invoices/${invoice.id}/cdr`);
  saveBlob(blob, `R-${invoice.series}-${invoice.number}.xml`);
}

// ───────────────────────────────────────────────────────────────────────────
// Etiquetas compartidas
// ───────────────────────────────────────────────────────────────────────────

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  boleta: "Boleta",
  factura: "Factura",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
};

export const SUNAT_STATUS_LABELS: Record<SunatStatus, string> = {
  pending: "Pendiente de envío",
  sent: "Enviado, esperando respuesta",
  accepted: "Aceptado por SUNAT",
  observed: "Aceptado con observaciones",
  rejected: "Rechazado por SUNAT",
  voided: "Anulado",
  error: "Error de envío",
};

/**
 * Tono de color por estado. El cajero tiene que distinguir de un vistazo lo que
 * está resuelto de lo que le va a costar una multa.
 */
export const SUNAT_STATUS_TONE: Record<SunatStatus, "good" | "warn" | "bad" | "neutral"> = {
  pending: "warn",
  sent: "warn",
  accepted: "good",
  observed: "good",
  rejected: "bad",
  voided: "neutral",
  error: "bad",
};
