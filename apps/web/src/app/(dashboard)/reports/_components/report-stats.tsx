"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { formatCurrency } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface ReportStatsProps {
  totalOrders: number;
  totalRevenue: number;
  avgOrder: number;
  totalTax: number;
  isLoading: boolean;
}

interface FigureProps {
  title: string;
  value: string;
  /** Qué cuenta exactamente el número: sin esto, los KPI parecen contradecirse. */
  hint: string;
  isLoading: boolean;
  skeletonWidth: string;
}

function Figure({ title, value, hint, isLoading, skeletonWidth }: FigureProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className={`h-8 ${skeletonWidth}`} />
        ) : (
          <>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">{hint}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportStats({
  totalOrders,
  totalRevenue,
  avgOrder,
  totalTax,
  isLoading,
}: ReportStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        title="Órdenes completadas"
        value={String(totalOrders)}
        hint="Las que llegaron a cerrarse. Las anuladas y las que siguen abiertas no cuentan."
        isLoading={isLoading}
        skeletonWidth="w-16"
      />
      <Figure
        title="Ingresos"
        value={formatCurrency(totalRevenue)}
        hint="Suma de esas órdenes completadas, impuestos incluidos."
        isLoading={isLoading}
        skeletonWidth="w-28"
      />
      <Figure
        title="Ticket promedio"
        value={formatCurrency(avgOrder)}
        hint="Ingresos divididos entre las órdenes completadas."
        isLoading={isLoading}
        skeletonWidth="w-24"
      />
      <Figure
        title="IGV recaudado"
        value={formatCurrency(totalTax)}
        hint="Impuesto ya incluido en los ingresos de arriba."
        isLoading={isLoading}
        skeletonWidth="w-24"
      />
    </div>
  );
}
