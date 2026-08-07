"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Button } from "@restai/ui/components/button";
import { AlertTriangle, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useFreeTable, pendingAmountFromError, type TableRow } from "@/hooks/use-tables";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";

interface FreeTableDialogProps {
  table: TableRow | null;
  onClose: () => void;
  /** Abre el cobro de esta mesa: la salida correcta cuando queda saldo. */
  onGoCharge: (table: TableRow) => void;
}

/**
 * Liberar mesa con guard de saldo.
 *
 * Liberar convierte los pedidos abiertos en venta cerrada (con puntos e
 * inventario descontados). Si la cuenta no está saldada eso es, literalmente,
 * regalar dinero, así que el servidor responde 409 con el importe pendiente y
 * aquí se muestra en grande. Perdonarlo exige `payments:void`, un aviso
 * explícito y queda registrado a nombre de quien lo hace.
 */
export function FreeTableDialog({ table, onClose, onGoCharge }: FreeTableDialogProps) {
  const freeTable = useFreeTable();
  const role = useAuthStore((s) => s.user?.role);
  const canForce = hasPermission(role, "payments:void");

  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptedForce, setAcceptedForce] = useState(false);

  // Cada mesa arranca su propio diálogo limpio: arrastrar el saldo de la mesa
  // anterior sería mostrar una cifra que no es de esta cuenta.
  useEffect(() => {
    if (table) {
      setPendingAmount(null);
      setError(null);
      setAcceptedForce(false);
    }
  }, [table]);

  if (!table) return null;

  const run = async (force: boolean) => {
    setError(null);
    try {
      const result = await freeTable.mutateAsync({ tableId: table.id, force });
      if (force && result.forgivenAmount > 0) {
        toast.warning(
          `Mesa ${table.number} liberada perdonando ${formatCurrency(result.forgivenAmount)}. Queda registrado.`,
        );
      } else {
        toast.success(`Mesa ${table.number} liberada`);
      }
      onClose();
    } catch (err) {
      const pending = pendingAmountFromError(err);
      if (pending !== null) {
        setPendingAmount(pending);
        return;
      }
      const message = err instanceof Error ? err.message : "No se pudo liberar la mesa";
      setError(message);
      toast.error(message);
    }
  };

  const hasBalance = pendingAmount !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Liberar mesa {table.number}</DialogTitle>
          <DialogDescription>
            {hasBalance
              ? "Esta mesa todavía tiene cuenta pendiente."
              : "Se cerrará la visita y se finalizarán los pedidos abiertos."}
          </DialogDescription>
        </DialogHeader>

        {hasBalance ? (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 text-center">
              <p className="text-sm text-muted-foreground">Saldo pendiente</p>
              <p className="text-4xl font-black tabular-nums text-destructive">
                {formatCurrency(pendingAmount)}
              </p>
            </div>

            {canForce ? (
              <div className="space-y-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/20">
                <div className="flex gap-2">
                  <AlertTriangle
                    className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-amber-900 dark:text-amber-200">
                    Liberar sin cobrar da la venta por cerrada y{" "}
                    <strong>perdona {formatCurrency(pendingAmount)}</strong>. La
                    operación queda registrada en la auditoría a tu nombre.
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-destructive"
                    checked={acceptedForce}
                    onChange={(e) => setAcceptedForce(e.target.checked)}
                  />
                  <span>
                    Entiendo que se pierde ese importe y que quedará registrado a mi
                    nombre.
                  </span>
                </label>
              </div>
            ) : (
              <p
                className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
                role="alert"
              >
                Cobra la cuenta antes de liberar. Si hay que perdonar el saldo, pídelo a
                un responsable de caja: hace falta permiso para anular cobros.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Asegúrate de haber cobrado. Si queda saldo pendiente te lo avisaremos antes
            de cerrar nada.
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
            disabled={freeTable.isPending}
          >
            Cancelar
          </Button>

          {hasBalance && (
            <Button
              variant="outline"
              className="h-10 w-full sm:w-auto"
              onClick={() => {
                onClose();
                onGoCharge(table);
              }}
              disabled={freeTable.isPending}
            >
              <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
              Ir a cobrar
            </Button>
          )}

          {hasBalance ? (
            canForce && (
              <Button
                variant="destructive"
                className="h-10 w-full sm:w-auto"
                disabled={!acceptedForce || freeTable.isPending}
                onClick={() => run(true)}
              >
                {freeTable.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Liberar perdonando {formatCurrency(pendingAmount)}
              </Button>
            )
          ) : (
            <Button
              className="h-10 w-full sm:w-auto"
              disabled={freeTable.isPending}
              onClick={() => run(false)}
            >
              {freeTable.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Liberar mesa
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
