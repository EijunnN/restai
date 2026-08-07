"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import {
  Calendar,
  CalendarDays,
  Clock,
  Gift,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Campaign } from "@/hooks/use-campaigns";
import { describeDays, formatDateLabel, statusInfoFor } from "./campaign-utils";

export function CampaignCard({
  campaign,
  canEdit,
  canSend,
  toggling,
  onToggleStatus,
  onAnnounce,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  canEdit: boolean;
  canSend: boolean;
  toggling: boolean;
  onToggleStatus: () => void;
  onAnnounce: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusInfo = statusInfoFor(campaign.status);
  const isActive = campaign.status === "active";
  const isEnded = campaign.status === "ended";
  const startLabel = formatDateLabel(campaign.starts_at);
  const endLabel = formatDateLabel(campaign.ends_at);

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{campaign.name}</p>
            {campaign.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {campaign.description}
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusInfo.color}`}
          >
            {statusInfo.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {campaign.multiplier !== 100 && (
            <Badge variant="outline" className="text-xs font-bold">
              <Sparkles className="mr-1 h-3 w-3" />
              {(campaign.multiplier / 100).toFixed(
                campaign.multiplier % 100 === 0 ? 0 : 2,
              )}
              x puntos
            </Badge>
          )}
          {campaign.bonus_points > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Gift className="mr-1 h-3 w-3" />+{campaign.bonus_points} pts
            </Badge>
          )}
          {campaign.multiplier === 100 && campaign.bonus_points === 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Sin beneficio de puntos
            </Badge>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>
              {startLabel || endLabel
                ? `${startLabel || "Sin inicio"} — ${endLabel || "Sin fin"}`
                : "Sin rango de fechas"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3 w-3 shrink-0" />
            <span>{describeDays(campaign.days_of_week)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 shrink-0" />
            <span>
              {campaign.start_time || campaign.end_time
                ? `${campaign.start_time || "00:00"} — ${campaign.end_time || "23:59"}`
                : "Todo el día"}
            </span>
          </div>
        </div>

        {/*
          Un botón deshabilitado no dispara su `title` (el Button lleva
          `disabled:pointer-events-none`), así que el motivo tiene que estar
          escrito en la tarjeta o el dueño solo ve un botón gris sin explicación.
        */}
        {isEnded && (
          <p className="text-xs text-muted-foreground">
            Finalizada: para anunciarla por correo, cámbiala antes a activa.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            className="h-10 flex-1 min-w-[8rem]"
            onClick={onAnnounce}
            disabled={!canSend || isEnded}
            title={
              isEnded
                ? "No se puede anunciar una campaña finalizada"
                : !canSend
                  ? "Tu rol no puede enviar anuncios"
                  : "Anunciar por correo"
            }
          >
            <Megaphone className="mr-2 h-4 w-4" />
            Anunciar
          </Button>

          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            onClick={onToggleStatus}
            disabled={!canEdit || toggling}
            aria-label={isActive ? "Pausar campaña" : "Activar campaña"}
            title={isActive ? "Pausar campaña" : "Activar campaña"}
          >
            {isActive ? (
              <Pause className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            ) : (
              <Play className="h-4 w-4 text-green-600 dark:text-green-400" />
            )}
          </Button>

          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            onClick={onEdit}
            disabled={!canEdit}
            aria-label="Editar campaña"
            title="Editar campaña"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </Button>

          <Button
            variant="ghost"
            className="h-10 w-10 p-0"
            onClick={onDelete}
            disabled={!canEdit}
            aria-label="Eliminar campaña"
            title="Eliminar campaña"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
