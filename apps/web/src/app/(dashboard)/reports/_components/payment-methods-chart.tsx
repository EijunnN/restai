"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import type { PaymentMethodShare } from "@/hooks/use-reports";
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const PIE_COLORS = ["#0f766e", "#2563eb", "#16a34a", "#d97706", "#e11d48", "#4b5563"];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface PaymentMethodsChartProps {
  paymentMethods: PaymentMethodShare[];
  isLoading: boolean;
}

export function PaymentMethodsChart({ paymentMethods, isLoading }: PaymentMethodsChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Metodos de Pago</CardTitle>
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
                  dataKey="value"
                >
                  {paymentMethods.map((_, index: number) => (
                    <Cell
                      key={index}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [`${value}%`, "Porcentaje"]}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.5rem",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No hay datos de metodos de pago
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
