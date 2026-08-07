"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { formatCurrency } from "@/lib/utils";
import type { PaymentMethodShare } from "@/hooks/use-reports";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const PIE_COLORS = ["#0f766e", "#2563eb", "#16a34a", "#d97706", "#e11d48", "#4b5563"];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface PaymentMethodsChartProps {
  paymentMethods: PaymentMethodShare[];
  isLoading: boolean;
}

export function PaymentMethodsChart({ paymentMethods, isLoading }: PaymentMethodsChartProps) {
  const total = paymentMethods.reduce((sum, pm) => sum + pm.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Métodos de cobro</CardTitle>
        {!isLoading && paymentMethods.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {formatCurrency(total)} cobrados, sin contar los cobros anulados.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : paymentMethods.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentMethods}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="amount"
                  nameKey="name"
                >
                  {paymentMethods.map((_, index: number) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  // El porcentaje solo no sirve para decidir: el dueño necesita
                  // el importe para cuadrar con la caja.
                  formatter={(value: number, _name, entry: any) => [
                    `${formatCurrency(value)} (${entry?.payload?.value ?? 0}%)`,
                    entry?.payload?.name ?? "Importe",
                  ]}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.5rem",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground text-center px-4">
              No se registró ningún cobro en este periodo
            </div>
          )}
        </div>

        {/* Leyenda propia con importes: la de recharts solo pinta el nombre. */}
        {!isLoading && paymentMethods.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {paymentMethods.map((pm, index) => (
              <li key={pm.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{pm.name}</span>
                </span>
                <span className="tabular-nums font-medium shrink-0">
                  {formatCurrency(pm.amount)}{" "}
                  <span className="text-muted-foreground font-normal">({pm.value}%)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
