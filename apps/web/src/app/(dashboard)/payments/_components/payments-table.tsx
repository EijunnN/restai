"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import {
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  FileText,
  Printer,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";

const methodLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

const methodIcons: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-4 w-4" />,
  card: <CreditCard className="h-4 w-4" />,
  yape: <Smartphone className="h-4 w-4" />,
  plin: <Smartphone className="h-4 w-4" />,
  transfer: <DollarSign className="h-4 w-4" />,
  other: <DollarSign className="h-4 w-4" />,
};

const allMethods = ["all", "cash", "card", "yape", "plin", "transfer", "other"];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface PaymentsTableProps {
  payments: any[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  methodFilter: string;
  onMethodFilterChange: (method: string) => void;
  onInvoice: (payment: any) => void;
  onReceipt: (payment: any) => void;
}

export function PaymentsTable({
  payments,
  isLoading,
  search,
  onSearchChange,
  methodFilter,
  onMethodFilterChange,
  onInvoice,
  onReceipt,
}: PaymentsTableProps) {
  const filteredPayments = payments.filter((p: any) => {
    const matchesSearch =
      (p.order_number || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.reference || "").toLowerCase().includes(search.toLowerCase());
    const matchesMethod = methodFilter === "all" || p.method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  return (
    <>
      {/* Method filter pills */}
      <div className="flex flex-wrap gap-2">
        {allMethods.map((method) => (
          <button
            key={method}
            onClick={() => onMethodFilterChange(method)}
            className={cn(
              "px-3 py-1 rounded-full text-sm transition-colors border",
              methodFilter === method
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {method === "all" ? "Todos" : methodLabels[method]}
          </button>
        ))}
      </div>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Buscar por orden o referencia..."
      />

      {/* Payment list table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Orden</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Metodo</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">Monto</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Propina</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Referencia</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden lg:table-cell">Fecha</th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="p-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3 hidden lg:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                      <td className="p-3"><Skeleton className="h-6 w-16 mx-auto" /></td>
                    </tr>
                  ))
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                      {search || methodFilter !== "all" ? "No se encontraron pagos" : "No hay pagos registrados"}
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment: any) => (
                    <tr key={payment.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-3 font-medium text-sm">{payment.order_number || "-"}</td>
                      <td className="p-3 text-sm">
                        <Badge variant="secondary" className="gap-1">
                          {methodIcons[payment.method]}
                          {methodLabels[payment.method] || payment.method}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm font-medium text-right">
                        {formatCurrency(payment.amount || 0)}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground text-right hidden sm:table-cell">
                        {(payment.tip || 0) > 0 ? formatCurrency(payment.tip) : "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                        {payment.reference || "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground text-right hidden lg:table-cell">
                        {payment.created_at ? formatDate(payment.created_at) : "-"}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onInvoice(payment)}
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            Comprobante
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => onReceipt(payment)}
                            title="Imprimir Boleta"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
