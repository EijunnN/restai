"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  AlertTriangle,
  Gift,
  Info,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import {
  useReferralConfig,
  useUpdateReferralConfig,
  type ReferralConfig,
} from "@/hooks/use-referrals";

const MAX_POINTS = 100_000;
const MAX_CAP = 10_000;

type FormState = {
  referrerPoints: string;
  refereePoints: string;
  capEnabled: boolean;
  cap: string;
};

function toForm(config: ReferralConfig): FormState {
  return {
    referrerPoints: String(config.referrerPoints ?? 0),
    refereePoints: String(config.refereePoints ?? 0),
    capEnabled: config.monthlyCapPerReferrer != null,
    cap: config.monthlyCapPerReferrer != null ? String(config.monthlyCapPerReferrer) : "5",
  };
}

/**
 * Valida un campo de puntos: entero >= 0 y dentro del tope de cordura del
 * servidor. Devuelve el mensaje de error, o null si el valor es válido.
 */
function validatePoints(raw: string, label: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return `Indica cuántos puntos recibe ${label} (0 si no quieres premiarlo).`;
  if (!/^\d+$/.test(trimmed)) return "Escribe un número entero, sin decimales ni signos.";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "Escribe un número entero válido.";
  if (value > MAX_POINTS) return `El máximo es ${MAX_POINTS.toLocaleString("es-PE")} puntos.`;
  return null;
}

function validateCap(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Indica el tope mensual o desactiva el límite.";
  if (!/^\d+$/.test(trimmed)) return "Escribe un número entero, sin decimales ni signos.";
  const value = Number(trimmed);
  if (value < 1) return "El tope debe ser 1 o más. Para quitarlo, desactiva el límite.";
  if (value > MAX_CAP) return `El máximo es ${MAX_CAP.toLocaleString("es-PE")} referidos al mes.`;
  return null;
}

function CardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="h-5 w-56 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-10 w-40 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

/**
 * Configuración del programa de referidos.
 *
 * Hasta ahora los puntos de referido solo se leían y nadie los escribía nunca:
 * todo referido pagaba 0 y el módulo entero era decorativo. Este formulario es
 * el que convierte la pantalla en un programa que de verdad premia.
 */
export function ReferralConfigCard() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = hasPermission(role, "loyalty:update");

  const { data: config, isLoading, error, refetch, isFetching } = useReferralConfig();
  const updateConfig = useUpdateReferralConfig();

  const [form, setForm] = useState<FormState | null>(null);
  const [touched, setTouched] = useState(false);

  // Re-sincroniza el formulario con lo que hay guardado cada vez que llega
  // configuración nueva (primera carga o refetch tras guardar).
  useEffect(() => {
    if (config) setForm(toForm(config));
  }, [config]);

  if (isLoading) return <CardSkeleton />;

  if (error) {
    return (
      <Card>
        <CardContent className="p-5">
          <div
            role="alert"
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-destructive">
              No se pudo cargar la configuración de referidos: {(error as Error).message}
            </p>
            <Button
              variant="outline"
              className="h-10 shrink-0"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // data: null no es un error — es que todavía no hay programa activo.
  if (!config) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">
              Crea primero un programa de fidelización
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Los puntos de referido se pagan desde el programa activo. Sin un programa
              de fidelización activo no hay puntos que repartir.
            </p>
          </div>
          <Link href="/loyalty">
            <Button className="h-10">Ir a Fidelización</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!form) return <CardSkeleton />;

  const referrerError = validatePoints(form.referrerPoints, "quien invita");
  const refereeError = validatePoints(form.refereePoints, "el invitado");
  const capError = form.capEnabled ? validateCap(form.cap) : null;
  const hasErrors = !!(referrerError || refereeError || capError);

  const savedBothZero = config.referrerPoints === 0 && config.refereePoints === 0;
  const savedOneZero =
    !savedBothZero && (config.referrerPoints === 0 || config.refereePoints === 0);

  const draftBothZero =
    form.referrerPoints.trim() === "0" && form.refereePoints.trim() === "0";

  const dirty =
    String(config.referrerPoints) !== form.referrerPoints.trim() ||
    String(config.refereePoints) !== form.refereePoints.trim() ||
    (config.monthlyCapPerReferrer != null) !== form.capEnabled ||
    (form.capEnabled && String(config.monthlyCapPerReferrer ?? "") !== form.cap.trim());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors || !form) return;

    updateConfig.mutate(
      {
        referrerPoints: Number(form.referrerPoints.trim()),
        refereePoints: Number(form.refereePoints.trim()),
        // Explícito siempre: null quita el tope, un entero lo fija.
        monthlyCapPerReferrer: form.capEnabled ? Number(form.cap.trim()) : null,
      },
      {
        onSuccess: (data) => {
          setTouched(false);
          toast.success(
            data.referrerPoints === 0 && data.refereePoints === 0
              ? "Guardado, pero el programa quedó en 0 puntos: no premiará a nadie"
              : "Guardado. Se aplicará a los referidos que se registren desde ahora",
          );
        },
        onError: (err) =>
          toast.error(
            `No se pudo guardar la configuración de referidos: ${(err as Error).message}`,
          ),
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Gift className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">Cuánto paga un referido</p>
              <p className="text-sm text-muted-foreground">
                Puntos que se otorgan cuando el invitado completa su primer pedido.
                Programa activo: <span className="font-medium">{config.programName}</span>.
              </p>
              {/*
                El importe se SELLA en el momento en que el invitado se registra
                con el código (referral.service.ts → registerReferral), no cuando
                paga. Sin decirlo, el dueño sube los puntos, ve completarse los
                referidos que ya estaban abiertos y concluye que no funciona.
              */}
              <p className="mt-1 text-xs text-muted-foreground">
                Se aplica a los referidos que se registren a partir de ahora: los que ya
                están pendientes conservan los puntos con los que se registraron.
              </p>
            </div>
          </div>
        </div>

        {savedBothZero && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Con 0 puntos, el programa de referidos no premia a nadie: tus clientes
              pueden invitar, pero ni ellos ni sus invitados reciben nada. Asigna puntos
              para que el programa funcione.
            </p>
          </div>
        )}

        {savedOneZero && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {config.referrerPoints === 0
                ? "Quien invita no recibe nada: sin premio para el promotor, casi nadie comparte su código."
                : "El invitado no recibe nada: sin premio de bienvenida, el código pierde gancho."}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ref-referrer-points">Puntos para quien invita</Label>
              <Input
                id="ref-referrer-points"
                className="h-10"
                inputMode="numeric"
                autoComplete="off"
                value={form.referrerPoints}
                disabled={!canEdit || updateConfig.isPending}
                aria-invalid={touched && !!referrerError}
                aria-describedby={
                  touched && referrerError ? "ref-referrer-points-error" : undefined
                }
                onChange={(e) =>
                  setForm((p) => (p ? { ...p, referrerPoints: e.target.value } : p))
                }
              />
              {touched && referrerError ? (
                <p
                  id="ref-referrer-points-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {referrerError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  El cliente que comparte su código.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ref-referee-points">Puntos para el invitado</Label>
              <Input
                id="ref-referee-points"
                className="h-10"
                inputMode="numeric"
                autoComplete="off"
                value={form.refereePoints}
                disabled={!canEdit || updateConfig.isPending}
                aria-invalid={touched && !!refereeError}
                aria-describedby={
                  touched && refereeError ? "ref-referee-points-error" : undefined
                }
                onChange={(e) =>
                  setForm((p) => (p ? { ...p, refereePoints: e.target.value } : p))
                }
              />
              {touched && refereeError ? (
                <p
                  id="ref-referee-points-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {refereeError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  El cliente nuevo, al completar su primer pedido.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Tope antifraude</p>
            </div>

            <label
              htmlFor="ref-cap-enabled"
              className={`flex h-10 items-center gap-3 ${
                canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-70"
              }`}
            >
              <input
                id="ref-cap-enabled"
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-input accent-primary"
                checked={form.capEnabled}
                disabled={!canEdit || updateConfig.isPending}
                onChange={(e) =>
                  setForm((p) => (p ? { ...p, capEnabled: e.target.checked } : p))
                }
              />
              <span className="text-sm text-foreground">
                Limitar cuántos referidos premiados al mes por cliente
              </span>
            </label>

            {form.capEnabled && (
              <div className="max-w-xs space-y-2 pl-8">
                <Label htmlFor="ref-cap">Máximo de referidos premiados al mes</Label>
                <Input
                  id="ref-cap"
                  className="h-10"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.cap}
                  disabled={!canEdit || updateConfig.isPending}
                  aria-invalid={touched && !!capError}
                  aria-describedby={touched && capError ? "ref-cap-error" : undefined}
                  onChange={(e) => setForm((p) => (p ? { ...p, cap: e.target.value } : p))}
                />
                {touched && capError ? (
                  <p id="ref-cap-error" role="alert" className="text-xs text-destructive">
                    {capError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Quien invita cobra hasta ese número de referidos al mes; pasado ese
                    tope deja de cobrar, pero el invitado sigue recibiendo sus puntos.
                  </p>
                )}
              </div>
            )}

            {!form.capEnabled && (
              <p className="pl-8 text-xs text-muted-foreground">
                Sin tope: un mismo cliente puede cobrar por todos los amigos que traiga.
              </p>
            )}
          </div>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                className="h-10"
                disabled={updateConfig.isPending || !dirty}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateConfig.isPending ? "Guardando..." : "Guardar configuración"}
              </Button>
              {dirty && !updateConfig.isPending && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => {
                    setForm(toForm(config));
                    setTouched(false);
                  }}
                >
                  Descartar cambios
                </Button>
              )}
              {draftBothZero && dirty && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Vas a dejar el programa sin premio para nadie.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Solo un administrador puede cambiar los puntos de referido.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
