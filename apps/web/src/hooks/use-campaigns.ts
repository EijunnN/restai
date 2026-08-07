"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "@/lib/fetcher";

// ---------------------------------------------------------------------------
// Tipos del módulo de campañas
// ---------------------------------------------------------------------------

export type CampaignStatus = "draft" | "active" | "paused" | "ended";

/** Campaña tal como la devuelve la API (columnas en snake_case). */
export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  multiplier: number;
  bonus_points: number;
  tier_id: string | null;
  created_at: string | null;
}

/**
 * Cuerpo de creación. La API valida `startsAt`/`endsAt` con `z.string().datetime()`
 * y el resto de opcionales SIN `.nullable()`: mandar `null` en una creación
 * devuelve 400. Por eso las claves vacías se OMITEN en vez de enviarse nulas.
 */
export interface CreateCampaignInput {
  name: string;
  description?: string;
  status?: CampaignStatus;
  startsAt?: string;
  endsAt?: string;
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  multiplier?: number;
  bonusPoints?: number;
  tierId?: string;
}

/** Cuerpo de actualización: aquí la API sí acepta `null` para limpiar un campo. */
export interface UpdateCampaignInput {
  id: string;
  name?: string;
  description?: string | null;
  status?: CampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  daysOfWeek?: number[];
  startTime?: string | null;
  endTime?: string | null;
  multiplier?: number;
  bonusPoints?: number;
  tierId?: string | null;
}

/**
 * Filtros de segmentación soportados por el backend
 * (apps/api/src/services/campaign.service.ts → SegmentFilter).
 *
 * `marketingOptIn` y `requireEmail` NO se exponen: el servidor los fuerza a
 * `true` en el envío (consentimiento obligatorio, Ley 29733) y la
 * previsualización los usa para calcular el alcance real.
 */
export interface SegmentFilter {
  /** uuid de nivel, o el literal "none" para clientes sin nivel. */
  tierId?: string;
  minPoints?: number;
  maxPoints?: number;
  /** Última visita anterior a N días. */
  lastVisitBeforeDays?: number;
  /** Junto a `lastVisitBeforeDays`: incluir a quien nunca pidió. */
  includeNeverVisited?: boolean;
  /** Cumpleaños en este mes (1-12). */
  birthdayMonth?: number;
}

export interface AudienceSample {
  id: string;
  name: string;
  email: string | null;
  marketing_opt_in: boolean;
  points_balance: number;
  tier_id: string | null;
  tier_name: string | null;
  /** ISO 8601 con offset, o null si nunca completó un pedido. */
  last_visit_at: string | null;
}

export interface CampaignAudience {
  campaign: { id: string; name: string; status: string };
  filter: SegmentFilter;
  /** Clientes que cumplen el segmento. */
  total: number;
  /** De esos, a cuántos se les puede escribir (correo + consentimiento). */
  reachable: number;
  /** total - reachable: la cifra que justifica pedir consentimiento en sala. */
  unreachable: number;
  sample: AudienceSample[];
}

export interface SendCampaignInput {
  subject?: string;
  title?: string;
  message?: string;
  couponId?: string | null;
  segment?: SegmentFilter;
  maxRecipients?: number;
}

export interface SendCampaignResult {
  campaignId: string;
  /** Clientes alcanzables del segmento (con correo y consentimiento). */
  audience: number;
  /** Correos realmente encolados en este envío. */
  queued: number;
  couponCode: string | null;
  message: string;
}

/** Techo de destinatarios que aplica el servidor cuando no se manda otro. */
export const DEFAULT_MAX_RECIPIENTS = 2000;

// ---------------------------------------------------------------------------
// Listado y CRUD
// ---------------------------------------------------------------------------

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => apiFetch<Campaign[]>("/api/campaigns"),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation<Campaign, ApiError, CreateCampaignInput>({
    mutationFn: (data) =>
      apiFetch<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation<Campaign, ApiError, UpdateCampaignInput>({
    mutationFn: ({ id, ...data }) =>
      apiFetch<Campaign>(`/api/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation<{ deleted: boolean }, ApiError, string>({
    mutationFn: (id) =>
      apiFetch<{ deleted: boolean }>(`/api/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

// ---------------------------------------------------------------------------
// Audiencia y envío
// ---------------------------------------------------------------------------

/** Serializa un segmento como query string (todo viaja como texto). */
export function segmentToQuery(filter: SegmentFilter, sample?: number): string {
  const params = new URLSearchParams();
  if (filter.tierId) params.set("tierId", filter.tierId);
  if (filter.minPoints !== undefined) params.set("minPoints", String(filter.minPoints));
  if (filter.maxPoints !== undefined) params.set("maxPoints", String(filter.maxPoints));
  if (filter.lastVisitBeforeDays !== undefined) {
    params.set("lastVisitBeforeDays", String(filter.lastVisitBeforeDays));
    // Solo tiene sentido acompañando al filtro de última visita.
    params.set("includeNeverVisited", filter.includeNeverVisited ? "true" : "false");
  }
  if (filter.birthdayMonth !== undefined) {
    params.set("birthdayMonth", String(filter.birthdayMonth));
  }
  if (sample !== undefined) params.set("sample", String(sample));
  return params.toString();
}

/**
 * Previsualiza la audiencia de una campaña SIN enviar nada.
 *
 * `filter` es null hasta que el dueño PULSA "Previsualizar": la consulta no se
 * dispara sola al teclear un filtro, y el botón de enviar solo se habilita
 * cuando lo que hay en pantalla coincide con el segmento previsualizado. Así
 * nunca se envía un correo contra un conteo que ya no corresponde.
 */
export function useCampaignAudience(
  campaignId: string | null,
  filter: SegmentFilter | null,
  sample = 8,
) {
  return useQuery<CampaignAudience, ApiError>({
    queryKey: ["campaigns", campaignId, "audience", filter, sample],
    queryFn: () =>
      apiFetch<CampaignAudience>(
        `/api/campaigns/${campaignId}/audience?${segmentToQuery(filter ?? {}, sample)}`,
      ),
    enabled: !!campaignId && filter !== null,
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

/**
 * Anuncia la campaña por correo al segmento. El envío es ASÍNCRONO: un 200
 * significa "encolado", no "entregado".
 *
 * Errores esperables que la pantalla debe mostrar tal cual (no reintentar):
 * 409 SEND_IN_COOLDOWN, 409 CAMPAIGN_ENDED, 409 COUPON_NOT_AVAILABLE,
 * 404 NOT_FOUND / COUPON_NOT_FOUND.
 */
export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation<
    SendCampaignResult,
    ApiError,
    { id: string; body: SendCampaignInput }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<SendCampaignResult>(`/api/campaigns/${id}/send`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
