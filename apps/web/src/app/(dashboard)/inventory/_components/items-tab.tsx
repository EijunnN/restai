"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { Plus, AlertTriangle } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

export function ItemsTab({
  items,
  isLoading,
  search,
  setSearch,
  onNewItem,
}: {
  items: any[];
  isLoading: boolean;
  search: string;
  setSearch: (s: string) => void;
  onNewItem: () => void;
}) {
  const filteredItems = items.filter((item: any) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar item..."
          className="flex-1"
        />
        <Button onClick={onNewItem}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Item
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Nombre
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Unidad
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                    Stock Actual
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Stock Min.
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Costo
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="p-3">
                        <Skeleton className="h-4 w-28" />
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <Skeleton className="h-4 w-12 mx-auto" />
                      </td>
                      <td className="p-3">
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <Skeleton className="h-4 w-14 ml-auto" />
                      </td>
                      <td className="p-3">
                        <Skeleton className="h-5 w-12 mx-auto rounded-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      {search
                        ? "No se encontraron items"
                        : "No hay items en inventario"}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item: any) => {
                    const currentStock = parseFloat(
                      item.current_stock ?? "0"
                    );
                    const minStock = parseFloat(item.min_stock ?? "0");
                    const costPerUnit = item.cost_per_unit ?? 0;
                    const isLow = currentStock < minStock;
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b border-border last:border-0 hover:bg-muted/50 transition-colors",
                          isLow && "bg-destructive/5"
                        )}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {isLow && (
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                            )}
                            <span className="font-medium text-sm text-foreground">
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-sm text-center text-muted-foreground hidden sm:table-cell">
                          {item.unit}
                        </td>
                        <td
                          className={cn(
                            "p-3 text-sm font-medium text-right",
                            isLow
                              ? "text-destructive"
                              : "text-foreground"
                          )}
                        >
                          {currentStock.toFixed(2)}
                        </td>
                        <td className="p-3 text-sm text-right text-muted-foreground hidden md:table-cell">
                          {minStock.toFixed(2)}
                        </td>
                        <td className="p-3 text-sm text-right text-muted-foreground hidden md:table-cell">
                          {formatCurrency(costPerUnit)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={isLow ? "destructive" : "secondary"}
                          >
                            {isLow ? "Bajo" : "OK"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
