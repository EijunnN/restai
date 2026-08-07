"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { RefreshCw, Hash } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useSunatSeries, useSaveSunatSeries, type SunatSeries } from "@/hooks/use-settings";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

/** Serie válida: la letra del tipo de comprobante + 3 alfanuméricos en mayúscula. */
const SERIE_B = /^B[A-Z0-9]{3}$/;
const SERIE_F = /^F[A-Z0-9]{3}$/;

const CAMPOS: {
  key: keyof SunatSeries;
  label: string;
  ayuda: string;
  regla: RegExp;
  error: string;
  placeholder: string;
}[] = [
  {
    key: "boleta",
    label: "Boletas de venta",
    ayuda: "Comprobante del consumidor final (con o sin DNI).",
    regla: SERIE_B,
    error: "La serie de boletas empieza por B y tiene 4 caracteres (ej. B001).",
    placeholder: "B001",
  },
  {
    key: "factura",
    label: "Facturas",
    ayuda: "Comprobante para empresas con RUC.",
    regla: SERIE_F,
    error: "La serie de facturas empieza por F y tiene 4 caracteres (ej. F001).",
    placeholder: "F001",
  },
  {
    key: "nota_credito_boleta",
    label: "Notas de crédito de boleta",
    ayuda: "Se usa al anular o corregir una boleta ya aceptada.",
    regla: SERIE_B,
    error: "Empieza por B y tiene 4 caracteres (ej. BC01).",
    placeholder: "BC01",
  },
  {
    key: "nota_credito_factura",
    label: "Notas de crédito de factura",
    ayuda: "Se usa al anular o corregir una factura ya aceptada.",
    regla: SERIE_F,
    error: "Empieza por F y tiene 4 caracteres (ej. FC01).",
    placeholder: "FC01",
  },
];

const VACIO: SunatSeries = {
  boleta: "",
  factura: "",
  nota_credito_boleta: "",
  nota_credito_factura: "",
};

/**
 * Series de numeración de la SEDE activa.
 *
 * Van por sede porque cada establecimiento numera de forma independiente: dos
 * locales emitiendo con la misma serie acabarían con correlativos duplicados y
 * un rechazo de SUNAT. Cambiar una serie no renumera lo ya emitido.
 */
export function SunatSeriesCard({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useSunatSeries();
  const guardar = useSaveSunatSeries();

  const [form, setForm] = useState<SunatSeries>(VACIO);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const errores = CAMPOS.filter((campo) => !campo.regla.test(form[campo.key] ?? ""));
  const cambios = data
    ? CAMPOS.filter((campo) => form[campo.key] !== data[campo.key])
    : [];
  const hayCambios = cambios.length > 0;

  const persistir = async () => {
    try {
      await guardar.mutateAsync(form);
      setConfirmOpen(false);
      toast.success("Series de numeración guardadas");
    } catch (err: any) {
      setConfirmOpen(false);
      toast.error(err?.message || "No se pudieron guardar las series");
    }
  };

  // Cambiar una serie parte la numeración fiscal de la sede en dos: lo emitido
  // se queda en la serie vieja y el correlativo de la nueva arranca donde esté.
  // Es irreversible de hecho, así que se confirma enseñando el cambio exacto.
  const handleGuardar = () => {
    if (errores.length > 0) {
      toast.error("Revisa las series marcadas en rojo antes de guardar");
      return;
    }
    if (!hayCambios) return;
    setConfirmOpen(true);
  };

  const resumenCambios = cambios
    .map((campo) => `${campo.label}: ${data?.[campo.key]} → ${form[campo.key]}`)
    .join(". ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-4 w-4" />
          Series de numeración
        </CardTitle>
        <CardDescription>
          Prefijo de los comprobantes de esta sede. Cambiarlo NO renumera lo ya emitido: el
          correlativo continúa desde el último número usado en cada serie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
          >
            <p className="text-sm text-destructive">
              No se pudieron cargar las series: {(error as Error).message}
            </p>
            <Button variant="outline" size="sm" className="h-10" onClick={() => void refetch()}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Reintentar
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {CAMPOS.map((campo) => {
                const valor = form[campo.key] ?? "";
                const invalido = !campo.regla.test(valor);
                return (
                  <div key={campo.key} className="space-y-2">
                    <Label htmlFor={`serie-${campo.key}`}>{campo.label}</Label>
                    <Input
                      id={`serie-${campo.key}`}
                      className="h-10 font-mono uppercase"
                      maxLength={4}
                      disabled={!canWrite}
                      placeholder={campo.placeholder}
                      value={valor}
                      aria-invalid={invalido}
                      aria-describedby={`serie-${campo.key}-help`}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          [campo.key]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
                        })
                      }
                    />
                    {invalido ? (
                      <p id={`serie-${campo.key}-help`} role="alert" className="text-xs text-destructive">
                        {campo.error}
                      </p>
                    ) : (
                      <p id={`serie-${campo.key}-help`} className="text-xs text-muted-foreground">
                        {campo.ayuda}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {canWrite ? (
              <Button
                className="h-10"
                onClick={handleGuardar}
                disabled={guardar.isPending || errores.length > 0 || !hayCambios}
              >
                {guardar.isPending ? "Guardando..." : "Guardar series"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Solo el administrador de la organización puede cambiar las series.
              </p>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Vas a cambiar la numeración de esta sede"
        description={`${resumenCambios}. Los comprobantes ya emitidos conservan su serie y su número: no se renumera nada. A partir de ahora los nuevos se emitirán con la serie indicada, continuando desde su último correlativo. ¿Continuar?`}
        confirmLabel="Sí, cambiar las series"
        variant="destructive"
        loading={guardar.isPending}
        onConfirm={() => void persistir()}
      />
    </Card>
  );
}
