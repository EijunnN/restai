"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { AlertTriangle, Users } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { ReferralRow } from "@/hooks/use-referrals";

const statusConfig: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className?: string;
  }
> = {
  completed: {
    label: "Completado",
    variant: "default",
    className: "bg-green-600 hover:bg-green-600",
  },
  pending: { label: "Pendiente", variant: "outline" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

function statusFor(status: string) {
  return statusConfig[status] ?? { label: status, variant: "outline" as const };
}

function pointsFor(r: ReferralRow): number {
  return (r.referrer_points ?? 0) + (r.referee_points ?? 0);
}

/**
 * Texto de la columna "Puntos".
 *
 * Los puntos se SELLAN en la fila del referido cuando el invitado se registra
 * con el código, no cuando paga: cambiar la configuración no reescribe lo que ya
 * está pendiente. Por eso un pendiente tiene que enseñar lo que va a pagar —
 * antes ponía "—" y un referido sellado en 0 parecía normal hasta que se
 * completaba sin dar nada.
 */
function pointsLabel(r: ReferralRow): string {
  const total = pointsFor(r);
  if (r.status === "completed") {
    return `${total.toLocaleString("es-PE")} pts otorgados`;
  }
  return total > 0 ? `Pagará ${total.toLocaleString("es-PE")} pts` : "Pagará 0 pts";
}

function dateFor(r: ReferralRow): string {
  const date = r.completed_at || r.created_at;
  return date ? formatDate(date) : "—";
}

/**
 * Listado de referidos.
 *
 * Dos maquetaciones: tarjetas apiladas en móvil y tabla a partir de `md`. En la
 * tabla se ocultaban en móvil precisamente las columnas que dan sentido a la
 * pantalla (código, puntos y fecha), así que en pantalla pequeña quedaban dos
 * nombres sueltos sin ninguna información útil.
 */
export function ReferralsList({
  referrals,
  isLoading,
}: {
  referrals: ReferralRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (referrals.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-foreground">Aún no hay referidos</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Cada cliente registrado tiene un código para invitar. Los referidos aparecen
            aquí en cuanto alguien se registra con uno, y se completan cuando el invitado
            paga su primer pedido.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Referidos abiertos que, con los puntos que llevan sellados, no pagarán nada
  // al completarse. Es el efecto colateral de haber tenido el programa en 0:
  // configurarlo ahora NO los rescata, y el dueño tiene que saberlo.
  const zeroPending = referrals.filter(
    (r) => r.status === "pending" && pointsFor(r) === 0,
  ).length;

  return (
    <>
      {zeroPending > 0 && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {zeroPending === 1
              ? "Hay 1 referido pendiente sellado en 0 puntos: se registró cuando el programa no premiaba, así que no pagará nada al completarse."
              : `Hay ${zeroPending.toLocaleString("es-PE")} referidos pendientes sellados en 0 puntos: se registraron cuando el programa no premiaba, así que no pagarán nada al completarse.`}{" "}
            Los puntos que configures arriba solo se aplican a los referidos nuevos.
          </p>
        </div>
      )}

      {/* Móvil: una tarjeta por referido, sin esconder nada. */}
      <div className="space-y-3 md:hidden">
        {referrals.map((r) => {
          const config = statusFor(r.status);
          return (
            <Card key={r.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.referrer_name || "Cliente"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      invitó a {r.referee_name || "Cliente"}
                    </p>
                  </div>
                  <Badge variant={config.variant} className={config.className}>
                    {config.label}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{r.code}</span>
                  <span
                    className={`tabular-nums ${
                      r.status === "pending" && pointsFor(r) === 0
                        ? "text-amber-700 dark:text-amber-400"
                        : ""
                    }`}
                  >
                    {pointsLabel(r)}
                  </span>
                  <span>{dateFor(r)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Escritorio / tablet: tabla completa. */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                    Quien invita
                  </th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                    Invitado
                  </th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                    Código
                  </th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                  <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                    Puntos
                  </th>
                  <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => {
                  const config = statusFor(r.status);
                  return (
                    <tr
                      key={r.id}
                      className="border-b transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="p-3 text-sm font-medium">
                        {r.referrer_name || "Cliente"}
                      </td>
                      <td className="p-3 text-sm">{r.referee_name || "Cliente"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {r.code}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={config.variant} className={config.className}>
                          {config.label}
                        </Badge>
                      </td>
                      <td
                        className={`p-3 text-right text-sm tabular-nums ${
                          r.status === "pending" && pointsFor(r) === 0
                            ? "text-amber-700 dark:text-amber-400"
                            : ""
                        }`}
                      >
                        {pointsLabel(r)}
                      </td>
                      <td className="p-3 text-right text-sm text-muted-foreground">
                        {dateFor(r)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
