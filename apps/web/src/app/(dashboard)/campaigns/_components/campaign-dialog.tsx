"use client";

import { useEffect, useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { DatePicker } from "@restai/ui/components/date-picker";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateCampaign,
  useUpdateCampaign,
  type Campaign,
  type CampaignStatus,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from "@/hooks/use-campaigns";
import { useLoyaltyPrograms } from "@/hooks/use-loyalty";
import { daysOfWeek, isoToLimaDate, limaDayEndIso, limaDayStartIso } from "./campaign-utils";

type FormState = {
  name: string;
  description: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  multiplier: string;
  bonusPoints: string;
  tierId: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    status: "draft",
    startsAt: "",
    endsAt: "",
    daysOfWeek: [],
    startTime: "",
    endTime: "",
    multiplier: "100",
    bonusPoints: "0",
    tierId: "",
  };
}

function campaignToForm(c: Campaign): FormState {
  return {
    name: c.name ?? "",
    description: c.description ?? "",
    status: (c.status as CampaignStatus) ?? "draft",
    startsAt: isoToLimaDate(c.starts_at),
    endsAt: isoToLimaDate(c.ends_at),
    daysOfWeek: Array.isArray(c.days_of_week) ? c.days_of_week.map(Number) : [],
    startTime: c.start_time ?? "",
    endTime: c.end_time ?? "",
    multiplier: String(c.multiplier ?? 100),
    bonusPoints: String(c.bonus_points ?? 0),
    tierId: c.tier_id ?? "",
  };
}

function parseIntOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

type Errors = Partial<Record<"name" | "multiplier" | "bonusPoints" | "dates" | "times", string>>;

function validate(form: FormState): Errors {
  const errors: Errors = {};

  if (!form.name.trim()) errors.name = "Ponle un nombre a la campaña.";

  const multiplier = parseIntOrNull(form.multiplier);
  if (multiplier === null) {
    errors.multiplier = "Escribe un número entero (100 = sin extra).";
  } else if (multiplier < 100) {
    errors.multiplier = "Debe ser 100 o más: por debajo restarías puntos al cliente.";
  } else if (multiplier > 10_000) {
    errors.multiplier = "El máximo es 10000 (100x). Revisa el número.";
  }

  const bonus = parseIntOrNull(form.bonusPoints);
  if (bonus === null) errors.bonusPoints = "Escribe un número entero mayor o igual a 0.";
  else if (bonus > 100_000) errors.bonusPoints = "El máximo es 100000 puntos.";

  if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) {
    errors.dates = "La fecha de fin no puede ser anterior a la de inicio.";
  }

  if (form.startTime && form.endTime && form.startTime === form.endTime) {
    errors.times = "La hora de inicio y la de fin no pueden ser la misma.";
  }

  return errors;
}

/**
 * Alta y edición de campañas.
 *
 * OJO con el contrato: en la CREACIÓN los campos opcionales de la API no admiten
 * `null` (`z.string().optional()`, no `.nullable()`), así que las claves vacías
 * se omiten; en la EDICIÓN sí se manda `null` para limpiar de verdad un campo.
 * Las fechas viajan como instante ISO en Z calculado sobre el día civil de Lima.
 */
export function CampaignDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: Campaign | null;
}) {
  const isEdit = !!editData;
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const isPending = isEdit ? updateCampaign.isPending : createCampaign.isPending;

  const { data: programsData } = useLoyaltyPrograms();
  const programs: any[] = Array.isArray(programsData) ? programsData : [];
  // Todos los niveles de todos los programas: una campaña puede acotarse a uno.
  const tiers: any[] = programs.flatMap((p: any) =>
    (p.tiers ?? []).map((t: any) => ({ ...t, programName: p.name })),
  );

  const [form, setForm] = useState<FormState>(() =>
    editData ? campaignToForm(editData) : emptyForm(),
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editData ? campaignToForm(editData) : emptyForm());
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editData?.id]);

  const errors = validate(form);
  const hasErrors = Object.keys(errors).length > 0;

  const multiplier = parseIntOrNull(form.multiplier) ?? 100;
  const bonus = parseIntOrNull(form.bonusPoints) ?? 0;
  const noBenefit = multiplier === 100 && bonus === 0;

  function toggleDay(day: number) {
    setForm((p) => ({
      ...p,
      daysOfWeek: p.daysOfWeek.includes(day)
        ? p.daysOfWeek.filter((d) => d !== day)
        : [...p.daysOfWeek, day],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (hasErrors) return;

    if (isEdit && editData) {
      const payload: UpdateCampaignInput = {
        id: editData.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        startsAt: form.startsAt ? limaDayStartIso(form.startsAt) : null,
        endsAt: form.endsAt ? limaDayEndIso(form.endsAt) : null,
        daysOfWeek: form.daysOfWeek,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        multiplier,
        bonusPoints: bonus,
        tierId: form.tierId || null,
      };

      updateCampaign.mutate(payload, {
        onSuccess: () => {
          onOpenChange(false);
          toast.success("Campaña actualizada");
        },
        onError: (err) =>
          toast.error(`No se pudo actualizar la campaña: ${(err as Error).message}`),
      });
      return;
    }

    // Creación: las claves vacías NO se envían (la API rechaza null aquí).
    const payload: CreateCampaignInput = {
      name: form.name.trim(),
      status: form.status,
      daysOfWeek: form.daysOfWeek,
      multiplier,
      bonusPoints: bonus,
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.startsAt) payload.startsAt = limaDayStartIso(form.startsAt);
    if (form.endsAt) payload.endsAt = limaDayEndIso(form.endsAt);
    if (form.startTime) payload.startTime = form.startTime;
    if (form.endTime) payload.endTime = form.endTime;
    if (form.tierId) payload.tierId = form.tierId;

    createCampaign.mutate(payload, {
      onSuccess: () => {
        setForm(emptyForm());
        onOpenChange(false);
        toast.success("Campaña creada");
      },
      onError: (err) =>
        toast.error(`No se pudo crear la campaña: ${(err as Error).message}`),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar campaña" : "Crear campaña"}</DialogTitle>
          <DialogDescription>
            Define el beneficio de puntos y cuándo se aplica. Después podrás anunciarla
            por correo a un segmento de clientes.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="max-h-[65vh] space-y-4 overflow-y-auto pr-1"
        >
          <div className="space-y-2">
            <Label htmlFor="cmp-name">Nombre *</Label>
            <Input
              id="cmp-name"
              className="h-10"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Ej.: Happy Hour doble puntos"
              aria-invalid={touched && !!errors.name}
            />
            {touched && errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cmp-desc">Descripción</Label>
            <Input
              id="cmp-desc"
              className="h-10"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Se usa como texto del anuncio si no escribes otro"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cmp-status">Estado</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((p) => ({ ...p, status: v as CampaignStatus }))}
            >
              <SelectTrigger id="cmp-status" className="h-10">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="active">Activa</SelectItem>
                <SelectItem value="paused">Pausada</SelectItem>
                <SelectItem value="ended">Finalizada</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Solo las campañas activas otorgan el beneficio de puntos.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fecha de inicio</Label>
              <DatePicker
                value={form.startsAt}
                onChange={(v) => setForm((p) => ({ ...p, startsAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha de fin</Label>
              <DatePicker
                value={form.endsAt}
                onChange={(v) => setForm((p) => ({ ...p, endsAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
          </div>
          {touched && errors.dates && (
            <p role="alert" className="text-xs text-destructive">
              {errors.dates}
            </p>
          )}
          <p className="-mt-2 text-xs text-muted-foreground">
            Se guardan como días completos en horario de Lima: la campaña vale hasta el
            final del día de fin.
          </p>

          <div className="space-y-2">
            <Label>Días de la semana</Label>
            <div className="flex flex-wrap gap-2">
              {daysOfWeek.map((day) => {
                const selected = form.daysOfWeek.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    aria-pressed={selected}
                    aria-label={day.full}
                    className={`h-10 min-w-[3rem] rounded-md border px-3 text-sm font-medium transition-colors ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Sin selección se aplica todos los días.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cmp-start-time">Hora de inicio</Label>
              <Input
                id="cmp-start-time"
                className="h-10"
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmp-end-time">Hora de fin</Label>
              <Input
                id="cmp-end-time"
                className="h-10"
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
              />
            </div>
          </div>
          {touched && errors.times && (
            <p role="alert" className="text-xs text-destructive">
              {errors.times}
            </p>
          )}
          <p className="-mt-2 text-xs text-muted-foreground">
            Hora de Lima (UTC-5). Déjalo vacío para aplicar todo el día.
          </p>

          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Beneficio de puntos</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cmp-mult">Multiplicador (x100)</Label>
                <Input
                  id="cmp-mult"
                  className="h-10"
                  inputMode="numeric"
                  value={form.multiplier}
                  onChange={(e) => setForm((p) => ({ ...p, multiplier: e.target.value }))}
                  aria-invalid={touched && !!errors.multiplier}
                />
                {touched && errors.multiplier ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.multiplier}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    100 = 1x (sin extra); 200 = el doble de puntos.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cmp-bonus">Puntos extra</Label>
                <Input
                  id="cmp-bonus"
                  className="h-10"
                  inputMode="numeric"
                  value={form.bonusPoints}
                  onChange={(e) => setForm((p) => ({ ...p, bonusPoints: e.target.value }))}
                  aria-invalid={touched && !!errors.bonusPoints}
                />
                {touched && errors.bonusPoints ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.bonusPoints}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Puntos fijos que se suman a cada pedido.
                  </p>
                )}
              </div>
            </div>

            {noBenefit && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-900 dark:text-amber-200">
                  Con multiplicador 100 y 0 puntos extra, la campaña no da ningún
                  beneficio: el cliente no notará nada.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cmp-tier">Nivel (opcional)</Label>
            <Select
              value={form.tierId || "all"}
              onValueChange={(v) => setForm((p) => ({ ...p, tierId: v === "all" ? "" : v }))}
            >
              <SelectTrigger id="cmp-tier" className="h-10">
                <SelectValue placeholder="Todos los clientes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {tiers.map((tier: any) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name}
                    {tier.programName ? ` (${tier.programName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Limita el beneficio a los clientes de un nivel concreto.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-10" disabled={isPending}>
              {isEdit
                ? isPending
                  ? "Guardando..."
                  : "Guardar cambios"
                : isPending
                  ? "Creando..."
                  : "Crear campaña"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
