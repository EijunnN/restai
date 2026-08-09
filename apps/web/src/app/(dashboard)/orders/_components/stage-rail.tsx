"use client";

import { formatCurrency } from "@/lib/utils";
import { ETAPAS, ETIQUETA_ESTADO, saldoPendiente } from "./orders-flow";
import type { OrdenFila } from "./orders-feed";

/**
 * La columna de etapas y el dinero que hay en el salón.
 *
 * Las etapas filtran, pero sobre todo CUENTAN: de un vistazo se ve si el cuello
 * de botella está en cocina o en la sala. El punto de color es lo único que
 * distingue una etapa de otra aquí; el resto de la pantalla reserva el color
 * para lo urgente.
 *
 * El dinero de abajo es el saldo real de lo abierto —total menos lo ya
 * cobrado—, no la suma de los totales: una mesa con media cuenta pagada no debe
 * mil soles, debe los quinientos que faltan.
 */

const TONO_ETAPA: Record<string, string> = {
  pending: "bg-muted-foreground/50",
  confirmed: "bg-blue-500",
  preparing: "bg-amber-500",
  ready: "bg-emerald-500",
  served: "bg-violet-500",
  completed: "bg-foreground/60",
};

export function StageRail({
  ordenes,
  etapa,
  onEtapa,
}: {
  ordenes: OrdenFila[];
  /** `null` = todas. */
  etapa: string | null;
  onEtapa: (etapa: string | null) => void;
}) {
  const conteo = new Map<string, number>();
  for (const o of ordenes) {
    conteo.set(o.status, (conteo.get(o.status) ?? 0) + 1);
  }

  const enElSalon = ordenes.reduce((suma, o) => suma + saldoPendiente(o), 0);
  const conSaldo = ordenes.filter((o) => saldoPendiente(o) > 0).length;
  const ticketMedio = conSaldo > 0 ? Math.round(enElSalon / conSaldo) : 0;

  const fila = (activa: boolean) =>
    `flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] transition-colors ${
      activa ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"
    }`;

  // Solo las etapas del servicio: `completed` y `cancelled` viven en el
  // historial, que es otra pestaña y otro trabajo.
  const etapasVivas = ETAPAS.filter((e) => e !== "completed");

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      <p className="mb-2 ml-2.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Etapa
      </p>

      <button type="button" onClick={() => onEtapa(null)} className={fila(etapa === null)}>
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">Todas</span>
        <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">
          {ordenes.length}
        </span>
      </button>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {etapasVivas.map((e) => {
          const n = conteo.get(e) ?? 0;
          return (
            <button
              key={e}
              type="button"
              onClick={() => onEtapa(etapa === e ? null : e)}
              className={fila(etapa === e)}
            >
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${TONO_ETAPA[e]}`} />
              <span className="min-w-0 flex-1 truncate text-left">{ETIQUETA_ESTADO[e]}</span>
              <span
                className={`text-[11.5px] font-bold tabular-nums ${
                  n === 0 ? "text-muted-foreground/50" : "text-muted-foreground"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl bg-muted/60 p-3.5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          En el salón
        </p>
        <p className="mt-2 text-[30px] font-extrabold leading-none tabular-nums tracking-tight">
          {formatCurrency(enElSalon)}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {conSaldo === 0
            ? "No queda nada por cobrar."
            : `Saldo de ${conSaldo} ${conSaldo === 1 ? "orden abierta" : "órdenes abiertas"}. Ticket medio ${formatCurrency(ticketMedio)}.`}
        </p>
      </div>
    </div>
  );
}
