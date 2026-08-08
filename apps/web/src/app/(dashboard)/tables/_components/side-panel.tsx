"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  CreditCard,
  History,
  Layers,
  Loader2,
  QrCode,
  ReceiptText,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@restai/ui/components/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  useApproveSession,
  useRejectSession,
  useTableActiveSession,
  type TableRow,
} from "@/hooks/use-tables";
import { useTablesContext } from "./tables-context";

/**
 * Panel lateral de la sala.
 *
 * Sustituye a tres bloques que antes se apilaban encima de la cuadrícula —las
 * cuatro tarjetas de resumen, las solicitudes de ingreso y la banda de avisos—
 * y que empujaban las mesas fuera de la pantalla justo cuando más lleno estaba
 * el local. Aquí conviven en una columna fija, y al elegir una mesa el mismo
 * espacio pasa a ser su ficha: no hay salto de página ni diálogo que tape la
 * sala.
 */

interface Props {
  onCharge: (t: TableRow) => void;
  onSeat: (t: TableRow) => void;
  onFree: (t: TableRow) => void;
  onMove: (t: TableRow) => void;
  onMerge: (t: TableRow) => void;
  onQr: (t: TableRow) => void;
  onHistory: (t: TableRow) => void;
  onAssign: (t: TableRow) => void;
  onDelete: (t: TableRow) => void;
  onStatusChange: (id: string, status: string) => void;
  statusChangePending: boolean;
  canDelete: boolean;
  canCharge: boolean;
}

export function SidePanel(props: Props) {
  const { selected } = useTablesContext();
  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-border bg-card">
      {selected ? <TableDetail table={selected} {...props} /> : <RoomSummary />}
    </aside>
  );
}

// ── Resumen de sala ─────────────────────────────────────────────────────────

function RoomSummary() {
  const {
    counts,
    occupancy,
    allTables,
    pendingSessions,
    requestByTableId,
    canOperateTables,
    selectTable,
  } = useTablesContext();

  const avisos = Object.entries(requestByTableId);

  return (
    <>
      <div className="p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Ahora mismo
        </p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[52px] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
            {counts.occupied}
          </span>
          <span className="text-[15px] text-muted-foreground">
            de {counts.total} mesas ocupadas
          </span>
        </div>

        {/* Una barra por mesa: la forma de la sala de un vistazo, sin leer. */}
        <div className="mt-4 flex gap-[3px]">
          {allTables.map((t) => (
            <span
              key={t.id}
              title={`Mesa ${t.number}`}
              className={cn(
                "h-[26px] flex-1 rounded-[3px]",
                t.status === "occupied"
                  ? "bg-blue-600 dark:bg-blue-500"
                  : t.status === "reserved"
                    ? "bg-amber-500 dark:bg-amber-500/90"
                    : t.status === "maintenance"
                      ? "bg-muted"
                      : "bg-foreground/[0.10] dark:bg-white/[0.12]",
              )}
            />
          ))}
        </div>

        <div className="mt-4 flex gap-6">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Comensales
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums">
              {occupancy.seated}
              <span className="text-muted-foreground">/{occupancy.capacity}</span>
            </p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Reservadas
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums">{counts.reserved}</p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Libres
            </p>
            <p className="mt-1 text-[20px] font-bold tabular-nums">{counts.available}</p>
          </div>
        </div>

        {/* Las visitas que entraron por QR no dicen cuántos son. Decirlo evita
            que alguien lea el contador como si fuera el aforo real. */}
        {occupancy.unknown > 0 && (
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            {occupancy.unknown === 1
              ? "1 mesa no declaró cuántos comensales son."
              : `${occupancy.unknown} mesas no declararon cuántos comensales son.`}
          </p>
        )}
      </div>

      <div className="mx-5 h-px bg-border" />

      <div className="p-5">
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Te están esperando
        </p>

        {pendingSessions.length === 0 && avisos.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            Nadie espera atención ahora mismo.
          </p>
        )}

        {/* Ingresos por QR pendientes de aprobar: sin `tables:update` no se
            pintan, porque quien no puede aceptarlos tampoco puede resolverlos. */}
        {canOperateTables &&
          pendingSessions.map((s) => (
            <PendingSessionRow key={s.id} session={s} />
          ))}

        {avisos.map(([tableId, aviso]) => {
          const mesa = allTables.find((t) => t.id === tableId);
          if (!mesa) return null;
          return (
            <div
              key={tableId}
              className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
            >
              <span
                className={cn(
                  "h-[9px] w-[9px] flex-none rounded-full",
                  aviso.type === "request_bill"
                    ? "bg-violet-600 dark:bg-violet-500"
                    : "bg-orange-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">
                  Mesa {mesa.number}{" "}
                  {aviso.type === "request_bill" ? "pide la cuenta" : "llama al mozo"}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {aviso.customerName}
                </p>
              </div>
              <Button
                variant="secondary"
                className="h-8 shrink-0 px-3 text-[12.5px]"
                onClick={() => selectTable(mesa.id)}
              >
                Ver mesa
              </Button>
            </div>
          );
        })}

        {avisos.length > 0 && (
          <Link
            href="/connections"
            className={cn(buttonVariants({ variant: "outline" }), "mt-3 h-10 w-full")}
          >
            Bandeja de avisos
          </Link>
        )}
      </div>
    </>
  );
}

/** Una solicitud de ingreso, con sus dos botones bloqueados mientras resuelve. */
function PendingSessionRow({
  session,
}: {
  session: { id: string; customer_name: string; customer_phone: string | null; table_number: number };
}) {
  const approve = useApproveSession();
  const reject = useRejectSession();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
      <span className="h-[9px] w-[9px] flex-none rounded-full bg-blue-600 dark:bg-blue-500" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">
          {session.customer_name} quiere entrar a la {session.table_number}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          Escaneó el QR{session.customer_phone ? ` · ${session.customer_phone}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          variant="outline"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          aria-label={`Rechazar el ingreso de ${session.customer_name} en la mesa ${session.table_number}`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            reject.mutate(session.id, {
              onSuccess: () => toast.success("Solicitud rechazada"),
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "No se pudo rechazar"),
              onSettled: () => setBusy(false),
            });
          }}
        >
          {busy && reject.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <Button
          className="h-8 px-3 text-[12.5px]"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            approve.mutate(session.id, {
              onSuccess: () =>
                toast.success(
                  `${session.customer_name} ya puede pedir en la mesa ${session.table_number}`,
                ),
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "No se pudo aceptar"),
              onSettled: () => setBusy(false),
            });
          }}
        >
          {busy && approve.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="mr-1 h-4 w-4" aria-hidden="true" />
          )}
          Aceptar
        </Button>
      </div>
    </div>
  );
}

// ── Ficha de una mesa ───────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  available: "Libre",
  occupied: "Ocupada",
  reserved: "Reservada",
  maintenance: "Sin servicio",
};

function TableDetail({
  table,
  onCharge,
  onSeat,
  onFree,
  onMove,
  onMerge,
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
  statusChangePending,
  canDelete,
  canCharge,
}: Props & { table: TableRow }) {
  const { selectTable, canOperateTables, waiterAssignmentEnabled } = useTablesContext();
  const sesion = table.active_session;
  const ocupada = table.status === "occupied";
  const puedeSentar = table.status === "available" || table.status === "reserved";

  // La cuenta detallada solo se pide cuando hay algo que cobrar: en una mesa
  // libre sería una petición por cada clic en la sala.
  const { data: cuenta, isLoading: cuentaLoading } = useTableActiveSession(
    ocupada && sesion ? table.id : null,
  );

  const lineas = (cuenta?.orders ?? []).flatMap((o) => o.items);

  return (
    <>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {ESTADO_LABEL[table.status] ?? table.status}
            </p>
            <h2 className="mt-1 text-[40px] font-extrabold leading-none tracking-[-0.045em] tabular-nums">
              Mesa {table.number}
            </h2>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {sesion
                ? sesion.status === "pending"
                  ? `${sesion.customer_name} espera que le abran la cuenta`
                  : sesion.customer_name
                : table.status === "reserved"
                  ? "Reservada"
                  : table.status === "maintenance"
                    ? "Fuera de servicio"
                    : "Lista para sentar"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => selectTable(null)}
            aria-label="Cerrar la ficha de la mesa"
            title="Cerrar"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex gap-7">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Aforo
            </p>
            <p className="mt-1 text-[19px] font-bold tabular-nums">{table.capacity}</p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Sentados
            </p>
            <p className="mt-1 text-[19px] font-bold tabular-nums">
              {typeof sesion?.guest_count === "number" ? sesion.guest_count : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Tiempo
            </p>
            <p className="mt-1 text-[19px] font-bold tabular-nums">
              {sesion ? `${sesion.elapsed_minutes}m` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Pedidos
            </p>
            <p className="mt-1 text-[19px] font-bold tabular-nums">
              {sesion ? sesion.order_count : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5">
        {ocupada && sesion && (
          <div className="border-t border-border py-4">
            {cuentaLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-5 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : lineas.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                La cuenta está abierta pero todavía no hay pedidos.
              </p>
            ) : (
              lineas.map((li) => (
                <div key={li.id} className="flex items-baseline gap-2.5 py-1">
                  <span className="min-w-[20px] text-[12.5px] text-muted-foreground tabular-nums">
                    {li.quantity}×
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                    {li.name}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-semibold",
                      li.paid
                        ? "text-muted-foreground"
                        : "text-blue-700 dark:text-blue-400",
                    )}
                  >
                    {li.paid ? "cobrado" : formatCurrency(li.share)}
                  </span>
                </div>
              ))
            )}

            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-[12px] text-muted-foreground">Por cobrar</span>
              <span className="text-[26px] font-extrabold tracking-[-0.03em] tabular-nums">
                {formatCurrency(sesion.remaining)}
              </span>
            </div>
          </div>
        )}

        {/* Acción principal. "Sentar" y "Liberar" NO son cambios de estado:
            abren su diálogo, que es quien crea o cierra la cuenta de verdad. */}
        {ocupada && canCharge && (
          <Button className="mt-4 h-[50px] w-full text-[15px]" onClick={() => onCharge(table)}>
            <CreditCard className="mr-2 h-[17px] w-[17px]" aria-hidden="true" />
            Cobrar
          </Button>
        )}
        {!ocupada && puedeSentar && canOperateTables && (
          <Button className="mt-4 h-[50px] w-full text-[15px]" onClick={() => onSeat(table)}>
            <Users className="mr-2 h-[17px] w-[17px]" aria-hidden="true" />
            Sentar cliente
          </Button>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <SecondaryAction icon={QrCode} label="QR" onClick={() => onQr(table)} />
          <SecondaryAction icon={History} label="Historial" onClick={() => onHistory(table)} />
          {waiterAssignmentEnabled && canOperateTables && (
            <SecondaryAction icon={UserCog} label="Mozo" onClick={() => onAssign(table)} />
          )}
          {ocupada && canOperateTables && (
            <>
              <SecondaryAction icon={ArrowRight} label="Mover" onClick={() => onMove(table)} />
              <SecondaryAction icon={Layers} label="Juntar" onClick={() => onMerge(table)} />
              <SecondaryAction
                icon={ReceiptText}
                label="Liberar"
                onClick={() => onFree(table)}
              />
            </>
          )}
        </div>

        {canOperateTables && (
          <div className="mt-4 flex gap-1 rounded-xl bg-muted p-1">
            {(["available", "occupied", "reserved", "maintenance"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={statusChangePending}
                aria-pressed={table.status === k}
                onClick={() => onStatusChange(table.id, k)}
                className={cn(
                  "h-8 flex-1 rounded-lg text-[11.5px] font-semibold transition-colors disabled:opacity-50",
                  table.status === k
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "maintenance" ? "Mant." : ESTADO_LABEL[k]}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Código corto
            </p>
            <p className="mt-1 text-[16px] font-bold tracking-[0.1em] tabular-nums">
              {table.short_code ?? "—"}
            </p>
          </div>
          {canDelete && (
            <Button
              variant="outline"
              className="h-9 text-destructive hover:text-destructive"
              onClick={() => onDelete(table)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Eliminar
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function SecondaryAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof QrCode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground/[0.05] px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.10] dark:bg-white/[0.06] dark:hover:bg-white/[0.12]"
    >
      <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
      {label}
    </button>
  );
}
