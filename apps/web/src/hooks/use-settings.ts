"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

/**
 * Configuración de la organización, de la sede y del emisor electrónico (SUNAT).
 *
 * Los tres bloques viven en el mismo módulo porque comparten pantalla, pero
 * hablan con APIs distintas: /api/settings (org y sede), /api/branches (alta y
 * edición de sedes) y /api/sunat (facturación electrónica).
 */

// ───────────────────────────────────────────────────────────────────────────
// Organización y sede
// ───────────────────────────────────────────────────────────────────────────

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  /** RUC del negocio. Sin él el ticket sale sin el dato que lo identifica. */
  ruc: string | null;
  /** Razón social inscrita en SUNAT (puede diferir del nombre comercial). */
  legal_name: string | null;
  settings: Record<string, unknown> | null;
}

export interface BranchSettings {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  /** IGV en centésimas de punto: 1800 = 18,00%. */
  tax_rate: number;
  timezone: string | null;
  currency: string;
  is_active: boolean;
  /** `dynamic` o `static`. Columna propia, no una clave de `settings`. */
  menu_mode?: string;
  /** Identificador único global de la sede, para su carta pública. */
  public_code?: string;
  settings: Record<string, any> | null;
}

export interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone?: string | null;
  is_active?: boolean;
  /** Único global: la carta pública de la sede se resuelve por aquí. */
  public_code?: string;
  menu_mode?: string;
}

export interface UpdateOrgInput {
  name?: string;
  logoUrl?: string | null;
  ruc?: string | null;
  legalName?: string | null;
  settings?: Record<string, unknown>;
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  phone?: string;
  taxRate?: number;
  currency?: string;
  /** Se FUSIONA con los ajustes guardados en el servidor, no los reemplaza. */
  settings?: Record<string, unknown>;
  inventoryEnabled?: boolean;
  waiterTableAssignmentEnabled?: boolean;
  /** `dynamic` (se pide desde la mesa) o `static` (el QR solo enseña la carta). */
  menuMode?: "dynamic" | "static";
}

export function useOrgSettings() {
  return useQuery<OrgSettings>({
    queryKey: ["settings", "org"],
    queryFn: () => apiFetch<OrgSettings>("/api/settings/org", { includeBranchHeader: false }),
  });
}

export function useBranchSettings() {
  return useQuery<BranchSettings>({
    queryKey: ["settings", "branch"],
    queryFn: () => apiFetch<BranchSettings>("/api/settings/branch"),
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation<OrgSettings, Error, UpdateOrgInput>({
    mutationFn: (data) =>
      apiFetch<OrgSettings>("/api/settings/org", {
        method: "PATCH",
        body: JSON.stringify(data),
        includeBranchHeader: false,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "org"] });
    },
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation<BranchSettings, Error, UpdateBranchInput>({
    mutationFn: (data) =>
      apiFetch<BranchSettings>("/api/settings/branch", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "branch"] });
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
  });
}

export function useBranches() {
  return useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: () => apiFetch<Branch[]>("/api/branches", { includeBranchHeader: false }),
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation<
    Branch,
    Error,
    { name: string; slug: string; address?: string; phone?: string; currency?: string; taxRate?: number }
  >({
    mutationFn: (data) =>
      apiFetch<Branch>("/api/branches", {
        method: "POST",
        body: JSON.stringify(data),
        includeBranchHeader: false,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["branches"] });
    },
  });
}

/**
 * Resultado de PATCH /api/branches/:id.
 *
 * `qr_invalidated` y `affected_tables` viajan al NIVEL RAÍZ, hermanos de `data`:
 * por eso este hook usa `apiFetchWithMeta` y no `apiFetch` (que se queda solo con
 * `data` y tiraría el aviso más importante de la pantalla).
 */
export interface BranchUpdateResult {
  data: Branch;
  qr_invalidated: boolean;
  affected_tables: number;
}

export function useUpdateBranchById() {
  const qc = useQueryClient();
  return useMutation<
    BranchUpdateResult,
    Error,
    { id: string; name?: string; slug?: string; address?: string; phone?: string }
  >({
    mutationFn: ({ id, ...data }) =>
      apiFetchWithMeta<BranchUpdateResult>(`/api/branches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        includeBranchHeader: false,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["branches"] });
      void qc.invalidateQueries({ queryKey: ["settings", "branch"] });
      // Los QR de las mesas cuelgan del slug de la sede: si cambió, hay que
      // reimprimirlos y la pantalla de mesas debe reflejar el nuevo enlace.
      void qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SUNAT: emisor electrónico
// ───────────────────────────────────────────────────────────────────────────

export interface SunatSeries {
  /** Serie de boletas: B + 3 alfanuméricos (ej. B001). */
  boleta: string;
  /** Serie de facturas: F + 3 alfanuméricos (ej. F001). */
  factura: string;
  /** Serie de notas de crédito que afectan a una boleta (ej. BC01). */
  nota_credito_boleta: string;
  /** Serie de notas de crédito que afectan a una factura (ej. FC01). */
  nota_credito_factura: string;
}

export interface SunatCertificadoInfo {
  presente: boolean;
  formato: string;
  valido: boolean;
  motivo?: string;
  sujeto?: string;
  emisor?: string;
  validoDesde?: string;
  validoHasta?: string;
  /** Días que faltan para que caduque (negativo si ya venció). */
  diasParaVencer?: number;
}

/**
 * Vista de la configuración SIN secretos.
 *
 * Cuando `configurado` es false solo llegan `series`, `cifrado_disponible` y
 * `advertencias`: es el estado inicial, no un error.
 */
export interface SunatConfig {
  configurado: boolean;
  id?: string;
  organization_id?: string;
  ruc?: string;
  razon_social?: string;
  nombre_comercial?: string | null;
  ubigeo?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  ambiente?: "beta" | "production" | string;
  endpoint_override?: string | null;
  endpoint_efectivo?: string;
  enabled?: boolean;
  tiene_credenciales_sol?: boolean;
  /** Usuario SOL enmascarado. La clave NUNCA se devuelve. */
  usuario_sol_enmascarado?: string | null;
  certificado?: SunatCertificadoInfo;
  secretos_actualizados_en?: string;
  created_at?: string;
  updated_at?: string;
  series: SunatSeries | null;
  advertencias: string[];
  /** false = el servidor no tiene SUNAT_ENCRYPTION_KEY y no puede guardar secretos. */
  cifrado_disponible: boolean;
}

/**
 * Cuerpo de PUT /api/sunat/config.
 *
 * `ruc` y `razonSocial` son obligatorios. Omitir un secreto CONSERVA el guardado;
 * omitir `ambiente` o `certificateFormat` conserva el valor anterior. En cambio
 * los campos fiscales que se omitan se guardan como null: el formulario debe
 * enviarlos siempre todos.
 */
export interface SunatConfigInput {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string | null;
  ubigeo?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  ambiente?: "beta" | "production";
  endpointOverride?: string | null;
  solUser?: string;
  solPass?: string;
  /** PFX/P12 en base64, o el PEM completo (clave privada + certificado). */
  certificate?: string;
  certificatePassword?: string | null;
  certificateFormat?: "pfx" | "pem";
  enabled?: boolean;
}

export interface SunatTestResult {
  /** Veredicto del diagnóstico. La petición responde 200 aunque esto sea false. */
  ok: boolean;
  ambiente: string;
  endpoint: string;
  habilitado: boolean;
  certificado: SunatCertificadoInfo;
  firma: { ok: boolean; motivo?: string };
  conexion: { ok: boolean; codigo?: string; motivo?: string };
  credenciales: { ok: boolean; codigo?: string; motivo?: string };
  /** Resumen en una frase, listo para mostrar. */
  mensaje: string;
  duracion_ms: number;
}

export function useSunatConfig(enabled = true) {
  return useQuery<SunatConfig>({
    queryKey: ["sunat", "config"],
    queryFn: () => apiFetch<SunatConfig>("/api/sunat/config"),
    enabled,
    // Los secretos no cambian solos: no tiene sentido reconsultar al enfocar.
    refetchOnWindowFocus: false,
  });
}

export function useSaveSunatConfig() {
  const qc = useQueryClient();
  return useMutation<SunatConfig, Error, SunatConfigInput>({
    mutationFn: (data) =>
      apiFetch<SunatConfig>("/api/sunat/config", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sunat"] });
      // El estado de la facturación cambia lo que la pantalla de comprobantes
      // puede ofrecer (declarar, reenviar...).
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

/**
 * Prueba la configuración contra SUNAT sin emitir nada.
 *
 * OJO: un diagnóstico negativo NO es un error de red — llega como 200 con
 * `ok: false`. Solo lanza si ni siquiera hay configuración que probar.
 */
export function useTestSunatConfig() {
  return useMutation<SunatTestResult, Error, void>({
    mutationFn: () => apiFetch<SunatTestResult>("/api/sunat/config/test", { method: "POST" }),
  });
}

export function useSunatSeries(enabled = true) {
  return useQuery<SunatSeries>({
    queryKey: ["sunat", "series"],
    queryFn: () => apiFetch<SunatSeries>("/api/sunat/series"),
    enabled,
    refetchOnWindowFocus: false,
  });
}

export function useSaveSunatSeries() {
  const qc = useQueryClient();
  return useMutation<SunatSeries, Error, Partial<SunatSeries>>({
    mutationFn: (data) =>
      apiFetch<SunatSeries>("/api/sunat/series", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sunat"] });
    },
  });
}
