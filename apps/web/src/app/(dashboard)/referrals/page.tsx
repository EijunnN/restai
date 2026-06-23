"use client";

import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { RefreshCw, Users, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { useReferrals, type ReferralRow } from "@/hooks/use-referrals";
import { PageHeader } from "@/components/page-header";
import { StatsGrid, StatCard, StatsGridSkeleton } from "@/components/stats-grid";
import { formatDate } from "@/lib/utils";

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  completed: { label: "Completado", variant: "default", className: "bg-green-600 hover:bg-green-600" },
  pending: { label: "Pendiente", variant: "outline" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export default function ReferralsPage() {
  const { data, isLoading, error, refetch } = useReferrals();

  const referrals: ReferralRow[] = data?.referrals ?? [];
  const stats = data?.stats ?? { total: 0, completed: 0, pending: 0, points_awarded: 0 };

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Referidos" />
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar referidos: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referidos"
        description="Sigue las invitaciones de tus clientes y los puntos otorgados"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      {isLoading ? (
        <StatsGridSkeleton count={4} />
      ) : (
        <StatsGrid>
          <StatCard title="Total Referidos" value={stats.total} icon={Users} />
          <StatCard
            title="Completados"
            value={stats.completed}
            icon={CheckCircle2}
            iconColor="text-green-600"
            iconBg="bg-green-500/10"
          />
          <StatCard
            title="Pendientes"
            value={stats.pending}
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-500/10"
          />
          <StatCard
            title="Puntos Otorgados"
            value={stats.points_awarded.toLocaleString()}
            icon={Sparkles}
          />
        </StatsGrid>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Referidor
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Referido
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Codigo
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Puntos
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                      <td className="p-3 hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="p-3 hidden lg:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                    </tr>
                  ))
                ) : referrals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                      Aun no hay referidos
                    </td>
                  </tr>
                ) : (
                  referrals.map((r) => {
                    const config = statusConfig[r.status] || {
                      label: r.status,
                      variant: "outline" as const,
                    };
                    const date = r.completed_at || r.created_at;
                    const points =
                      (r.referrer_points ?? 0) + (r.referee_points ?? 0);
                    return (
                      <tr
                        key={r.id}
                        className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="p-3 text-sm font-medium">
                          {r.referrer_name || "Cliente"}
                        </td>
                        <td className="p-3 text-sm">{r.referee_name || "Cliente"}</td>
                        <td className="p-3 hidden sm:table-cell">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {r.code}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant={config.variant} className={config.className}>
                            {config.label}
                          </Badge>
                        </td>
                        <td className="p-3 text-sm text-right tabular-nums hidden md:table-cell">
                          {r.status === "completed"
                            ? `${points.toLocaleString()} pts`
                            : "-"}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground text-right hidden lg:table-cell">
                          {date ? formatDate(date) : "-"}
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
