"use client";

import { Button } from "@restai/ui/components/button";
import { SearchInput } from "@/components/search-input";

const statusConfig: Record<string, { label: string }> = {
  pending: { label: "Pendiente" },
  confirmed: { label: "Confirmado" },
  preparing: { label: "Preparando" },
  ready: { label: "Listo" },
  served: { label: "Servido" },
  completed: { label: "Completado" },
  cancelled: { label: "Cancelado" },
};

interface OrderFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

export function OrderFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: OrderFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Buscar por numero, mesa o cliente..."
        className="flex-1"
      />
      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "confirmed", "preparing", "ready", "served", "completed"].map(
          (status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => onStatusFilterChange(status)}
            >
              {status === "all"
                ? "Todos"
                : statusConfig[status]?.label || status}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
