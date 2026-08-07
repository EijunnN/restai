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
import { ArrowRight, Loader2, MoveRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMoveSession, type TableRow } from "@/hooks/use-tables";

interface MoveSessionDialogProps {
  table: TableRow | null;
  tables: TableRow[];
  onClose: () => void;
}

/**
 * Mover la cuenta de una mesa a otra libre.
 *
 * Pensado para hora punta: la lista son botones grandes con el número de mesa,
 * un toque elige el destino y otro confirma. La cuenta viaja entera —pedidos,
 * cobros parciales y comandas— sin recalcular un solo importe.
 */
export function MoveSessionDialog({ table, tables, onClose }: MoveSessionDialogProps) {
  const moveSession = useMoveSession();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (table) {
      setTargetId(null);
      setError(null);
    }
  }, [table]);

  // El servidor solo acepta como destino una mesa `available`: ofrecer las
  // ocupadas sería enseñar un botón que devuelve 409.
  const freeTables = useMemo(
    () =>
      tables
        .filter((t) => t.id !== table?.id && t.status === "available")
        .sort((a, b) => a.number - b.number),
    [tables, table?.id],
  );

  if (!table) return null;

  const target = freeTables.find((t) => t.id === targetId) ?? null;

  const submit = async () => {
    if (!target) return;
    setError(null);
    try {
      const result = await moveSession.mutateAsync({
        tableId: table.id,
        targetTableId: target.id,
      });
      toast.success(
        `Cuenta movida de la mesa ${result.source.number} a la ${result.target.number}` +
          (result.movedOrders > 0
            ? ` (${result.movedOrders} ${result.movedOrders === 1 ? "pedido" : "pedidos"})`
            : ""),
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo mover la cuenta";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MoveRight className="h-5 w-5" aria-hidden="true" />
            Mover la cuenta de la mesa {table.number}
          </DialogTitle>
          <DialogDescription>
            Elige la mesa libre a la que se pasan. Se mueve toda la cuenta; los importes
            no cambian.
          </DialogDescription>
        </DialogHeader>

        {freeTables.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay ninguna mesa libre ahora mismo. Libera una mesa antes de mover esta
            cuenta.
          </p>
        ) : (
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            role="radiogroup"
            aria-label="Mesas libres disponibles"
          >
            {freeTables.map((t) => {
              const selected = t.id === targetId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Mesa ${t.number}, ${t.capacity} personas`}
                  onClick={() => setTargetId(t.id)}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center rounded-xl border-2 transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-emerald-50 text-emerald-900 hover:border-primary/60 dark:bg-emerald-950/30 dark:text-emerald-100",
                  )}
                >
                  <span className="text-2xl font-black leading-none tabular-nums">
                    {t.number}
                  </span>
                  <span className="text-[11px] opacity-80">{t.capacity}p</span>
                </button>
              );
            })}
          </div>
        )}

        {target && (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
            <span className="font-semibold">Mesa {table.number}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold">Mesa {target.number}</span>
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
            disabled={moveSession.isPending}
          >
            Cancelar
          </Button>
          <Button
            className="h-10 w-full sm:w-auto"
            disabled={!target || moveSession.isPending}
            onClick={() => void submit()}
          >
            {moveSession.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {target ? `Mover a la mesa ${target.number}` : "Elige una mesa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
