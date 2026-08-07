"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@restai/ui/components/button";
import { RefreshCw, Users, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { useReferrals, type ReferralRow } from "@/hooks/use-referrals";
import { PageHeader } from "@/components/page-header";
import { StatsGrid, StatCard, StatsGridSkeleton } from "@/components/stats-grid";
import { ReferralConfigCard } from "./_components/referral-config-card";
import { ReferralsList } from "./_components/referrals-list";

export default function ReferralsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useReferrals();

  const referrals: ReferralRow[] = data?.referrals ?? [];
  const stats = data?.stats ?? { total: 0, completed: 0, pending: 0, points_awarded: 0 };

  // Refresca listado y configuración a la vez: ambos cuelgan de la clave
  // "referrals", así que una sola invalidación cubre toda la pantalla.
  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["referrals"] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referidos"
        description="Configura lo que paga invitar y sigue las invitaciones de tus clientes"
        actions={
          <Button
            variant="outline"
            className="h-10"
            onClick={refreshAll}
            disabled={isFetching}
            aria-label="Actualizar referidos"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      <ReferralConfigCard />

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar los referidos: {(error as Error).message}
          </p>
          <Button
            variant="outline"
            className="h-10 shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {isLoading ? (
            <StatsGridSkeleton count={4} />
          ) : (
            <StatsGrid>
              <StatCard title="Total de referidos" value={stats.total} icon={Users} />
              <StatCard
                title="Completados"
                value={stats.completed}
                icon={CheckCircle2}
                iconColor="text-green-600"
                iconBg="bg-green-500/10"
                description="El invitado ya pagó su primer pedido"
              />
              <StatCard
                title="Pendientes"
                value={stats.pending}
                icon={Clock}
                iconColor="text-amber-600"
                iconBg="bg-amber-500/10"
                description="Registrados, aún sin primer pedido"
              />
              <StatCard
                title="Puntos otorgados"
                value={stats.points_awarded.toLocaleString("es-PE")}
                icon={Sparkles}
              />
            </StatsGrid>
          )}

          <ReferralsList referrals={referrals} isLoading={isLoading} />
        </>
      )}
    </div>
  );
}
