"use client";

import { Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import { useCurrentCashSession } from "@/hooks/use-cash";
import { usePaymentSummary } from "@/hooks/use-payments";

/**
 * Cómo va el turno, sin salir de la caja.
 *
 * Para saber cuánto llevaba cobrado había que irse a /caja o a /payments y
 * volver, así que en la práctica nadie lo miraba hasta el arqueo — que es
 * exactamente cuando ya no se puede hacer nada con la respuesta.
 *
 * Dos avisos sobre lo que NO dice, porque la tentación de redondear aquí es
 * grande y sería mentir con números:
 *
 * 1. Dice COBRADO, no vendido. Una mesa que sigue comiendo ya vendió y todavía
 *    no ha pagado. El panel del dueño (`/api/reports/dashboard`) sí mide
 *    vendido, pero exige `reports:read`, que ni el cajero ni el mozo tienen: en
 *    esta pantalla habría sido un 403 en cada carga.
 *
 * 2. Cuenta COBROS, no tickets. Una cuenta dividida entre cuatro son cuatro
 *    cobros de una sola mesa. Llamarlos "tickets" haría que esta cifra no
 *    cuadrase nunca con la del panel, y quien la mira no tendría forma de saber
 *    por qué.
 */
export function TurnoResumen() {
  const role = useAuthStore((state) => state.user?.role);

  // Lo cobrado hoy: `payments:read`, que sí tienen cajero y mozo.
  const puedeVerCobros = hasPermission(role, "payments:read");
  const { data: resumen } = usePaymentSummary(puedeVerCobros);

  /*
    La caja es otra historia: `cash:read` lo tiene el cajero y NO el mozo.
    Pedirlo sin comprobarlo dejaba al mozo con un 403 en cada carga del POS, que
    es el fallo que este repositorio ya ha tenido tres veces. Al mozo
    simplemente no le aparece: no es su trabajo cuadrar la caja.
  */
  const puedeVerCaja = hasPermission(role, "cash:read");
  const { data: caja } = useCurrentCashSession(puedeVerCaja);

  if (!puedeVerCobros && !puedeVerCaja) return null;

  const cobrado = resumen?.grandTotal ?? 0;
  const cobros = resumen?.totalCount ?? 0;
  const efectivo = resumen?.cashTotal ?? 0;

  return (
    <div className="rounded-2xl bg-muted/50 p-3.5">
      {puedeVerCobros && (
        <>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Cobrado hoy
          </p>
          <p className="mt-1.5 text-[26px] font-extrabold leading-none tracking-tight tabular-nums">
            {formatCurrency(cobrado)}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            {cobros} {cobros === 1 ? "cobro" : "cobros"}
            {efectivo > 0 && ` · ${formatCurrency(efectivo)} en efectivo`}
          </p>
        </>
      )}

      {/*
        El estado de la caja. `expected_cash` y no otra cifra: es contra ESE
        número contra el que se calcula la diferencia del arqueo al cerrar, así
        que enseñar aquí cualquier otro (el fondo, o el esperado con propinas)
        haría que el cajero cuadrara contra una cifra y el sistema contra otra.
      */}
      {puedeVerCaja && (
        <div className={puedeVerCobros ? "mt-3 border-t border-border/60 pt-2.5" : ""}>
          {caja && caja.status === "open" ? (
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              Caja abierta
              <span className="ml-auto tabular-nums">
                {formatCurrency(caja.totals?.expected_cash ?? caja.opening_float)}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-600 dark:text-amber-400">
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              Caja sin abrir
            </p>
          )}
        </div>
      )}
    </div>
  );
}
