"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  Star,
  Trophy,
  Gift,
  TrendingUp,
  TrendingDown,
  RefreshCw,
} from "lucide-react";
import {
  useLoyaltyCustomer,
  useCustomerTransactions,
  useLoyaltyRewards,
  useRedeemReward,
} from "@/hooks/use-loyalty";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

const tierConfig: Record<string, { label: string; color: string }> = {
  Bronce: {
    label: "Bronce",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  Plata: {
    label: "Plata",
    color:
      "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300",
  },
  Oro: {
    label: "Oro",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  Platino: {
    label: "Platino",
    color:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
};

const txTypeConfig: Record<string, { label: string; color: string }> = {
  earned: {
    label: "Ganado",
    color:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  redeemed: {
    label: "Canjeado",
    color:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  adjusted: {
    label: "Ajuste",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  expired: {
    label: "Expirado",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    data: customer,
    isLoading,
    error,
    refetch,
  } = useLoyaltyCustomer(id);
  const { data: transactionsData } = useCustomerTransactions(id);
  const { data: rewardsData } = useLoyaltyRewards();
  const redeemReward = useRedeemReward();

  const [redeemOpen, setRedeemOpen] = useState(false);
  const [selectedRewardId, setSelectedRewardId] = useState("none");

  const transactions: any[] = transactionsData ?? [];
  const rewards: any[] = rewardsData ?? [];
  const loyalty = customer?.loyalty;

  function handleRedeem() {
    if (!selectedRewardId || selectedRewardId === "none" || !loyalty?.id) return;
    redeemReward.mutate(
      { rewardId: selectedRewardId, customerLoyaltyId: loyalty.id },
      {
        onSuccess: () => {
          setRedeemOpen(false);
          setSelectedRewardId("none");
          toast.success("Recompensa canjeada exitosamente");
          refetch();
        },
        onError: (err) => {
          toast.error(`Error: ${(err as Error).message}`);
        },
      }
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link
          href="/loyalty"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver
        </Link>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar cliente: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Link
          href="/loyalty"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver
        </Link>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-6">
        <Link
          href="/loyalty"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver
        </Link>
        <p className="text-muted-foreground">Cliente no encontrado</p>
      </div>
    );
  }

  const tierName = loyalty?.tier_name || "Bronce";
  const tier = tierConfig[tierName] || tierConfig.Bronce;

  return (
    <div className="space-y-6">
      <Link
        href="/loyalty"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Volver a clientes
      </Link>

      {/* Customer Info + Loyalty Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Customer Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {customer.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.email && (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {customer.email}
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {customer.phone}
              </div>
            )}
            {customer.birth_date && (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {customer.birth_date}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Cliente desde {formatDate(customer.created_at)}
            </div>
          </CardContent>
        </Card>

        {/* Loyalty Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Puntos de Lealtad
              </CardTitle>
              <span
                className={`text-xs px-2 py-1 rounded-full font-medium ${tier.color}`}
              >
                {tier.label}
              </span>
            </div>
            {loyalty?.program_name && (
              <CardDescription>{loyalty.program_name}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {loyalty ? (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-4xl font-bold text-foreground">
                    {(loyalty.points_balance || 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    puntos disponibles
                  </p>
                </div>
                <div className="flex justify-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="font-medium text-foreground">
                      {(loyalty.total_points_earned || 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      total ganados
                    </p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <Button onClick={() => setRedeemOpen(true)} size="sm">
                    <Gift className="h-4 w-4 mr-2" />
                    Canjear Recompensa
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No inscrito en programa de lealtad
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Redeem Rewards Section */}
      {loyalty && rewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-5 w-5" />
              Recompensas Disponibles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rewards.map((reward: any) => {
                const canRedeem =
                  (loyalty.points_balance || 0) >= reward.points_cost;
                return (
                  <div
                    key={reward.id}
                    className={`rounded-lg border border-border p-4 ${canRedeem ? "bg-muted/20" : "opacity-50"}`}
                  >
                    <p className="font-medium text-sm text-foreground">
                      {reward.name}
                    </p>
                    {reward.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {reward.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <Badge variant="secondary">
                        {reward.points_cost.toLocaleString()} pts
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        {reward.discount_type === "percentage"
                          ? `${reward.discount_value}%`
                          : `S/ ${(reward.discount_value / 100).toFixed(2)}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5" />
            Historial de Transacciones
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Fecha
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                    Tipo
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                    Puntos
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Descripcion
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      No hay transacciones registradas
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx: any) => {
                    const txType =
                      txTypeConfig[tx.type] || txTypeConfig.adjusted;
                    const isPositive = tx.points > 0;
                    return (
                      <tr
                        key={tx.id}
                        className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="p-3 text-sm text-foreground">
                          {formatDate(tx.created_at)}
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`text-xs px-2 py-1 rounded-full font-medium ${txType.color}`}
                          >
                            {txType.label}
                          </span>
                        </td>
                        <td className="p-3 text-sm font-medium text-right">
                          <span
                            className={`inline-flex items-center gap-1 ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {isPositive ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {isPositive ? "+" : ""}
                            {tx.points.toLocaleString()}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">
                          {tx.description || "-"}
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

      {/* Redeem Dialog */}
      <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Canjear Recompensa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Puntos disponibles:{" "}
              <span className="font-bold text-foreground">
                {(loyalty?.points_balance || 0).toLocaleString()}
              </span>
            </p>
            <Select value={selectedRewardId} onValueChange={setSelectedRewardId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar recompensa..." />
              </SelectTrigger>
              <SelectContent>
                {rewards.map((r: any) => (
                  <SelectItem
                    key={r.id}
                    value={r.id}
                    disabled={
                      r.points_cost > (loyalty?.points_balance || 0)
                    }
                  >
                    {r.name} - {r.points_cost.toLocaleString()} pts
                    {r.points_cost > (loyalty?.points_balance || 0)
                      ? " (insuficientes)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRedeemOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRedeem}
              disabled={redeemReward.isPending || !selectedRewardId || selectedRewardId === "none"}
            >
              {redeemReward.isPending ? "Canjeando..." : "Canjear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
