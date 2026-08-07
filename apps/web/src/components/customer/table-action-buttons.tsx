"use client";

import { Bell, Loader2, Receipt } from "lucide-react";
import { Button } from "@restai/ui/components/button";
import { cn } from "@/lib/utils";
import { useTableAction, type TableAction } from "@/hooks/use-table-action";

/**
 * Los dos avisos de mesa, IDÉNTICOS en la carta y en el estado del pedido.
 *
 * Se comparte el componente entero (no solo la lógica) porque la incoherencia
 * que reportaba el cliente era también visual: mismo gesto, dos botones
 * distintos, dos respuestas distintas y una de ellas muerta tras el primer uso.
 */
export function TableActionButtons({
  branchSlug,
  tableCode,
  inactiveSessionMessage,
  className,
}: {
  branchSlug: string;
  tableCode: string;
  /** Mensaje informativo si la visita aún no está confirmada (pantalla de espera). */
  inactiveSessionMessage?: string;
  className?: string;
}) {
  const { send, pendingAction, remainingSeconds, notice } = useTableAction(
    branchSlug,
    tableCode,
    { inactiveSessionMessage },
  );

  const renderButton = (action: TableAction, label: string, Icon: typeof Bell) => {
    const waiting = remainingSeconds(action);
    const isSending = pendingAction === action;
    const disabled = pendingAction !== null || waiting > 0;

    return (
      <Button
        type="button"
        variant="outline"
        // 44px: se pulsa de pie, con el móvil en una mano y a veces con guantes.
        className="h-11 flex-1 gap-2 px-2"
        disabled={disabled}
        aria-label={waiting > 0 ? `${label}. Disponible en ${waiting} segundos` : label}
        onClick={() => void send(action)}
      >
        {isSending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Icon className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate text-sm font-medium">
          {isSending ? "Enviando..." : waiting > 0 ? `Espera ${waiting} s` : label}
        </span>
      </Button>
    );
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-3">
        {renderButton("request_bill", "Pedir la cuenta", Receipt)}
        {renderButton("call_waiter", "Llamar al mozo", Bell)}
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            notice.kind === "success" &&
              "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
            notice.kind === "info" &&
              "border-primary/30 bg-primary/10 text-foreground",
            notice.kind === "error" &&
              "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {notice.message}
        </div>
      )}
    </div>
  );
}
