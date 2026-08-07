"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { BellRing, Check, Hand, Loader2, Receipt, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/fetcher";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import {
  useServiceRequests,
  useAcknowledgeServiceRequest,
  useResolveServiceRequest,
  formatElapsed,
  SERVICE_REQUEST_LABELS,
  type ServiceRequest,
} from "@/hooks/use-service-requests";

/**
 * Campos que el servidor añade al aviso y que el tipo compartido todavía no
 * declara. Se leen de forma opcional para no depender de ese archivo.
 */
type TrayRequest = ServiceRequest & {
  customer_name?: string | null;
  acknowledged_by_name?: string | null;
  response_seconds?: number | null;
};

interface ServiceRequestTrayProps {
  /** Mesas del mozo cuando la sede filtra por asignación; null = ver todas. */
  allowedTableIds: Set<string> | null;
}

/**
 * Bandeja de avisos de mesa.
 *
 * Es la pantalla que el mozo mira de reojo en hora punta, muchas veces desde
 * dos metros: el número de mesa manda, luego el tiempo que llevan esperando y
 * después todo lo demás. Los avisos persisten en la base de datos, así que ya
 * no desaparecen al refrescar ni se pierden si nadie tenía la pantalla abierta.
 */
export function ServiceRequestTray({ allowedTableIds }: ServiceRequestTrayProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } =
    useServiceRequests();
  const acknowledge = useAcknowledgeServiceRequest();
  const resolve = useResolveServiceRequest();
  const [busyId, setBusyId] = useState<string | null>(null);
  // "Voy" y "Resuelto" exigen `tables:update`. Quien solo mira la sala (caja,
  // cocina) ve la bandeja, pero no botones que le responderían 403.
  const role = useAuthStore((state) => state.user?.role);
  const canAct = hasPermission(role, "tables:update");

  // El servidor manda `elapsed_seconds` en el instante de la respuesta. Sin un
  // reloj local, la espera se congelaría hasta el siguiente refresco y "hace
  // 1 min" seguiría diciendo lo mismo cinco minutos después.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const requests = useMemo(() => {
    const list = (data ?? []) as TrayRequest[];
    if (!allowedTableIds) return list;
    // Un aviso sin mesa no es de nadie en concreto: se enseña siempre.
    return list.filter((r) => !r.table_id || allowedTableIds.has(r.table_id));
  }, [data, allowedTableIds]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const acknowledgedCount = requests.filter((r) => r.status === "acknowledged").length;

  const elapsedFor = (request: TrayRequest) => {
    const drift = dataUpdatedAt ? Math.max(0, Math.floor((now - dataUpdatedAt) / 1000)) : 0;
    return request.elapsed_seconds + drift;
  };

  const handleAction = async (
    request: TrayRequest,
    action: "ack" | "resolve",
  ) => {
    setBusyId(request.id);
    try {
      if (action === "ack") {
        await acknowledge.mutateAsync(request.id);
        toast.success(`Vas a la mesa ${request.table_number ?? "-"}`);
      } else {
        await resolve.mutateAsync(request.id);
        toast.success(`Aviso de la mesa ${request.table_number ?? "-"} resuelto`);
      }
    } catch (err) {
      // Un 409 significa que un compañero se adelantó. No es un fallo y NUNCA
      // hay que reintentarlo: se relee la bandeja y se cuenta lo que pasó.
      if (err instanceof ApiError && err.status === 409) {
        toast.info(err.message);
        void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      } else {
        toast.error(
          err instanceof Error ? err.message : "No se pudo actualizar el aviso",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <BellRing className="h-5 w-5 text-orange-500" aria-hidden="true" />
              Avisos de mesa
            </h2>
            <p className="text-sm text-muted-foreground">
              {pendingCount} sin atender
              {acknowledgedCount > 0 && ` · ${acknowledgedCount} en camino`}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Actualizar
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
            role="alert"
          >
            <p className="text-sm text-destructive">
              No se pudieron cargar los avisos
              {error instanceof Error ? `: ${error.message}` : "."}
            </p>
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">Ninguna mesa está esperando</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Aquí aparecerán las mesas que pidan la cuenta o llamen al mozo, con el
              tiempo que llevan esperando.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" aria-live="polite" aria-label="Avisos de mesa sin resolver">
            {requests.map((request) => {
              const isBill = request.type === "request_bill";
              const isPending = request.status === "pending";
              const busy = busyId === request.id;
              const elapsed = elapsedFor(request);
              // Cinco minutos esperando ya es una queja en potencia.
              const urgent = isPending && elapsed >= 300;

              return (
                <li
                  key={request.id}
                  className={cn(
                    "flex flex-wrap items-center gap-4 rounded-xl border-2 p-4",
                    urgent
                      ? "border-red-500/70 bg-red-50 dark:bg-red-950/20"
                      : isPending
                        ? "border-orange-400/60 bg-orange-50 dark:bg-orange-950/20"
                        : "border-border bg-muted/30",
                  )}
                >
                  {/* El número de mesa es lo que se lee a distancia */}
                  <div className="flex min-w-[5rem] flex-col items-center">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Mesa
                    </span>
                    <span className="text-5xl font-black leading-none tabular-nums">
                      {request.table_number ?? "-"}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-base font-bold">
                      {isBill ? (
                        <Receipt className="h-5 w-5 text-blue-600" aria-hidden="true" />
                      ) : (
                        <Hand className="h-5 w-5 text-orange-600" aria-hidden="true" />
                      )}
                      {SERVICE_REQUEST_LABELS[request.type]}
                    </p>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        urgent ? "text-red-600 dark:text-red-400" : "text-foreground",
                      )}
                    >
                      Esperando {formatElapsed(elapsed)}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {request.customer_name || "Cliente"}
                      {request.status === "acknowledged" && (
                        <>
                          {" · "}
                          <span className="font-medium text-foreground">
                            {request.acknowledged_by_name
                              ? `${request.acknowledged_by_name} va en camino`
                              : "Alguien va en camino"}
                          </span>
                        </>
                      )}
                    </p>
                    {request.note && (
                      <p className="mt-1 text-sm italic text-muted-foreground">
                        “{request.note}”
                      </p>
                    )}
                  </div>

                  <div className={cn("flex w-full gap-2 sm:w-auto", !canAct && "hidden")}>
                    {isPending && (
                      <Button
                        className="h-12 flex-1 text-base font-bold sm:flex-none sm:px-6"
                        disabled={busy}
                        onClick={() => void handleAction(request, "ack")}
                      >
                        {busy && acknowledge.isPending ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Hand className="mr-2 h-5 w-5" aria-hidden="true" />
                        )}
                        Voy
                      </Button>
                    )}
                    <Button
                      variant={isPending ? "outline" : "default"}
                      className="h-12 flex-1 text-base font-bold sm:flex-none sm:px-6"
                      disabled={busy}
                      onClick={() => void handleAction(request, "resolve")}
                    >
                      {busy && resolve.isPending ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="mr-2 h-5 w-5" aria-hidden="true" />
                      )}
                      Resuelto
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
