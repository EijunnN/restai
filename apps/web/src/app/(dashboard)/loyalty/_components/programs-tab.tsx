"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Plus,
  Star,
  Users,
  TrendingUp,
  Gift,
  Award,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useLoyaltyStats,
  useLoyaltyPrograms,
  useDeleteProgram,
  useDeleteTier,
} from "@/hooks/use-loyalty";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { ProgramDialog } from "./program-dialog";
import { TierDialog } from "./tier-dialog";

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

function OnboardingGuide({ onCreateProgram }: { onCreateProgram: () => void }) {
  const steps = [
    {
      number: 1, title: "Crea tu programa",
      description: "Define como tus clientes ganan puntos con cada compra. Configura la tasa de puntos por sol gastado.",
      icon: Star, color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/30",
    },
    {
      number: 2, title: "Registra clientes",
      description: "Agrega clientes manualmente o deja que se registren automaticamente al escanear el QR de la mesa.",
      icon: Users, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      number: 3, title: "Puntos automaticos",
      description: "Los clientes acumulan puntos automaticamente cada vez que completan un pedido en tu restaurante.",
      icon: TrendingUp, color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30",
    },
    {
      number: 4, title: "Crea recompensas",
      description: "Define descuentos y beneficios que tus clientes pueden canjear con sus puntos acumulados.",
      icon: Gift, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/30",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Award className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Configura tu programa de fidelizacion</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Recompensa a tus clientes frecuentes y aumenta la retencion con un sistema de puntos facil de usar.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {steps.map((step) => (
          <Card key={step.number} className="relative overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${step.bg}`}>
                  <step.icon className={`h-5 w-5 ${step.color}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Paso {step.number}</span>
                  </div>
                  <p className="font-medium text-sm text-foreground">{step.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-center">
        <Button size="lg" onClick={onCreateProgram}>
          <Plus className="h-4 w-4 mr-2" />
          Comenzar - Crear Programa
        </Button>
      </div>
    </div>
  );
}

export function ProgramsTab() {
  const { data, isLoading } = useLoyaltyPrograms();
  const { data: stats } = useLoyaltyStats();
  const deleteProgram = useDeleteProgram();
  const deleteTier = useDeleteTier();

  const [showCreate, setShowCreate] = useState(false);
  const [editProgram, setEditProgram] = useState<any>(null);
  const [tierDialog, setTierDialog] = useState<{ open: boolean; programId: string; editData?: any }>({ open: false, programId: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string } | null>(null);

  const programs: any[] = data ?? [];

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32 w-full" /></div>;
  }

  if (programs.length === 0) {
    return (
      <div className="space-y-4">
        <OnboardingGuide onCreateProgram={() => setShowCreate(true)} />
        <ProgramDialog open={showCreate} onOpenChange={setShowCreate} />
      </div>
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "program") {
      deleteProgram.mutate(deleteConfirm.id, {
        onSuccess: () => { setDeleteConfirm(null); toast.success("Programa eliminado"); },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
    } else if (deleteConfirm.type === "tier") {
      deleteTier.mutate(deleteConfirm.id, {
        onSuccess: () => { setDeleteConfirm(null); toast.success("Nivel eliminado"); },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Programa
        </Button>
      </div>

      {programs.map((program: any) => {
        const exampleSpend = 50;
        const pointsEarned = exampleSpend * program.points_per_currency_unit;
        const pointValue = program.currency_per_point / 100;

        return (
          <Card key={program.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{program.name}</CardTitle>
                  <CardDescription>{program.is_active ? "Programa activo" : "Programa inactivo"}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={program.is_active ? "default" : "secondary"}>
                    {program.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={() => setEditProgram(program)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm({ type: "program", id: program.id, name: program.name })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Puntos por sol</p>
                  <p className="text-2xl font-bold text-foreground">{program.points_per_currency_unit}</p>
                  <p className="text-xs text-muted-foreground">por cada S/ 1.00 gastado</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Valor por punto</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(program.currency_per_point)}</p>
                  <p className="text-xs text-muted-foreground">al canjear recompensas</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Clientes inscritos</p>
                  <p className="text-2xl font-bold text-foreground">{(stats?.totalCustomers ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">registrados en total</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Simulacion</p>
                  <p className="text-sm text-foreground mt-1">
                    Con <span className="font-bold">S/ {exampleSpend}.00</span> gana <span className="font-bold text-primary">{pointsEarned} pts</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    100 pts = S/ {(100 * pointValue).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Tiers section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">Niveles</p>
                  <Button variant="outline" size="sm" onClick={() => setTierDialog({ open: true, programId: program.id })}>
                    <Plus className="h-3 w-3 mr-1" />
                    Agregar Nivel
                  </Button>
                </div>
                {program.tiers && program.tiers.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {program.tiers.map((tier: any) => {
                      const tc = tierConfig[tier.name] || { label: tier.name, color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300" };
                      return (
                        <div key={tier.id} className="rounded-lg border border-border bg-muted/20 p-3 group relative">
                          <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                            <button onClick={() => setTierDialog({ open: true, programId: program.id, editData: tier })} className="p-1 rounded hover:bg-muted">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </button>
                            <button onClick={() => setDeleteConfirm({ type: "tier", id: tier.id, name: tier.name })} className="p-1 rounded hover:bg-muted">
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </button>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${tc.color}`}>
                            {tc.label}
                          </span>
                          <p className="text-sm mt-2 text-foreground">{tier.min_points.toLocaleString()} pts minimo</p>
                          <p className="text-xs text-muted-foreground">Multiplicador: {(tier.multiplier / 100).toFixed(2)}x</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay niveles configurados</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <ProgramDialog open={showCreate} onOpenChange={setShowCreate} />
      {editProgram && (
        <ProgramDialog open={!!editProgram} onOpenChange={(v) => { if (!v) setEditProgram(null); }} editData={editProgram} />
      )}
      {tierDialog.open && (
        <TierDialog
          open={tierDialog.open}
          onOpenChange={(v) => { if (!v) setTierDialog({ open: false, programId: "" }); }}
          programId={tierDialog.programId}
          editData={tierDialog.editData}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}
        title="Confirmar eliminacion"
        description={`Estas seguro de eliminar ${deleteConfirm?.name}? Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        loading={deleteProgram.isPending || deleteTier.isPending}
      />
    </div>
  );
}
