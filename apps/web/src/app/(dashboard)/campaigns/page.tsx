"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Megaphone, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import {
  useCampaigns,
  useUpdateCampaign,
  useDeleteCampaign,
  type Campaign,
} from "@/hooks/use-campaigns";
import { CampaignCard } from "./_components/campaign-card";
import { CampaignDialog } from "./_components/campaign-dialog";
import { SendCampaignDialog } from "./_components/send-campaign-dialog";

export default function CampaignsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = hasPermission(role, "loyalty:create");
  const canEdit = hasPermission(role, "loyalty:update");
  const canSend = hasPermission(role, "loyalty:create");

  const { data, isLoading, isFetching, error, refetch } = useCampaigns();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [sendCampaign, setSendCampaign] = useState<Campaign | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Campaign | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const campaigns: Campaign[] = data ?? [];

  function handleToggleStatus(campaign: Campaign) {
    const next = campaign.status === "active" ? "paused" : "active";
    setTogglingId(campaign.id);
    updateCampaign.mutate(
      { id: campaign.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === "active" ? "Campaña activada" : "Campaña pausada"),
        onError: (err) =>
          toast.error(
            `No se pudo cambiar el estado de la campaña: ${(err as Error).message}`,
          ),
        onSettled: () => setTogglingId(null),
      },
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    deleteCampaign.mutate(deleteConfirm.id, {
      onSuccess: () => {
        setDeleteConfirm(null);
        toast.success("Campaña eliminada");
      },
      onError: (err) =>
        toast.error(`No se pudo eliminar la campaña: ${(err as Error).message}`),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas"
        description="Promociones de puntos por horario, día o nivel de cliente, y su anuncio por correo"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Actualizar campañas"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              <span className="ml-2 hidden sm:inline">Actualizar</span>
            </Button>
            {canCreate && (
              <Button className="h-10" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva campaña
              </Button>
            )}
          </div>
        }
      />

      {/*
        Cajeros y mozos tienen loyalty:read, así que llegan a esta pantalla y ven
        los botones "Anunciar" en gris. Un botón deshabilitado no muestra su
        tooltip: el motivo se dice una vez aquí, no repetido en cada tarjeta.
      */}
      {!canSend && !isLoading && !error && campaigns.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Tu rol puede consultar las campañas, pero no crearlas ni anunciarlas por
          correo.
        </p>
      )}

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar las campañas: {(error as Error).message}
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
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-40 w-full animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Megaphone className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="mb-1 font-medium text-foreground">
              Todavía no hay campañas creadas
            </p>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              Una campaña multiplica los puntos o regala puntos extra en los días y
              horarios que elijas. Después puedes anunciarla por correo a los clientes
              que quieras traer de vuelta.
            </p>
            {canCreate && (
              <Button className="h-10" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear campaña
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              canEdit={canEdit}
              canSend={canSend}
              toggling={togglingId === campaign.id}
              onToggleStatus={() => handleToggleStatus(campaign)}
              onAnnounce={() => setSendCampaign(campaign)}
              onEdit={() => setEditCampaign(campaign)}
              onDelete={() => setDeleteConfirm(campaign)}
            />
          ))}
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

      {sendCampaign && (
        <SendCampaignDialog
          key={sendCampaign.id}
          open={!!sendCampaign}
          onOpenChange={(v) => {
            if (!v) setSendCampaign(null);
          }}
          campaign={sendCampaign}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => {
          if (!v) setDeleteConfirm(null);
        }}
        title="¿Eliminar esta campaña?"
        description={`Se eliminará «${deleteConfirm?.name ?? ""}» y dejará de aplicar su beneficio de puntos. Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
        loading={deleteCampaign.isPending}
      />
    </div>
  );
}
