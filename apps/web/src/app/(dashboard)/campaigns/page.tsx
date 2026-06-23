"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { DatePicker } from "@restai/ui/components/date-picker";
import {
  Plus,
  RefreshCw,
  Megaphone,
  Pencil,
  Trash2,
  Play,
  Pause,
  Calendar,
  Clock,
  Sparkles,
  Gift,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
} from "@/hooks/use-campaigns";
import { useLoyaltyPrograms } from "@/hooks/use-loyalty";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const statusLabels: Record<string, { label: string; color: string }> = {
  draft: {
    label: "Borrador",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300",
  },
  active: {
    label: "Activa",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  paused: {
    label: "Pausada",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  ended: {
    label: "Finalizada",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

// 0 = Sunday ... 6 = Saturday (matches JS Date.getDay()).
const daysOfWeek: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mie" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

// Convert an ISO/date string from the API into a YYYY-MM-DD string for DatePicker.
function toDateInputValue(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-PE");
}

function describeDays(days: any): string {
  const arr: number[] = Array.isArray(days) ? days : [];
  if (arr.length === 0 || arr.length === 7) return "Todos los dias";
  return daysOfWeek
    .filter((d) => arr.includes(d.value))
    .map((d) => d.label)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type FormState = {
  name: string;
  description: string;
  status: string;
  startsAt: string;
  endsAt: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  multiplier: number;
  bonusPoints: number;
  tierId: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    status: "draft",
    startsAt: "",
    endsAt: "",
    daysOfWeek: [],
    startTime: "",
    endTime: "",
    multiplier: 100,
    bonusPoints: 0,
    tierId: "",
  };
}

// Map an existing campaign (snake_case from API) into the editable form state.
function campaignToForm(c: any): FormState {
  return {
    name: c.name ?? "",
    description: c.description ?? "",
    status: c.status ?? "draft",
    startsAt: toDateInputValue(c.starts_at),
    endsAt: toDateInputValue(c.ends_at),
    daysOfWeek: Array.isArray(c.days_of_week) ? c.days_of_week : [],
    startTime: c.start_time ?? "",
    endTime: c.end_time ?? "",
    multiplier: c.multiplier ?? 100,
    bonusPoints: c.bonus_points ?? 0,
    tierId: c.tier_id ?? "",
  };
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

function CampaignDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}) {
  const isEdit = !!editData;
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const isPending = isEdit ? updateCampaign.isPending : createCampaign.isPending;

  const { data: programsData } = useLoyaltyPrograms();
  const programs: any[] = programsData ?? [];
  // Flatten all tiers across programs so a campaign can be scoped to a segment.
  const tiers: any[] = programs.flatMap((p: any) =>
    (p.tiers ?? []).map((t: any) => ({ ...t, programName: p.name })),
  );

  const [form, setForm] = useState<FormState>(() =>
    editData ? campaignToForm(editData) : emptyForm(),
  );

  // Re-sync form whenever the dialog is opened.
  useEffect(() => {
    if (!open) return;
    setForm(editData ? campaignToForm(editData) : emptyForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editData?.id]);

  function toggleDay(day: number) {
    setForm((p) => ({
      ...p,
      daysOfWeek: p.daysOfWeek.includes(day)
        ? p.daysOfWeek.filter((d) => d !== day)
        : [...p.daysOfWeek, day],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload: any = {
      name: form.name,
      description: form.description || null,
      status: form.status,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      daysOfWeek: form.daysOfWeek,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      multiplier: form.multiplier,
      bonusPoints: form.bonusPoints,
      tierId: form.tierId || null,
    };

    if (isEdit) {
      updateCampaign.mutate(
        { id: editData.id, ...payload },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success("Campana actualizada exitosamente");
          },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
      return;
    }

    createCampaign.mutate(payload, {
      onSuccess: () => {
        setForm(emptyForm());
        onOpenChange(false);
        toast.success("Campana creada exitosamente");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Campana" : "Crear Campana"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cmp-name">Nombre *</Label>
            <Input
              id="cmp-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
              placeholder="Ej: Happy Hour doble puntos"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cmp-desc">Descripcion</Label>
            <Input
              id="cmp-desc"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Descripcion opcional"
            />
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="active">Activa</SelectItem>
                <SelectItem value="paused">Pausada</SelectItem>
                <SelectItem value="ended">Finalizada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha inicio</Label>
              <DatePicker
                value={form.startsAt}
                onChange={(v) => setForm((p) => ({ ...p, startsAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha fin</Label>
              <DatePicker
                value={form.endsAt}
                onChange={(v) => setForm((p) => ({ ...p, endsAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
          </div>

          {/* Days of week */}
          <div className="space-y-2">
            <Label>Dias de la semana</Label>
            <div className="flex flex-wrap gap-2">
              {daysOfWeek.map((day) => {
                const selected = form.daysOfWeek.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Sin seleccion = aplica todos los dias.
            </p>
          </div>

          {/* Time window */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cmp-start-time">Hora inicio (HH:MM)</Label>
              <Input
                id="cmp-start-time"
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cmp-end-time">Hora fin (HH:MM)</Label>
              <Input
                id="cmp-end-time"
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Hora de Lima (UTC-5). Dejar vacio para aplicar todo el dia.
          </p>

          {/* Boost */}
          <div className="border-t border-border pt-4 space-y-4">
            <p className="text-sm font-medium text-foreground">Beneficio de puntos</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cmp-mult">Multiplicador (x100)</Label>
                <Input
                  id="cmp-mult"
                  type="number"
                  min={100}
                  step={10}
                  value={form.multiplier}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, multiplier: parseInt(e.target.value) || 0 }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  100 = 1x (sin extra), 200 = 2x los puntos.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cmp-bonus">Puntos extra</Label>
                <Input
                  id="cmp-bonus"
                  type="number"
                  min={0}
                  value={form.bonusPoints}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bonusPoints: parseInt(e.target.value) || 0 }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Puntos fijos sumados por pedido.
                </p>
              </div>
            </div>
          </div>

          {/* Tier segment */}
          <div className="space-y-2">
            <Label>Nivel (opcional)</Label>
            <Select
              value={form.tierId || "all"}
              onValueChange={(v) => setForm((p) => ({ ...p, tierId: v === "all" ? "" : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos los clientes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {tiers.map((tier: any) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name}
                    {tier.programName ? ` (${tier.programName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Limita el beneficio a clientes de un nivel especifico.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !form.name}>
              {isEdit
                ? isPending
                  ? "Guardando..."
                  : "Guardar Cambios"
                : isPending
                  ? "Creando..."
                  : "Crear Campana"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CampaignsPage() {
  const { data, isLoading, error, refetch } = useCampaigns();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const campaigns: any[] = data ?? [];

  function handleToggleStatus(campaign: any) {
    const next = campaign.status === "active" ? "paused" : "active";
    updateCampaign.mutate(
      { id: campaign.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === "active" ? "Campana activada" : "Campana pausada"),
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    deleteCampaign.mutate(deleteConfirm.id, {
      onSuccess: () => {
        setDeleteConfirm(null);
        toast.success("Campana eliminada");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campanas"
        description="Crea promociones de puntos por horario, dia o nivel de cliente"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Campana
          </Button>
        }
      />

      {error ? (
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar campanas: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-28 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Megaphone className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-1">No hay campanas creadas</p>
            <p className="text-xs text-muted-foreground mb-4">
              Crea campanas para multiplicar puntos o dar bonos en horarios especificos
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Crear Campana
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign: any) => {
            const statusInfo = statusLabels[campaign.status] || statusLabels.draft;
            const isActive = campaign.status === "active";
            return (
              <Card key={campaign.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{campaign.name}</p>
                      {campaign.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {campaign.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleStatus(campaign)}
                        disabled={updateCampaign.isPending}
                        className="p-1.5 rounded hover:bg-muted disabled:opacity-50"
                        title={isActive ? "Pausar" : "Activar"}
                      >
                        {isActive ? (
                          <Pause className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                        ) : (
                          <Play className="h-4 w-4 text-green-600 dark:text-green-400" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditCampaign(campaign)}
                        className="p-1.5 rounded hover:bg-muted"
                        title="Editar campana"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() =>
                          setDeleteConfirm({ id: campaign.id, name: campaign.name })
                        }
                        className="p-1.5 rounded hover:bg-muted"
                        title="Eliminar campana"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.color}`}
                    >
                      {statusInfo.label}
                    </span>
                    {campaign.multiplier && campaign.multiplier !== 100 && (
                      <Badge variant="outline" className="text-xs font-bold">
                        <Sparkles className="h-3 w-3 mr-1" />
                        {(campaign.multiplier / 100).toFixed(campaign.multiplier % 100 === 0 ? 0 : 2)}x puntos
                      </Badge>
                    )}
                    {campaign.bonus_points > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Gift className="h-3 w-3 mr-1" />+{campaign.bonus_points} pts
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>
                        {campaign.starts_at || campaign.ends_at ? (
                          <>
                            {formatDateLabel(campaign.starts_at) || "Sin inicio"} -{" "}
                            {formatDateLabel(campaign.ends_at) || "Sin fin"}
                          </>
                        ) : (
                          "Sin rango de fechas"
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>{describeDays(campaign.days_of_week)}</span>
                    </div>
                    {(campaign.start_time || campaign.end_time) && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>
                          {campaign.start_time || "00:00"} - {campaign.end_time || "23:59"}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignDialog open={showCreate} onOpenChange={setShowCreate} />

      {editCampaign && (
        <CampaignDialog
          key={editCampaign.id}
          open={!!editCampaign}
          onOpenChange={(v) => {
            if (!v) setEditCampaign(null);
          }}
          editData={editCampaign}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => {
          if (!v) setDeleteConfirm(null);
        }}
        title="Eliminar campana"
        description={`Estas seguro de eliminar la campana ${deleteConfirm?.name}? Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        loading={deleteCampaign.isPending}
      />
    </div>
  );
}
