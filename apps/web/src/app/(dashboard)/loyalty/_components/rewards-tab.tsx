"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Plus, Gift, Award } from "lucide-react";
import { useLoyaltyRewards, useLoyaltyPrograms } from "@/hooks/use-loyalty";
import { formatCurrency } from "@/lib/utils";
import { CreateRewardDialog } from "./reward-dialog";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export function RewardsTab() {
  const { data: rewards, isLoading: rewardsLoading } = useLoyaltyRewards();
  const { data: programs } = useLoyaltyPrograms();
  const [showCreate, setShowCreate] = useState(false);

  const rewardsList: any[] = rewards ?? [];
  const programsList: any[] = programs ?? [];
  const programId = programsList[0]?.id;

  if (rewardsLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton className="h-4 w-48 mb-4" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} disabled={!programId}>
          <Plus className="h-4 w-4 mr-2" />Crear Recompensa
        </Button>
      </div>

      {!programId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Award className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Debes crear un programa de fidelizacion primero</p>
          </CardContent>
        </Card>
      )}

      {rewardsList.length === 0 && programId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Gift className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-1">No hay recompensas creadas</p>
            <p className="text-xs text-muted-foreground">Crea recompensas para que tus clientes canjeen sus puntos</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rewardsList.map((reward: any) => (
          <Card key={reward.id} className="relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1.5 rounded-bl-lg">
              <p className="text-sm font-bold">{reward.points_cost.toLocaleString()} pts</p>
            </div>
            <CardContent className="p-5 pt-4">
              <div className="pr-20">
                <p className="font-semibold text-foreground">{reward.name}</p>
                {reward.description && <p className="text-xs text-muted-foreground mt-1">{reward.description}</p>}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {reward.discount_type === "percentage" ? `${reward.discount_value}% descuento` : `${formatCurrency(reward.discount_value)} descuento`}
                </Badge>
                {reward.is_active && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-300 dark:text-green-400 dark:border-green-700">Activa</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {programId && <CreateRewardDialog open={showCreate} onOpenChange={setShowCreate} programId={programId} />}
    </div>
  );
}
