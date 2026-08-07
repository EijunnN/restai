"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "@/lib/fetcher";

export interface ReferralRow {
  id: string;
  status: "pending" | "completed";
  code: string;
  referrer_points: number;
  referee_points: number;
  referrer_name: string | null;
  referee_name: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface ReferralStats {
  total: number;
  completed: number;
  pending: number;
  points_awarded: number;
}

export interface ReferralsResponse {
  referrals: ReferralRow[];
  stats: ReferralStats;
}

/**
 * Admin referrals list + aggregate stats (GET /api/referrals).
 * Returns the full set of referral rows (referrer, referee, status, date)
 * plus headline counters for the stats cards.
 */
export function useReferrals() {
  return useQuery<ReferralsResponse>({
    queryKey: ["referrals"],
    queryFn: () => apiFetch<ReferralsResponse>("/api/referrals"),
  });
}

// ---------------------------------------------------------------------------
// Configuración del programa de referidos
// ---------------------------------------------------------------------------

/**
 * Lo que paga un referido. Los puntos viven en el programa de fidelización
 * activo; el tope mensual es antifraude y vive en los ajustes de la organización
 * (null = sin tope).
 */
export interface ReferralConfig {
  programId: string;
  programName: string;
  referrerPoints: number;
  refereePoints: number;
  monthlyCapPerReferrer: number | null;
}

/**
 * Configuración vigente (GET /api/referrals/config).
 *
 * `data: null` NO es un error: significa que la organización todavía no tiene
 * un programa de fidelización activo en el que configurar los referidos.
 */
export function useReferralConfig() {
  return useQuery<ReferralConfig | null>({
    queryKey: ["referrals", "config"],
    queryFn: () => apiFetch<ReferralConfig | null>("/api/referrals/config"),
  });
}

export interface ReferralConfigInput {
  referrerPoints: number;
  refereePoints: number;
  /**
   * OJO con la semántica del tope: omitir la clave = no se toca;
   * `null` = se quita el tope; entero >= 1 = tope mensual por promotor.
   */
  monthlyCapPerReferrer?: number | null;
}

/**
 * Guarda los puntos de referido (PUT /api/referrals/config).
 *
 * Errores esperables: 404 PROGRAM_NOT_FOUND (no hay programa activo),
 * 400 INVALID_POINTS / INVALID_CAP.
 */
export function useUpdateReferralConfig() {
  const qc = useQueryClient();
  return useMutation<ReferralConfig, ApiError, ReferralConfigInput>({
    mutationFn: (input) =>
      apiFetch<ReferralConfig>("/api/referrals/config", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      // La respuesta ya trae la configuración final: se pinta sin esperar al
      // refetch, y aun así se invalida por si otro administrador tocó algo.
      qc.setQueryData(["referrals", "config"], data);
      qc.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
