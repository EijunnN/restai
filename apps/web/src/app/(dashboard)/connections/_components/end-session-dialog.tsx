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
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useEndSession, pendingAmountFromError } from "@/hooks/use-tables";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";

export interface EndSessionTarget {
  id: string;
  customerName: string;
  tableNumber: number;
}

interface EndSessionDialogProps {
  session: EndSessionTarget | null;
  onClose: () => void;
}

/**
 * Terminar una sesión con guard de saldo.
 *
 * Cerrar la visita da los pedidos por buenos. Si queda cuenta por cobrar, el
 * servidor lo impide con un 409 y aquí se enseña el importe: perdonarlo exige
 * el permiso de anular cobros y queda registrado a nombre de quien lo hace.
 */
export function EndSessionDialog({ session, onClose }: EndSessionDialogProps) {
  const endSession = useEndSession();
  const role = useAuthStore((s) => s.user?.role);
  const canForce = hasPermission(role, "payments:void");

  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (session) {
      setPendingAmount(null);
      setError(null);
      setAccepted(false);
    }
  }, [session]);

  if (!session) return null;

  const run = async (force: boolean) => {
    setError(null);
    try {
      await endSession.mutateAsync({ id: session.id, force });
      toast.success(
        force && pendingAmount
          ? `Sesión de la mesa ${session.tableNumber} cerrada perdonando ${formatCurrency(pendingAmount)}. Queda registrado.`
          : `Sesión de la mesa ${session.tableNumber} terminada`,
      );
      onClose();
    } catch (err) {
      const pending = pendingAmountFromError(err);
      if (pending !== null) {
        setPendingAmount(pending);
        return;
      }
      const message =
        err instanceof Error ? err.message : "No se pudo terminar la sesión";
      setError(message);
      toast.error(message);
    }
  };

  const hasBalance = pendingAmount !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Terminar la sesión de la mesa {session.tableNumber}</DialogTitle>
          <DialogDescription>
            {hasBalance
              ? "Esta mesa todavía tiene cuenta pendiente."
              : `Se cierra la visita de ${session.customerName} y el comensal deja de poder pedir.`}
          </DialogDescription>
        </DialogHeader>

        {hasBalance && (
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
                    Cerrar sin cobrar <strong>perdona {formatCurrency(pendingAmount)}</strong>{" "}
                    y queda registrado en la auditoría a tu nombre.
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-destructive"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>Entiendo que se pierde ese importe.</span>
                </label>
              </div>
            ) : (
              <p
                className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
                role="alert"
              >
                Cobra la cuenta antes de cerrar la sesión. Si hay que perdonar el saldo,
                pídeselo a un responsable de caja.
              </p>
            )}
          </div>
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
            disabled={endSession.isPending}
          >
            Cancelar
          </Button>
          {hasBalance ? (
            canForce && (
              <Button
                variant="destructive"
                className="h-10 w-full sm:w-auto"
                disabled={!accepted || endSession.isPending}
                onClick={() => void run(true)}
              >
                {endSession.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Cerrar perdonando {formatCurrency(pendingAmount)}
              </Button>
            )
          ) : (
            <Button
              className="h-10 w-full sm:w-auto"
              disabled={endSession.isPending}
              onClick={() => void run(false)}
            >
              {endSession.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Terminar sesión
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
