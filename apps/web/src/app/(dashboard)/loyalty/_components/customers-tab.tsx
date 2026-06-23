"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Sparkles,
  Users as UsersIcon,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Download,
  ShieldOff,
} from "lucide-react";
import {
  useLoyaltyCustomers,
  useDeleteCustomer,
  useAdjustPoints,
  useMergeCustomers,
  useExportCustomer,
  useAnonymizeCustomer,
} from "@/hooks/use-loyalty";
import { SearchInput } from "@/components/search-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CustomerDialog } from "./customer-dialog";
import { toast } from "sonner";

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

// ---------------------------------------------------------------------------
// Adjust points dialog
// ---------------------------------------------------------------------------
function AdjustPointsDialog({
  customer,
  onOpenChange,
}: {
  customer: { id: string; name: string; points_balance?: number } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const adjustPoints = useAdjustPoints();
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  function reset() {
    setDirection("add");
    setAmount("");
    setReason("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    const raw = parseInt(amount, 10);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast.error("Ingresa una cantidad valida mayor a 0");
      return;
    }
    if (!reason.trim()) {
      toast.error("Ingresa un motivo");
      return;
    }
    const signed = direction === "add" ? raw : -raw;
    adjustPoints.mutate(
      { id: customer.id, amount: signed, reason: reason.trim() },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
          toast.success("Puntos ajustados");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => { if (!v) { reset(); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar puntos</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cliente: <span className="font-medium text-foreground">{customer?.name}</span>
            {typeof customer?.points_balance === "number" && (
              <>
                {" "}- saldo actual{" "}
                <span className="font-medium text-foreground">
                  {customer.points_balance.toLocaleString()} pts
                </span>
              </>
            )}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={direction === "add" ? "default" : "outline"}
              onClick={() => setDirection("add")}
            >
              <ArrowUp className="h-4 w-4 mr-2" />Agregar
            </Button>
            <Button
              type="button"
              variant={direction === "subtract" ? "default" : "outline"}
              onClick={() => setDirection("subtract")}
            >
              <ArrowDown className="h-4 w-4 mr-2" />Restar
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-amount">Cantidad de puntos</Label>
            <Input
              id="adjust-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Motivo *</Label>
            <Input
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: correccion manual, cortesia, etc."
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={adjustPoints.isPending}>
              {adjustPoints.isPending ? "Guardando..." : "Aplicar ajuste"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Merge dialog
// ---------------------------------------------------------------------------
function MergeDialog({
  target,
  candidates,
  onOpenChange,
}: {
  target: { id: string; name: string } | null;
  candidates: any[];
  onOpenChange: (open: boolean) => void;
}) {
  const mergeCustomers = useMergeCustomers();
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);

  function reset() {
    setSourceSearch("");
    setSourceId(null);
  }

  const filtered = candidates
    .filter((c) => c.id !== target?.id)
    .filter((c) => {
      if (!sourceSearch) return true;
      const q = sourceSearch.toLowerCase();
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
      );
    });

  function handleMerge() {
    if (!target || !sourceId) return;
    mergeCustomers.mutate(
      { id: target.id, sourceCustomerId: sourceId },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
          toast.success("Clientes fusionados");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v) { reset(); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionar clientes</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Se conservara <span className="font-medium text-foreground">{target?.name}</span> y
            se absorbera el cliente duplicado que elijas (sus puntos, transacciones y pedidos se
            transferiran). El duplicado sera eliminado. Esta accion no se puede deshacer.
          </p>

          <div className="space-y-2">
            <Label>Cliente duplicado a fusionar</Label>
            <SearchInput
              value={sourceSearch}
              onChange={setSourceSearch}
              placeholder="Buscar duplicado..."
            />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {filtered.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground text-center">
                  No hay otros clientes en esta pagina. Usa el buscador.
                </p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSourceId(c.id)}
                    className={`flex w-full items-center justify-between gap-2 p-3 text-left text-sm transition-colors hover:bg-muted/50 ${
                      sourceId === c.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.email || c.phone || "Sin contacto"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(c.points_balance || 0).toLocaleString()} pts
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!sourceId || mergeCustomers.isPending}
            onClick={handleMerge}
          >
            {mergeCustomers.isPending ? "Fusionando..." : "Fusionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Anonymize dialog (Ley 29733 — irreversible)
// ---------------------------------------------------------------------------
function AnonymizeDialog({
  customer,
  onOpenChange,
}: {
  customer: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const anonymize = useAnonymizeCustomer();
  const [confirmText, setConfirmText] = useState("");

  function reset() {
    setConfirmText("");
  }

  function handleAnonymize() {
    if (!customer) return;
    anonymize.mutate(customer.id, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
        toast.success("Cliente anonimizado");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => { if (!v) { reset(); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-5 w-5" />
            Anonimizar cliente
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2">
            <p className="text-sm text-destructive font-medium">
              Esta accion es irreversible.
            </p>
            <p className="text-sm text-muted-foreground">
              Se eliminaran de forma permanente los datos personales de{" "}
              <span className="font-medium text-foreground">{customer?.name}</span>{" "}
              (nombre, telefono, email, fecha de nacimiento) en cumplimiento de la Ley
              29733 de Proteccion de Datos Personales. El historial de pedidos y las
              metricas agregadas se conservan de forma anonima. No se puede deshacer.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="anonymize-confirm">
              Escribe <span className="font-semibold text-foreground">ANONIMIZAR</span> para confirmar
            </Label>
            <Input
              id="anonymize-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ANONIMIZAR"
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={confirmText.trim().toUpperCase() !== "ANONIMIZAR" || anonymize.isPending}
            onClick={handleAnonymize}
          >
            {anonymize.isPending ? "Anonimizando..." : "Anonimizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Customers tab
// ---------------------------------------------------------------------------
export function CustomersTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any | null>(null);
  const [adjustCustomer, setAdjustCustomer] = useState<any | null>(null);
  const [mergeTarget, setMergeTarget] = useState<any | null>(null);
  const [anonymizeTarget, setAnonymizeTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setTimer(t);
  }

  const { data, isLoading, error, refetch } = useLoyaltyCustomers(debouncedSearch || undefined, page);
  const customers: any[] = data?.customers ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const deleteCustomer = useDeleteCustomer();
  const exportCustomer = useExportCustomer();

  function handleExport(customer: { id: string; name: string }) {
    exportCustomer.mutate(
      { id: customer.id, name: customer.name },
      {
        onSuccess: () => toast.success("Datos del cliente exportados"),
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

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
                  <th className="w-32 p-3" />
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
                      <td className="p-3" />
                    </tr>
                  ))
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
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
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm text-foreground">{customer.name}</p>
                              {customer.anonymized_at && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                                  <ShieldOff className="h-3 w-3" />
                                  Anonimizado
                                </span>
                              )}
                            </div>
                            {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                          </Link>
                        </td>
                        <td className="p-3 text-sm text-foreground hidden sm:table-cell">{customer.phone || "-"}</td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${tier.color}`}>{tier.label}</span>
                        </td>
                        <td className="p-3 text-sm font-medium text-right text-foreground">{(customer.points_balance || 0).toLocaleString()}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Ajustar puntos"
                              onClick={() => setAdjustCustomer(customer)}
                            >
                              <Sparkles className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Fusionar"
                              onClick={() => setMergeTarget(customer)}
                            >
                              <UsersIcon className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Exportar datos"
                              disabled={exportCustomer.isPending}
                              onClick={() => handleExport({ id: customer.id, name: customer.name })}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Editar"
                              onClick={() => setEditCustomer(customer)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!customer.anonymized_at && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                title="Anonimizar (Ley 29733)"
                                onClick={() => setAnonymizeTarget({ id: customer.id, name: customer.name })}
                              >
                                <ShieldOff className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Eliminar"
                              onClick={() => setDeleteConfirm({ id: customer.id, name: customer.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {pagination.total} clientes en total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {pagination.page} de {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create */}
      <CustomerDialog open={showCreate} onOpenChange={setShowCreate} />

      {/* Edit */}
      <CustomerDialog
        key={editCustomer?.id ?? "edit"}
        open={!!editCustomer}
        onOpenChange={(v) => !v && setEditCustomer(null)}
        editData={editCustomer ?? undefined}
      />

      {/* Adjust points */}
      <AdjustPointsDialog
        customer={adjustCustomer}
        onOpenChange={(v) => !v && setAdjustCustomer(null)}
      />

      {/* Merge */}
      <MergeDialog
        target={mergeTarget}
        candidates={customers}
        onOpenChange={(v) => !v && setMergeTarget(null)}
      />

      {/* Anonymize (Ley 29733) */}
      <AnonymizeDialog
        customer={anonymizeTarget}
        onOpenChange={(v) => !v && setAnonymizeTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title="Eliminar cliente"
        description={`Se eliminara a "${deleteConfirm?.name}" y todos sus datos de loyalty (puntos, transacciones, cupones). Los pedidos existentes se conservaran. Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (deleteConfirm) {
            deleteCustomer.mutate(deleteConfirm.id, {
              onSuccess: () => setDeleteConfirm(null),
            });
          }
        }}
        loading={deleteCustomer.isPending}
      />
    </div>
  );
}
