"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUNAT_STATUS_LABELS,
  SUNAT_STATUS_TONE,
  type SunatStatus,
} from "@/hooks/use-invoices";

const TONE_CLASSES = {
  good: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "border-border bg-muted text-muted-foreground",
} as const;

const TONE_ICONS = {
  good: CheckCircle2,
  warn: Clock,
  bad: XCircle,
  neutral: Ban,
} as const;

interface SunatStatusBadgeProps {
  status: SunatStatus;
  /** Etiqueta que redacta la API; si falta, se usa la tabla local. */
  label?: string | null;
  className?: string;
}

/**
 * Estado REAL del comprobante ante SUNAT, con color.
 *
 * "Pendiente" y "Rechazado" no son matices decorativos: son los dos estados que
 * dejan al restaurante en incumplimiento tributario, así que tienen que
 * distinguirse de un vistazo desde el otro lado del mostrador.
 */
export function SunatStatusBadge({ status, label, className }: SunatStatusBadgeProps) {
  const tone = SUNAT_STATUS_TONE[status] ?? "neutral";
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label || SUNAT_STATUS_LABELS[status] || status}
    </span>
  );
}

/** Motivo del rechazo tal cual lo devolvió SUNAT, con su código. */
export function SunatRejectionReason({
  code,
  description,
  className,
}: {
  code: string | null;
  description: string | null;
  className?: string;
}) {
  if (!description && !code) return null;
  return (
    <p className={cn("flex items-start gap-1 text-xs text-destructive", className)}>
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        {code ? `[${code}] ` : ""}
        {description ?? "SUNAT no devolvió un motivo"}
      </span>
    </p>
  );
}
