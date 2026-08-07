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
import { SearchInput } from "@/components/search-input";
import {
  limaTodayRange,
  limaLastDaysRange,
  limaCurrentMonthRange,
} from "@/lib/date";
import {
  INVOICE_TYPE_LABELS,
  SUNAT_STATUS_LABELS,
  type InvoiceType,
  type SunatStatus,
} from "@/hooks/use-invoices";

const TYPES = Object.keys(INVOICE_TYPE_LABELS) as InvoiceType[];
const STATUSES = Object.keys(SUNAT_STATUS_LABELS) as SunatStatus[];

interface InvoiceFiltersProps {
  type: InvoiceType | "all";
  onTypeChange: (type: InvoiceType | "all") => void;
  sunatStatus: SunatStatus | "all";
  onStatusChange: (status: SunatStatus | "all") => void;
  startDate: string;
  endDate: string;
  onRangeChange: (range: { start: string; end: string }) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onExport: () => void;
  exportDisabled: boolean;
  /** La exportación recorre todas las páginas del rango: puede tardar. */
  exporting?: boolean;
}

export function InvoiceFilters({
  type,
  onTypeChange,
  sunatStatus,
  onStatusChange,
  startDate,
  endDate,
  onRangeChange,
  search,
  onSearchChange,
  onExport,
  exportDisabled,
  exporting = false,
}: InvoiceFiltersProps) {
  const rangeIs = (range: { start: string; end: string }) =>
    range.start === startDate && range.end === endDate;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-2">
          <Label htmlFor="invoices-type">Tipo</Label>
          <Select
            value={type}
            onValueChange={(value) => onTypeChange(value as InvoiceType | "all")}
          >
            <SelectTrigger id="invoices-type" className="h-10">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {INVOICE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invoices-status">Estado ante SUNAT</Label>
          <Select
            value={sunatStatus}
            onValueChange={(value) => onStatusChange(value as SunatStatus | "all")}
          >
            <SelectTrigger id="invoices-status" className="h-10">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SUNAT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Fechas civiles peruanas: el día operativo del local, no el del navegador. */}
        <div className="space-y-2">
          <Label htmlFor="invoices-start">Desde</Label>
          <DatePicker
            id="invoices-start"
            value={startDate}
            onChange={(value) => onRangeChange({ start: value ?? startDate, end: endDate })}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoices-end">Hasta</Label>
          <DatePicker
            id="invoices-end"
            value={endDate}
            onChange={(value) => onRangeChange({ start: startDate, end: value ?? endDate })}
            className="h-10"
          />
        </div>

        {/* El campo va dentro del label: SearchInput no expone `id`. */}
        <Label className="block space-y-2">
          <span className="block">Buscar</span>
          <SearchInput
            value={search}
            onChange={onSearchChange}
            placeholder="Número, cliente o documento..."
          />
          <span className="block text-xs font-normal text-muted-foreground">
            Filtra los comprobantes de la página actual. La exportación sí
            abarca todo el rango de fechas.
          </span>
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
          disabled={exportDisabled || exporting}
        >
          <Download className="mr-2 h-4 w-4" />
          {exporting ? "Preparando..." : "Exportar CSV"}
        </Button>
      </div>
    </div>
  );
}
