"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { apiFetch } from "@/lib/fetcher";
import { useCreateCustomer } from "@/hooks/use-loyalty";
import type { PosCustomer } from "../page";

/**
 * Buscador de cliente del POS.
 *
 * Hasta ahora el POS solo tenía un campo de texto libre, así que NINGUNA venta de
 * mostrador otorgaba puntos: la fidelización no existía en el canal principal.
 * POST /api/orders acepta `customerId`, y es ese id —no el nombre— lo que hace
 * que la venta sume puntos.
 */

interface LoyaltyCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  points_balance: number | null;
  tier_name: string | null;
}

export function CustomerPicker({
  customer,
  onChange,
  className,
}: {
  customer: PosCustomer | null;
  onChange: (customer: PosCustomer | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const role = useAuthStore((state) => state.user?.role);
  const canCreate = hasPermission(role, "customers:create");

  // Se busca contra el servidor: sin retardo, cada tecla lanzaría una petición.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Misma clave de caché que la pantalla de Fidelización, para compartir datos y
  // que `useCreateCustomer` la invalide sola. Solo se consulta con el diálogo
  // abierto: el POS no debe pedir la lista de clientes al cargar la pantalla.
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["loyalty", "customers", debouncedSearch || undefined, 1],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("page", "1");
      return apiFetch(`/api/loyalty/customers?${params.toString()}`);
    },
    enabled: open,
    // Se conservan los resultados anteriores mientras llega la nueva búsqueda: sin
    // esto la lista parpadeaba a esqueleto con cada tecla y el cajero perdía de
    // vista al cliente que ya estaba mirando.
    placeholderData: (previous) => previous,
  });

  const createCustomer = useCreateCustomer();

  const results = useMemo<LoyaltyCustomerRow[]>(
    () => ((data as any)?.customers ?? []) as LoyaltyCustomerRow[],
    [data],
  );
  /** Total que cumple la búsqueda: la API pagina de 20 en 20. */
  const totalMatches: number = (data as any)?.pagination?.total ?? results.length;

  const resetDialog = () => {
    setSearch("");
    setDebouncedSearch("");
    setCreating(false);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) resetDialog();
  };

  const select = (row: LoyaltyCustomerRow) => {
    onChange({
      id: row.id,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      pointsBalance: row.points_balance ?? 0,
    });
    handleOpenChange(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("El nombre del cliente es obligatorio");
      return;
    }
    const email = newEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("El correo no tiene un formato válido");
      return;
    }
    try {
      const created: any = await createCustomer.mutateAsync({
        name,
        phone: newPhone.trim() || undefined,
        email: email || undefined,
      });
      onChange({
        id: created.id,
        name: created.name,
        phone: created.phone ?? null,
        email: created.email ?? null,
        pointsBalance: created.loyalty?.points_balance ?? 0,
      });
      toast.success(`Cliente ${created.name} listo para sumar puntos`);
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo crear el cliente");
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {customer ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <UserRound className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{customer.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {customer.pointsBalance} {customer.pointsBalance === 1 ? "punto" : "puntos"}
              {customer.phone ? ` · ${customer.phone}` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => onChange(null)}
            aria-label="Quitar el cliente identificado"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-start gap-2 px-3 text-sm font-medium"
          onClick={() => setOpen(true)}
          aria-label="Identificar al cliente para que la venta sume puntos"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground">
            Identificar cliente (suma puntos)
          </span>
        </Button>
      )}

      {customer ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium leading-snug text-primary">
          <Sparkles className="h-3 w-3 shrink-0" />
          Esta venta sumará puntos a {customer.name}.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Sin cliente identificado la venta no suma puntos.
        </p>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>{creating ? "Nuevo cliente" : "Buscar cliente"}</DialogTitle>
            <DialogDescription>
              {creating
                ? "Se crea y queda inscrito en fidelización al instante."
                : "Busca por teléfono, nombre o correo. El cliente identificado sumará los puntos de esta venta."}
            </DialogDescription>
          </DialogHeader>

          {creating ? (
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="pos-new-customer-name">Nombre *</Label>
                <Input
                  id="pos-new-customer-name"
                  className="h-11"
                  placeholder="Nombre y apellido"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-new-customer-phone">Teléfono</Label>
                <Input
                  id="pos-new-customer-phone"
                  className="h-11"
                  type="tel"
                  inputMode="tel"
                  placeholder="999 888 777"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Con teléfono no se duplica: si ya existe, se reutiliza su ficha.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-new-customer-email">Correo</Label>
                <Input
                  id="pos-new-customer-email"
                  className="h-11"
                  type="email"
                  inputMode="email"
                  placeholder="cliente@correo.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => setCreating(false)}
                  disabled={createCustomer.isPending}
                >
                  Volver a buscar
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-1"
                  onClick={handleCreate}
                  disabled={createCustomer.isPending || !newName.trim()}
                >
                  {createCustomer.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creando…
                    </>
                  ) : (
                    "Crear y usar"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-11 pl-9"
                  placeholder="Teléfono, nombre o correo…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  aria-label="Buscar cliente por teléfono, nombre o correo"
                />
                {isFetching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-14 animate-pulse rounded-xl border border-border/60 bg-muted"
                    />
                  ))
                ) : isError ? (
                  <div
                    role="alert"
                    className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
                  >
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <p className="text-sm text-muted-foreground">
                      {(error as Error)?.message || "No se pudo buscar clientes."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10"
                      onClick={() => refetch()}
                      disabled={isFetching}
                    >
                      <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
                      Reintentar
                    </Button>
                  </div>
                ) : results.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <p className="text-sm font-medium">
                      {debouncedSearch
                        ? `Ningún cliente coincide con "${debouncedSearch}"`
                        : "Todavía no hay clientes registrados"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {canCreate
                        ? "Créalo en el momento y la venta ya sumará puntos."
                        : "Pide a un responsable que dé de alta al cliente."}
                    </p>
                  </div>
                ) : (
                  <>
                    {totalMatches > results.length && (
                      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
                        Se muestran {results.length} de {totalMatches} clientes. Afina la
                        búsqueda con el teléfono para encontrar al tuyo.
                      </p>
                    )}
                    {results.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => select(row)}
                        aria-label={`Elegir a ${row.name}, ${row.points_balance ?? 0} puntos`}
                        className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                          <UserRound className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{row.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.phone || row.email || "Sin datos de contacto"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums">
                            {row.points_balance ?? 0}
                          </p>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {row.tier_name || "puntos"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>

              {canCreate && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => {
                    // Lo tecleado en la búsqueda suele ser el teléfono o el nombre:
                    // se arrastra al alta para no volver a escribirlo.
                    const typed = search.trim();
                    if (typed) {
                      if (/^[\d\s+()-]+$/.test(typed)) setNewPhone(typed);
                      else setNewName(typed);
                    }
                    setCreating(true);
                  }}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Crear cliente nuevo
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
