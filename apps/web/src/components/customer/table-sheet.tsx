"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ClipboardList, Loader2, Mic, Receipt } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@restai/ui/components/sheet";
import { cn } from "@/lib/utils";
import { useTableAction, type TableAction } from "@/hooks/use-table-action";

/**
 * Lo que el comensal puede pedirle a la mesa, recogido en una hoja.
 *
 * Antes esto vivía en una barra fija del pie, junto al carrito y al enlace de
 * pedidos: tres bloques anclados abajo que se comían la pantalla en un móvil
 * pequeño, y que estaban ahí permanentemente para dos acciones que se usan una
 * o dos veces por comida. Llamar al mozo no compite con mirar la carta.
 *
 * La hoja conserva intactas las reglas del aviso: la espera de 30 s entre
 * envíos, la cuenta atrás visible y el mensaje en línea con su `role` — el
 * comensal tiene que ver que su llamada salió, no solo un toast que se va.
 */
export function TableSheet({
  open,
  onOpenChange,
  branchSlug,
  tableCode,
  tableNumber,
  /** Total pendiente de la mesa, en céntimos. Solo si se conoce. */
  pendingAmount,
  orderSummary,
  /** El local tiene el mesero por voz encendido. */
  voiceEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchSlug: string;
  tableCode: string;
  tableNumber?: number | string | null;
  pendingAmount?: string | null;
  orderSummary?: string | null;
  voiceEnabled?: boolean;
}) {
  const router = useRouter();
  const { send, pendingAction, remainingSeconds, notice } = useTableAction(
    branchSlug,
    tableCode,
  );

  const go = (path: string) => {
    onOpenChange(false);
    router.push(path);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-5 pb-8 pt-4"
      >
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-[22px] font-medium">
            {tableNumber ? `Mesa ${tableNumber}` : "Tu mesa"}
          </SheetTitle>
          {orderSummary && (
            <p className="text-[13px] text-muted-foreground">{orderSummary}</p>
          )}
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2.5">
          <ActionRow
            icon={Bell}
            title="Llamar al mozo"
            hint="Alguien se acerca a tu mesa"
            action="call_waiter"
            send={send}
            pendingAction={pendingAction}
            waiting={remainingSeconds("call_waiter")}
          />
          <ActionRow
            icon={Receipt}
            title="Pedir la cuenta"
            hint={pendingAmount ? `Total de la mesa: ${pendingAmount}` : "Avisamos para cobrarte"}
            action="request_bill"
            send={send}
            pendingAction={pendingAction}
            waiting={remainingSeconds("request_bill")}
          />

          <NavRow
            icon={ClipboardList}
            title="Mis pedidos"
            hint="Mira qué está en cocina y qué ya llegó"
            onClick={() => go(`/${branchSlug}/${tableCode}/status`)}
          />

          {/* La entrada por voz solo aparece si el local la tiene encendida:
              ofrecerla apagada llevaría a una pantalla que no puede escuchar. */}
          {voiceEnabled && (
            <NavRow
              icon={Mic}
              title="Pedir hablando"
              hint="Dile qué quieres y lo vas viendo en pantalla"
              onClick={() => go(`/${branchSlug}/${tableCode}/voz`)}
            />
          )}
        </div>

        {/* El aviso vive dentro de la hoja, no como toast: el comensal necesita
            confirmación de que su llamada salió, y un toast se va solo. */}
        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={cn(
              "mt-4 rounded-xl border px-3 py-2.5 text-[13px]",
              notice.kind === "success" &&
                "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
              notice.kind === "info" && "border-primary/30 bg-primary/10 text-foreground",
              notice.kind === "error" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {notice.message}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActionRow({
  icon: Icon,
  title,
  hint,
  action,
  send,
  pendingAction,
  waiting,
}: {
  icon: typeof Bell;
  title: string;
  hint: string;
  action: TableAction;
  send: (a: TableAction) => void | Promise<void>;
  pendingAction: TableAction | null;
  waiting: number;
}) {
  const sending = pendingAction === action;
  const disabled = pendingAction !== null || waiting > 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void send(action)}
      aria-label={waiting > 0 ? `${title}. Disponible en ${waiting} segundos` : title}
      className={cn(
        "flex min-h-[62px] items-center gap-3.5 rounded-2xl border border-border px-4 text-left transition-colors",
        disabled ? "opacity-60" : "hover:bg-muted/60",
      )}
    >
      {sending ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{hint}</span>
      </span>
      {waiting > 0 && (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[12px] tabular-nums text-muted-foreground">
          {waiting} s
        </span>
      )}
    </button>
  );
}

function NavRow({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof Bell;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[62px] items-center gap-3.5 rounded-2xl border border-border px-4 text-left transition-colors hover:bg-muted/60"
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{hint}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        ›
      </span>
    </button>
  );
}
