"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Badge } from "@restai/ui/components/badge";
import {
  Wallet,
  LockKeyhole,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { formatCivilDate } from "@/lib/date";
import {
  useCurrentCashSession,
  useCashSessions,
  useOpenCashSession,
  useCloseCashSession,
  type CashSession,
} from "@/hooks/use-cash";
import { ConfirmDialog } from "@/components/confirm-dialog";

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

/** "12,50" o "12.50" -> 1250 céntimos. Devuelve null si no es un importe válido. */
function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const tones = {
    neutral: "border-border bg-card",
    good: "border-green-500/40 bg-green-500/10",
    bad: "border-red-500/40 bg-red-500/10",
    warn: "border-amber-500/40 bg-amber-500/10",
  } as const;
  return (
    <div className={cn("rounded-xl border p-4", tones[tone])}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function CajaPage() {
  const { data: current, isLoading, refetch, isFetching } = useCurrentCashSession();
  const { data: history } = useCashSessions({ limit: 30 });
  const openCash = useOpenCashSession();
  const closeCash = useCloseCashSession();

  const [openingFloat, setOpeningFloat] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const totals = current?.totals;

  // La diferencia se calcula EN VIVO mientras el cajero teclea, para que vea el
  // descuadre antes de confirmar el cierre y pueda recontar.
  const countedCents = parseAmountToCents(countedCash);
  const previewDifference =
    countedCents !== null && totals ? countedCents - totals.expected_cash : null;

  /**
   * Propinas cobradas en efectivo.
   *
   * Están FÍSICAMENTE en el cajón, pero NO entran en `expected_cash`: la cifra
   * auditada es fondo + ventas en efectivo, y `difference` se calcula siempre
   * contra ella. Consecuencia práctica: si el local guarda las propinas en el
   * cajón hasta el reparto, todo cierre muestra un "sobrante" exactamente igual
   * a las propinas, y el cajero no entiende por qué. La fórmula no se toca; lo
   * que faltaba era EXPLICARLA, enseñando también `expected_cash_with_tips`.
   */
  const propinasEnEfectivo = totals?.cash_tips ?? 0;
  const diferenciaConPropinas =
    countedCents !== null && totals ? countedCents - totals.expected_cash_with_tips : null;

  const handleOpen = () => {
    const cents = parseAmountToCents(openingFloat || "0");
    if (cents === null) {
      toast.error("El fondo inicial no es un importe válido");
      return;
    }
    openCash.mutate(
      { openingFloat: cents, openingNotes: openingNotes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Caja abierta");
          setOpeningFloat("");
          setOpeningNotes("");
        },
        onError: (err: any) => {
          const code = err?.code ?? err?.error?.code;
          toast.error(
            code === "CONFLICT"
              ? "Ya hay una caja abierta en esta sede"
              : err?.message || "No se pudo abrir la caja",
          );
        },
      },
    );
  };

  const handleClose = () => {
    if (countedCents === null) {
      toast.error("Ingresa el efectivo contado");
      return;
    }
    closeCash.mutate(
      { countedCash: countedCents, closingNotes: closingNotes.trim() || undefined },
      {
        onSuccess: (session) => {
          const diff = session?.difference ?? 0;
          if (diff === 0) toast.success("Caja cerrada y cuadrada");
          else if (diff > 0)
            toast.warning(
              propinasEnEfectivo > 0
                ? `Caja cerrada con un sobrante de ${formatCurrency(diff)}. Recuerda que ${formatCurrency(propinasEnEfectivo)} son propinas en efectivo, que no cuentan como venta.`
                : `Caja cerrada con un sobrante de ${formatCurrency(diff)}`,
            );
          else toast.warning(`Caja cerrada con un faltante de ${formatCurrency(Math.abs(diff))}`);
          setCountedCash("");
          setClosingNotes("");
          setConfirmCloseOpen(false);
        },
        onError: (err: any) => {
          toast.error(err?.message || "No se pudo cerrar la caja");
          setConfirmCloseOpen(false);
        },
      },
    );
  };

  const exportHistory = () => {
    downloadCsv(
      "arqueos_de_caja",
      [
        { header: "Fecha", value: (s: CashSession) => formatCivilDate(s.business_date) },
        { header: "Estado", value: (s: CashSession) => (s.status === "open" ? "Abierta" : "Cerrada") },
        { header: "Abrió", value: (s: CashSession) => s.opened_by_name ?? "" },
        { header: "Cerró", value: (s: CashSession) => s.closed_by_name ?? "" },
        { header: "Fondo (S/)", value: (s: CashSession) => csvMoney(s.opening_float) },
        { header: "Esperado (S/)", value: (s: CashSession) => csvMoney(s.expected_cash ?? 0) },
        { header: "Contado (S/)", value: (s: CashSession) => csvMoney(s.counted_cash ?? 0) },
        { header: "Diferencia (S/)", value: (s: CashSession) => csvMoney(s.difference ?? 0) },
      ],
      history?.data ?? [],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Arqueo de caja</h1>
          <p className="text-muted-foreground">
            Abre el turno con un fondo, cobra, y cuadra el efectivo al cerrar.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      ) : !current ? (
        /* ── Sin caja abierta ─────────────────────────────────────────── */
        <div className="rounded-xl border p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3">
              <Unlock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">No hay caja abierta</h2>
              <p className="text-sm text-muted-foreground">
                Abre la caja al empezar el turno para poder cuadrarla después.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="opening-float">Fondo inicial (S/)</Label>
              <Input
                id="opening-float"
                inputMode="decimal"
                placeholder="0.00"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                El sencillo con el que arranca el cajón. Si no hay, deja 0.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-notes">Notas (opcional)</Label>
              <Input
                id="opening-notes"
                placeholder="Ej. turno mañana, caja 1"
                value={openingNotes}
                onChange={(e) => setOpeningNotes(e.target.value)}
              />
            </div>
          </div>

          <Button className="mt-4 h-11" onClick={handleOpen} disabled={openCash.isPending}>
            <Wallet className="mr-2 h-4 w-4" />
            {openCash.isPending ? "Abriendo..." : "Abrir caja"}
          </Button>
        </div>
      ) : (
        /* ── Caja abierta ─────────────────────────────────────────────── */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div className="flex-1">
              <p className="font-semibold">
                Caja abierta · {formatCivilDate(current.business_date)}
              </p>
              <p className="text-sm text-muted-foreground">
                Abrió {current.opened_by_name ?? "—"} con un fondo de{" "}
                {formatCurrency(current.opening_float)}
              </p>
            </div>
          </div>

          {totals && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <StatTile
                  label="Efectivo esperado"
                  value={formatCurrency(totals.expected_cash)}
                  hint="Fondo + ventas en efectivo (sin propinas)"
                  tone="warn"
                />
                <StatTile
                  label="Propinas en efectivo"
                  value={formatCurrency(totals.cash_tips)}
                  hint={
                    propinasEnEfectivo > 0
                      ? `Si siguen en el cajón, contarás ${formatCurrency(totals.expected_cash_with_tips)}`
                      : `Propinas del turno: ${formatCurrency(totals.tips_total)}`
                  }
                />
                <StatTile
                  label="Ventas del turno"
                  value={formatCurrency(totals.total_sales)}
                  hint={`${totals.payment_count} cobros · ${totals.order_count} órdenes`}
                />
                <StatTile
                  label="Otros métodos"
                  value={formatCurrency(totals.non_cash_sales)}
                  hint="No se cuenta en el cajón"
                />
                <StatTile
                  label="Anulados"
                  value={formatCurrency(totals.voided_total)}
                  hint={`${totals.voided_count} cobros anulados`}
                  tone={totals.voided_count > 0 ? "bad" : "neutral"}
                />
              </div>

              <div className="rounded-xl border">
                <div className="border-b px-4 py-3">
                  <h3 className="font-semibold">Desglose por método</h3>
                </div>
                <div className="divide-y">
                  {totals.by_method.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      Todavía no se registró ningún cobro en este turno.
                    </p>
                  ) : (
                    totals.by_method.map((m) => (
                      <div key={m.method} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {METHOD_LABELS[m.method] ?? m.method}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {m.count}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{formatCurrency(m.total)}</p>
                          {m.tips > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Propinas {formatCurrency(m.tips)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-xl bg-amber-500/10 p-3">
                    <LockKeyhole className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Cerrar caja</h2>
                    <p className="text-sm text-muted-foreground">
                      Cuenta el efectivo del cajón e ingrésalo. Compararemos con lo esperado.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="counted-cash">Efectivo contado (S/)</Label>
                    <Input
                      id="counted-cash"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      className="h-12 text-lg tabular-nums"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="closing-notes">Notas de cierre (opcional)</Label>
                    <Input
                      id="closing-notes"
                      placeholder="Ej. faltó vuelto de la mesa 4"
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                    />
                  </div>
                </div>

                {previewDifference !== null && (
                  <div
                    className={cn(
                      "mt-4 flex items-center gap-3 rounded-xl border p-4",
                      previewDifference === 0
                        ? "border-green-500/40 bg-green-500/10"
                        : "border-amber-500/40 bg-amber-500/10",
                    )}
                  >
                    {previewDifference === 0 ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {previewDifference === 0
                          ? "La caja cuadra"
                          : previewDifference > 0
                            ? `Sobran ${formatCurrency(previewDifference)}`
                            : `Faltan ${formatCurrency(Math.abs(previewDifference))}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Esperado {formatCurrency(totals.expected_cash)} · Contado{" "}
                        {formatCurrency(countedCents ?? 0)}
                      </p>
                      {/* La explicación del "sobrante" que desconcierta en todo
                          cierre con propinas en efectivo. */}
                      {propinasEnEfectivo > 0 && diferenciaConPropinas !== null && (
                        <p className="mt-2 text-sm">
                          Esta diferencia se calcula contra el esperado{" "}
                          <strong>sin propinas</strong>, que es la cifra que queda
                          registrada. Las propinas en efectivo del turno son{" "}
                          {formatCurrency(propinasEnEfectivo)}: si siguen en el cajón,
                          deberías contar {formatCurrency(totals.expected_cash_with_tips)} y,
                          con esa referencia,{" "}
                          {diferenciaConPropinas === 0
                            ? "el cajón cuadra exactamente"
                            : diferenciaConPropinas > 0
                              ? `sobran ${formatCurrency(diferenciaConPropinas)}`
                              : `faltan ${formatCurrency(Math.abs(diferenciaConPropinas))}`}
                          .
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  className="mt-4 h-11"
                  variant="destructive"
                  disabled={countedCents === null || closeCash.isPending}
                  onClick={() => setConfirmCloseOpen(true)}
                >
                  <LockKeyhole className="mr-2 h-4 w-4" />
                  Cerrar caja
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Historial */}
      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">Arqueos anteriores</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={!history?.data?.length}
            onClick={exportHistory}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left font-medium text-muted-foreground">Fecha</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Cajero</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Esperado</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Contado</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(history?.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    Todavía no hay arqueos cerrados.
                  </td>
                </tr>
              ) : (
                (history?.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="p-3">
                      {formatCivilDate(s.business_date)}
                      {s.status === "open" && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Abierta
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">{s.closed_by_name ?? s.opened_by_name ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">
                      {s.expected_cash !== null ? formatCurrency(s.expected_cash) : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {s.counted_cash !== null ? formatCurrency(s.counted_cash) : "—"}
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right font-medium tabular-nums",
                        s.difference === null
                          ? ""
                          : s.difference === 0
                            ? "text-green-600"
                            : "text-red-600",
                      )}
                    >
                      {s.difference !== null ? formatCurrency(s.difference) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title="¿Cerrar la caja del turno?"
        description={
          previewDifference === null
            ? "Se cerrará la caja."
            : previewDifference === 0
              ? "La caja cuadra exactamente. Una vez cerrada no se puede reabrir."
              : `Hay una diferencia de ${formatCurrency(previewDifference)}. Quedará registrada con tu nombre y no se puede reabrir.${
                  previewDifference > 0 && propinasEnEfectivo > 0
                    ? ` De ese importe, ${formatCurrency(propinasEnEfectivo)} son propinas en efectivo: si las dejas en el cajón, el sobrante es esperable.`
                    : ""
                }`
        }
        confirmLabel="Cerrar caja"
        loading={closeCash.isPending}
        onConfirm={handleClose}
      />
    </div>
  );
}
