"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import { AlertTriangle, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTables } from "@/hooks/use-tables";

/**
 * Selector de mesa del POS.
 *
 * Sin él, el pedido "Aquí" nacía huérfano: no se colgaba de ninguna visita, no
 * entraba en la cuenta de la mesa, cocina lo veía como "Salón" y al liberar la
 * mesa ni siquiera se cerraba. El backend acepta `tableId` en POST /api/orders y
 * reutiliza la visita abierta o abre una nueva, así que basta con elegirla aquí.
 */

export interface PosTable {
  id: string;
  number: number;
  capacity: number | null;
  /** `GET /api/tables` devuelve la columna como texto libre: no se asume el enum. */
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  available: "Libre",
  occupied: "Ocupada",
  reserved: "Reservada",
  maintenance: "Mantenimiento",
};

const STATUS_STYLE: Record<string, string> = {
  available: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
  occupied: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  reserved: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  maintenance: "border-border bg-muted text-muted-foreground",
};

/** Estado legible; si la API añadiera un estado nuevo, se pinta tal cual y no en blanco. */
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusStyle(status: string): string {
  return STATUS_STYLE[status] ?? "border-border bg-muted text-muted-foreground";
}

export function TablePicker({
  value,
  onChange,
  className,
}: {
  /** Id de la mesa elegida, o null si el pedido no va a ninguna mesa. */
  value: string | null;
  onChange: (tableId: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useTables();

  const tables = useMemo<PosTable[]>(() => {
    const list = ((data as any)?.tables ?? []) as PosTable[];
    return [...list].sort((a, b) => a.number - b.number);
  }, [data]);

  const selected = tables.find((table) => table.id === value) ?? null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 justify-start gap-2 px-3 text-sm font-medium"
          onClick={() => {
            setOpen(true);
            // El estado de las mesas cambia cada minuto en hora punta: se refresca
            // al abrir para no elegir sobre una foto vieja del salón.
            refetch();
          }}
          aria-label="Elegir la mesa del pedido"
        >
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          {selected ? (
            <span className="truncate">
              Mesa {selected.number}
              <span className="ml-1.5 font-normal text-muted-foreground">
                · {statusLabel(selected.status)}
              </span>
            </span>
          ) : value ? (
            // La mesa elegida ya no está en la lista (otra sede, o se borró).
            <span className="truncate text-muted-foreground">Mesa seleccionada</span>
          ) : (
            <span className="truncate text-muted-foreground">Elegir mesa</span>
          )}
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => onChange(null)}
            aria-label="Quitar la mesa del pedido"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {!value && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Sin mesa el pedido no entra en la cuenta de ninguna mesa.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>Elegir mesa</DialogTitle>
            <DialogDescription>
              El pedido se añadirá a la cuenta de la mesa. Si la mesa está libre se abre
              una visita nueva.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {isLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-xl border border-border/60 bg-muted"
                  />
                ))}
              </div>
            ) : isError ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
              >
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-muted-foreground">
                  {(error as Error)?.message || "No se pudieron cargar las mesas."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
                  Reintentar
                </Button>
              </div>
            ) : tables.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm font-medium">Esta sede no tiene mesas registradas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Créalas en Mesas para poder asignar pedidos del salón.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {tables.map((table) => {
                  const isSelected = table.id === value;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => {
                        onChange(table.id);
                        setOpen(false);
                      }}
                      aria-pressed={isSelected}
                      aria-label={`Mesa ${table.number}, ${statusLabel(table.status).toLowerCase()}`}
                      className={cn(
                        "flex h-16 flex-col items-center justify-center rounded-xl border-2 text-center transition-colors",
                        statusStyle(table.status),
                        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      )}
                    >
                      <span className="text-base font-bold leading-none">{table.number}</span>
                      <span className="mt-1 text-[10px] font-medium uppercase tracking-wide">
                        {statusLabel(table.status)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Sin mesa
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 flex-1"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
          </div>

          {isFetching && !isLoading && (
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Actualizando el estado de las mesas…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
