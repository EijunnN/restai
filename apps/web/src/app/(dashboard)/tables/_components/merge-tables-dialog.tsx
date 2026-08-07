"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Button } from "@restai/ui/components/button";
import { Check, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMergeSessions, type TableRow } from "@/hooks/use-tables";

interface MergeTablesDialogProps {
  table: TableRow | null;
  tables: TableRow[];
  onClose: () => void;
}

/** Máximo de mesas de origen que acepta el servidor en una sola operación. */
const MAX_SOURCES = 20;

/**
 * Juntar las cuentas de varias mesas en esta.
 *
 * El grupo que llegó en tres mesas separadas pide "una sola cuenta": los
 * pedidos de las mesas origen pasan a la cuenta de esta mesa, esas sesiones se
 * cierran y sus mesas quedan libres. Ningún importe se recalcula.
 */
export function MergeTablesDialog({ table, tables, onClose }: MergeTablesDialogProps) {
  const mergeSessions = useMergeSessions();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (table) {
      setSelected([]);
      setError(null);
    }
  }, [table]);

  // Solo tienen cuenta abierta las mesas ocupadas: juntar una mesa libre
  // devolvería 409 SOURCE_WITHOUT_SESSION.
  const candidates = useMemo(
    () =>
      tables
        .filter((t) => t.id !== table?.id && t.status === "occupied")
        .sort((a, b) => a.number - b.number),
    [tables, table?.id],
  );

  if (!table) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SOURCES) {
        toast.warning(`Puedes juntar como máximo ${MAX_SOURCES} mesas a la vez`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const selectedNumbers = candidates
    .filter((t) => selected.includes(t.id))
    .map((t) => t.number);

  const submit = async () => {
    if (selected.length === 0) return;
    setError(null);
    try {
      const result = await mergeSessions.mutateAsync({
        tableId: table.id,
        sourceTableIds: selected,
      });
      const numbers = result.merged.map((m) => m.tableNumber).join(", ");
      toast.success(
        `Cuentas de las mesas ${numbers} juntadas en la mesa ${result.target.number}`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron juntar las cuentas";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5" aria-hidden="true" />
            Juntar cuentas en la mesa {table.number}
          </DialogTitle>
          <DialogDescription>
            Elige las mesas cuya cuenta se pasa a la mesa {table.number}. Esas mesas
            quedarán libres.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay otras mesas ocupadas con cuenta abierta que juntar aquí.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {candidates.map((t) => {
              const isSelected = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Mesa ${t.number}`}
                  onClick={() => toggle(t.id)}
                  className={cn(
                    "relative flex h-16 flex-col items-center justify-center rounded-xl border-2 transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-blue-50 text-blue-900 hover:border-primary/60 dark:bg-blue-950/30 dark:text-blue-100",
                  )}
                >
                  {isSelected && (
                    <Check
                      className="absolute right-1 top-1 h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  <span className="text-2xl font-black leading-none tabular-nums">
                    {t.number}
                  </span>
                  <span className="text-[11px] opacity-80">{t.capacity}p</span>
                </button>
              );
            })}
          </div>
        )}

        {selectedNumbers.length > 0 && (
          <p className="rounded-lg bg-muted/50 p-3 text-center text-sm">
            Las cuentas de las mesas{" "}
            <span className="font-semibold">{selectedNumbers.join(", ")}</span> pasan a
            la <span className="font-semibold">mesa {table.number}</span>.
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="h-10 w-full sm:w-auto"
            onClick={onClose}
            disabled={mergeSessions.isPending}
          >
            Cancelar
          </Button>
          <Button
            className="h-10 w-full sm:w-auto"
            disabled={selected.length === 0 || mergeSessions.isPending}
            onClick={() => void submit()}
          >
            {mergeSessions.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {selected.length === 0
              ? "Elige las mesas"
              : `Juntar ${selected.length} ${selected.length === 1 ? "mesa" : "mesas"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
