"use client";

import { Button } from "@restai/ui/components/button";
import { Label } from "@restai/ui/components/label";
import { DatePicker } from "@restai/ui/components/date-picker";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import { Download } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";
import { limaTodayRange, limaLastDaysRange, limaCurrentMonthRange } from "@/lib/date";
import type {
  PaymentBucket,
  PaymentListTotals,
  PaymentMethod,
} from "@/hooks/use-payments";

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

/**
 * Cubos del listado.
 *
 * Antes solo existía "todos" y los cobros anulados y los pendientes de delivery
 * se contaban como dinero cobrado: la lista y el resumen del mismo día decían
 * cifras distintas y nadie sabía cuál creer.
 */
const BUCKETS: { value: PaymentBucket; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "collected", label: "Cobrados" },
  { value: "voided", label: "Anulados" },
  { value: "pending", label: "Pendientes" },
];

interface PaymentFiltersProps {
  bucket: PaymentBucket;
  onBucketChange: (bucket: PaymentBucket) => void;
  method: PaymentMethod | "all";
  onMethodChange: (method: PaymentMethod | "all") => void;
  startDate: string;
  endDate: string;
  onRangeChange: (range: { start: string; end: string }) => void;
  search: string;
  onSearchChange: (value: string) => void;
  totals?: PaymentListTotals;
  onExport: () => void;
  exportDisabled: boolean;
}

export function PaymentFilters({
  bucket,
  onBucketChange,
  method,
  onMethodChange,
  startDate,
  endDate,
  onRangeChange,
  search,
  onSearchChange,
  totals,
  onExport,
  exportDisabled,
}: PaymentFiltersProps) {
  /** Importe del rango que corresponde a cada cubo, para el subtítulo del botón. */
  const bucketHint = (value: PaymentBucket): string | null => {
    if (!totals) return null;
    if (value === "collected") return `${totals.collectedCount} · ${formatCurrency(totals.collected)}`;
    if (value === "voided") return `${totals.voidedCount} · ${formatCurrency(totals.voided)}`;
    if (value === "pending") return `${totals.pendingCount} · ${formatCurrency(totals.pending)}`;
    return null;
  };

  const rangeIs = (range: { start: string; end: string }) =>
    range.start === startDate && range.end === endDate;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      {/* Cubos */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrar cobros por estado"
      >
        {BUCKETS.map((b) => {
          const hint = bucketHint(b.value);
          const active = bucket === b.value;
          return (
            <button
              key={b.value}
              type="button"
              aria-pressed={active}
              onClick={() => onBucketChange(b.value)}
              className={cn(
                "h-10 rounded-full border px-4 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {b.label}
              {hint && (
                <span className={cn("ml-2 text-xs", active ? "opacity-90" : "opacity-70")}>
                  {hint}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rango de fechas: días civiles de Lima, no del dispositivo. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="payments-start">Desde</Label>
          <DatePicker
            id="payments-start"
            value={startDate}
            onChange={(value) => onRangeChange({ start: value ?? startDate, end: endDate })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payments-end">Hasta</Label>
          <DatePicker
            id="payments-end"
            value={endDate}
            onChange={(value) => onRangeChange({ start: startDate, end: value ?? endDate })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payments-method">Método</Label>
          <Select
            value={method}
            onValueChange={(value) => onMethodChange(value as PaymentMethod | "all")}
          >
            <SelectTrigger id="payments-method" className="h-10">
              <SelectValue placeholder="Todos los métodos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los métodos</SelectItem>
              {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* El campo va DENTRO del label: SearchInput no expone `id`, y así la
            asociación es implícita en vez de un htmlFor que no apunta a nada. */}
        <Label className="block space-y-2">
          <span className="block">Buscar</span>
          <SearchInput
            value={search}
            onChange={onSearchChange}
            placeholder="Orden, referencia o cajero..."
          />
        </Label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={rangeIs(limaTodayRange()) ? "default" : "outline"}
          size="sm"
          className="h-10"
          onClick={() => onRangeChange(limaTodayRange())}
        >
          Hoy
        </Button>
        <Button
          type="button"
          variant={rangeIs(limaLastDaysRange(7)) ? "default" : "outline"}
          size="sm"
          className="h-10"
          onClick={() => onRangeChange(limaLastDaysRange(7))}
        >
          Últimos 7 días
        </Button>
        <Button
          type="button"
          variant={rangeIs(limaCurrentMonthRange()) ? "default" : "outline"}
          size="sm"
          className="h-10"
          onClick={() => onRangeChange(limaCurrentMonthRange())}
        >
          Este mes
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-10"
          onClick={onExport}
          disabled={exportDisabled}
        >
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>
    </div>
  );
}
