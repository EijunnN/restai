"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Plus, RefreshCw } from "lucide-react";
import { useLoyaltyCustomers } from "@/hooks/use-loyalty";
import { SearchInput } from "@/components/search-input";
import { CreateCustomerDialog } from "./customer-dialog";

const tierConfig: Record<string, { label: string; color: string }> = {
  Bronce: {
    label: "Bronce",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  Plata: {
    label: "Plata",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300",
  },
  Oro: {
    label: "Oro",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  Platino: {
    label: "Platino",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export function CustomersTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(val: string) {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setTimer(t);
  }

  const { data, isLoading, error, refetch } = useLoyaltyCustomers(debouncedSearch || undefined);
  const customers: any[] = data ?? [];

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
        <p className="text-sm text-destructive">Error al cargar clientes: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <SearchInput
          value={search}
          onChange={handleSearch}
          placeholder="Buscar por nombre, email o telefono..."
          className="flex-1"
        />
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />Registrar Cliente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Cliente</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Telefono</th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">Tier</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-14 mx-auto rounded-full" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    </tr>
                  ))
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                      {debouncedSearch ? "No se encontraron clientes" : "No hay clientes registrados"}
                    </td>
                  </tr>
                ) : (
                  customers.map((customer: any) => {
                    const tierName = customer.tier_name || "Bronce";
                    const tier = tierConfig[tierName] || tierConfig.Bronce;
                    return (
                      <tr key={customer.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="p-3">
                          <Link href={`/loyalty/${customer.id}`} className="block">
                            <p className="font-medium text-sm text-foreground">{customer.name}</p>
                            {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                          </Link>
                        </td>
                        <td className="p-3 text-sm text-foreground hidden sm:table-cell">{customer.phone || "-"}</td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${tier.color}`}>{tier.label}</span>
                        </td>
                        <td className="p-3 text-sm font-medium text-right text-foreground">{(customer.points_balance || 0).toLocaleString()}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateCustomerDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
