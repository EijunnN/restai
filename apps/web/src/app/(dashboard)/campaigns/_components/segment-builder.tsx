"use client";

import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import { Users } from "lucide-react";
import {
  emptySegmentForm,
  monthNames,
  segmentPresets,
  type SegmentForm,
} from "./campaign-utils";

export interface TierOption {
  id: string;
  name: string;
  programName?: string;
}

function samePreset(a: SegmentForm, b: SegmentForm): boolean {
  return (
    a.tierId === b.tierId &&
    a.minPoints.trim() === b.minPoints.trim() &&
    a.maxPoints.trim() === b.maxPoints.trim() &&
    a.lastVisitBeforeDays.trim() === b.lastVisitBeforeDays.trim() &&
    a.includeNeverVisited === b.includeNeverVisited &&
    a.birthdayMonth.trim() === b.birthdayMonth.trim()
  );
}

/**
 * Constructor de segmento.
 *
 * Los atajos de arriba resuelven en un clic las campañas que de verdad
 * recuperan ingresos ("clientes que no vienen hace 30 días"); los campos de
 * abajo permiten afinar sin salir de la misma pantalla.
 */
export function SegmentBuilder({
  value,
  onChange,
  tiers,
  disabled,
  error,
}: {
  value: SegmentForm;
  onChange: (next: SegmentForm) => void;
  tiers: TierOption[];
  disabled?: boolean;
  error?: string | null;
}) {
  function patch(partial: Partial<SegmentForm>) {
    onChange({ ...value, ...partial });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">1. ¿A quién le llega?</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        {segmentPresets.map((preset) => {
          const built = preset.build();
          const active =
            preset.id === "all"
              ? samePreset(value, emptySegmentForm)
              : samePreset(value, built);
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(built)}
              className={`h-10 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="seg-tier">Nivel</Label>
          <Select
            value={value.tierId || "all"}
            onValueChange={(v) => patch({ tierId: v === "all" ? "" : v })}
            disabled={disabled}
          >
            <SelectTrigger id="seg-tier" className="h-10">
              <SelectValue placeholder="Todos los niveles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los niveles</SelectItem>
              <SelectItem value="none">Sin nivel asignado</SelectItem>
              {tiers.map((tier) => (
                <SelectItem key={tier.id} value={tier.id}>
                  {tier.name}
                  {tier.programName ? ` (${tier.programName})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seg-birthday">Cumpleaños del mes</Label>
          <Select
            value={value.birthdayMonth || "any"}
            onValueChange={(v) => patch({ birthdayMonth: v === "any" ? "" : v })}
            disabled={disabled}
          >
            <SelectTrigger id="seg-birthday" className="h-10">
              <SelectValue placeholder="Cualquier mes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquier mes</SelectItem>
              {monthNames.map((name, i) => (
                <SelectItem key={name} value={String(i + 1)}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seg-min-points">Puntos mínimos</Label>
          <Input
            id="seg-min-points"
            className="h-10"
            inputMode="numeric"
            placeholder="Sin mínimo"
            value={value.minPoints}
            disabled={disabled}
            onChange={(e) => patch({ minPoints: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="seg-max-points">Puntos máximos</Label>
          <Input
            id="seg-max-points"
            className="h-10"
            inputMode="numeric"
            placeholder="Sin máximo"
            value={value.maxPoints}
            disabled={disabled}
            onChange={(e) => patch({ maxPoints: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="seg-last-visit">No vienen desde hace (días)</Label>
        <Input
          id="seg-last-visit"
          className="h-10 sm:max-w-[12rem]"
          inputMode="numeric"
          placeholder="Sin filtro"
          value={value.lastVisitBeforeDays}
          disabled={disabled}
          onChange={(e) => patch({ lastVisitBeforeDays: e.target.value })}
        />
        {value.lastVisitBeforeDays.trim() !== "" && (
          <label
            htmlFor="seg-include-never"
            className={`flex h-10 items-center gap-3 ${
              disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
          >
            <input
              id="seg-include-never"
              type="checkbox"
              className="h-5 w-5 shrink-0 rounded border-input accent-primary"
              checked={value.includeNeverVisited}
              disabled={disabled}
              onChange={(e) => patch({ includeNeverVisited: e.target.checked })}
            />
            <span className="text-sm text-foreground">
              Incluir también a quienes nunca han pedido
            </span>
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
