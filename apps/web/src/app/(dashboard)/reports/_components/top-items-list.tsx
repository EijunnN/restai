"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { formatCurrency } from "@/lib/utils";
import type { TopItemReport } from "@/hooks/use-reports";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface TopItemsListProps {
  topItems: TopItemReport[];
  isLoading: boolean;
}

export function TopItemsList({ topItems, isLoading }: TopItemsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Productos</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-6 w-6" />
                  <div>
                    <Skeleton className="h-4 w-28 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : topItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay datos de productos
          </p>
        ) : (
          <div className="space-y-3">
            {topItems.map((item, index: number) => (
              <div
                key={item.name || index}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground w-6 text-center">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-medium text-sm">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.totalQuantity} vendidos
                    </p>
                  </div>
                </div>
                <span className="font-medium text-sm">
                  {formatCurrency(item.totalRevenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
