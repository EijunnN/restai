"use client";

import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import { Check, Printer, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import type { PosOrderSnapshot } from "../page";

/**
 * Confirmación de orden creada.
 *
 * Antes solo ofrecía "Nueva orden": para cobrar había que salir a /orders y
 * buscar la fila a mano. Ahora el cajero cierra la venta —cobro e impresión— sin
 * moverse del POS.
 */

export function SuccessDialog({
  open,
  onOpenChange,
  order,
  onCharge,
  onPrintKitchenTicket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PosOrderSnapshot | null;
  onCharge: () => void;
  onPrintKitchenTicket: () => void;
}) {
  const role = useAuthStore((state) => state.user?.role);
  const canCharge = hasPermission(role, "payments:create");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Orden creada</DialogTitle>
          <DialogDescription>
            La orden ya está en cocina. Puedes cobrarla o imprimir la comanda sin salir
            del POS.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          {order && (
            <>
              <p className="font-mono text-2xl font-bold">{order.orderNumber}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {order.tableNumber != null
                  ? `Mesa ${order.tableNumber}`
                  : order.type === "delivery"
                    ? "Delivery"
                    : order.type === "takeout"
                      ? "Para llevar"
                      : "Mostrador"}
                {" · "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(order.total)}
                </span>
              </p>
              {order.customerName && (
                <p className="mt-0.5 text-xs text-muted-foreground">{order.customerName}</p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {canCharge && (
            <Button type="button" className="h-12 text-base font-semibold" onClick={onCharge}>
              <Wallet className="mr-2 h-5 w-5" />
              Cobrar ahora
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={onPrintKitchenTicket}
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir comanda
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12"
            onClick={() => onOpenChange(false)}
          >
            Nueva orden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
