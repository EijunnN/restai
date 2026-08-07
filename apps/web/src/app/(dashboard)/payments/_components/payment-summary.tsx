"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Banknote, CreditCard, Smartphone, Ban, Clock } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import type { PaymentSummary as PaymentSummaryData } from "@/hooks/use-payments";

function methodTotal(summary: PaymentSummaryData | undefined, method: string): number {
  return summary?.byMethod?.find((m) => m.method === method)?.total ?? 0;
}

function Tile({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "bad" | "warn";
}) {
  const tones = {
    neutral: "",
    bad: "border-red-500/40 bg-red-500/5",
    warn: "border-amber-500/40 bg-amber-500/5",
  } as const;
  return (
    <Card className={cn(tones[tone])}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

interface PaymentSummaryProps {
  summary: PaymentSummaryData | undefined;
  isLoading?: boolean;
}

/**
 * Resumen del DÍA operativo de Lima.
 *
 * Los anulados y los pendientes se muestran aparte y NO suman en "Total
 * cobrado": esa mezcla era la que hacía que el cierre de caja no cuadrara.
 */
export function PaymentSummary({ summary, isLoading }: PaymentSummaryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
      <Tile
        label="Total cobrado hoy"
        value={formatCurrency(summary?.grandTotal ?? 0)}
        hint={`${summary?.totalCount ?? 0} cobros`}
      />
      <Tile
        label="Efectivo"
        value={formatCurrency(methodTotal(summary, "cash"))}
        icon={<Banknote className="h-3 w-3" />}
      />
      <Tile
        label="Tarjeta"
        value={formatCurrency(methodTotal(summary, "card"))}
        icon={<CreditCard className="h-3 w-3" />}
      />
      <Tile
        label="Yape/Plin"
        value={formatCurrency(
          methodTotal(summary, "yape") + methodTotal(summary, "plin"),
        )}
        icon={<Smartphone className="h-3 w-3" />}
      />
      <Tile label="Propinas" value={formatCurrency(summary?.tipTotal ?? 0)} />
      <Tile
        label="Anulados"
        value={formatCurrency(summary?.voided?.total ?? 0)}
        hint={`${summary?.voided?.count ?? 0} cobros · no suman`}
        icon={<Ban className="h-3 w-3" />}
        tone={(summary?.voided?.count ?? 0) > 0 ? "bad" : "neutral"}
      />
      <Tile
        label="Pendientes"
        value={formatCurrency(summary?.pending?.total ?? 0)}
        hint={`${summary?.pending?.count ?? 0} sin cobrar aún`}
        icon={<Clock className="h-3 w-3" />}
        tone={(summary?.pending?.count ?? 0) > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}
