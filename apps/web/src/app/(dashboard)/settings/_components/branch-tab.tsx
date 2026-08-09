"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { Clock, ExternalLink, Info, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranchSettings, useUpdateBranch } from "@/hooks/use-settings";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

/**
 * Interruptor accesible con área táctil de 44 px.
 *
 * El control visual sigue siendo una píldora de 24 px de alto, pero el objetivo
 * pulsable ocupa toda la fila: en una tablet, acertar un botón de 24 px al lado
 * de su etiqueta es una lotería.
 */
function SettingSwitch({
  id,
  checked,
  onChange,
  title,
  description,
  disabled,
  oculto,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: ReactNode;
  disabled?: boolean;
  /** No se pinta. Se DESMONTA: un interruptor invisible pero enfocable con el
   *  tabulador es peor que no tenerlo. */
  oculto?: boolean;
}) {
  if (oculto) return null;

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors",
        "min-h-[64px] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

export function BranchTab({ canWrite }: { canWrite: boolean }) {
  const {
    data: branchData,
    isLoading: branchLoading,
    error: branchError,
    refetch: refetchBranch,
    isFetching: branchFetching,
  } = useBranchSettings();
  const updateBranch = useUpdateBranch();

  const [branchForm, setBranchForm] = useState({
    name: "",
    address: "",
    phone: "",
    taxRate: "18.00",
    currency: "PEN",
    inventoryEnabled: false,
    waiterTableAssignmentEnabled: false,
    autoApproveSessions: false,
    // Se hidrata desde el servidor en el efecto de abajo. Si se olvidara, el
    // formulario mandaría "dynamic" al guardar CUALQUIER otro campo y apagaría
    // el modo estático sin que nadie lo tocara: este formulario se envía entero.
    menuMode: "dynamic" as "dynamic" | "static",
  });

  useEffect(() => {
    if (branchData) {
      setBranchForm({
        name: branchData.name || "",
        address: branchData.address || "",
        phone: branchData.phone || "",
        taxRate: ((branchData.tax_rate ?? 1800) / 100).toFixed(2),
        currency: branchData.currency || "PEN",
        inventoryEnabled: branchData.settings?.inventory_enabled ?? false,
        waiterTableAssignmentEnabled: branchData.settings?.waiter_table_assignment_enabled ?? false,
        autoApproveSessions: branchData.settings?.auto_approve_sessions ?? false,
        menuMode: branchData.menu_mode === "static" ? "static" : "dynamic",
      });
    }
  }, [branchData]);

  const taxRateNum = Math.round(parseFloat(branchForm.taxRate.replace(",", ".")) * 100);
  const taxRateInvalido = !Number.isFinite(taxRateNum) || taxRateNum < 0 || taxRateNum > 10000;

  const handleBranchSave = async () => {
    if (!branchForm.name.trim()) {
      toast.error("El nombre de la sede no puede estar vacío");
      return;
    }
    if (taxRateInvalido) {
      toast.error("El IGV debe ser un porcentaje entre 0 y 100");
      return;
    }
    try {
      await updateBranch.mutateAsync({
        name: branchForm.name.trim(),
        address: branchForm.address.trim(),
        phone: branchForm.phone.trim(),
        taxRate: taxRateNum,
        currency: branchForm.currency,
        inventoryEnabled: branchForm.inventoryEnabled,
        waiterTableAssignmentEnabled: branchForm.waiterTableAssignmentEnabled,
        menuMode: branchForm.menuMode,
        // Los ajustes se FUSIONAN en el servidor: enviar solo esta clave no pisa
        // el resto (series de SUNAT, otros interruptores).
        settings: { auto_approve_sessions: branchForm.autoApproveSessions },
      });
      toast.success("Configuración de la sede guardada");
    } catch (err: any) {
      toast.error(err.message || "No se pudo guardar la configuración de la sede");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sede actual</CardTitle>
        <CardDescription>
          Datos y comportamiento del local que tienes seleccionado arriba.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {branchError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
          >
            <p className="text-sm text-destructive">
              No se pudo cargar la sede: {(branchError as Error).message}
            </p>
            <Button variant="outline" size="sm" className="h-10" onClick={() => void refetchBranch()}>
              <RefreshCw className={cn("h-4 w-4 mr-2", branchFetching && "animate-spin")} />
              Reintentar
            </Button>
          </div>
        ) : branchLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            {!canWrite && (
              <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                No tienes permiso para modificar la configuración de esta sede.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branchName">Nombre de la sede</Label>
                <Input
                  id="branchName"
                  className="h-10"
                  disabled={!canWrite}
                  value={branchForm.name}
                  onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchPhone">Teléfono</Label>
                <Input
                  id="branchPhone"
                  className="h-10"
                  disabled={!canWrite}
                  inputMode="tel"
                  placeholder="+51 999 999 999"
                  value={branchForm.phone}
                  onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branchAddress">Dirección</Label>
              <Input
                id="branchAddress"
                className="h-10"
                disabled={!canWrite}
                value={branchForm.address}
                onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branchCurrency">Moneda</Label>
                <Select
                  value={branchForm.currency}
                  disabled={!canWrite}
                  onValueChange={(v) => setBranchForm({ ...branchForm, currency: v })}
                >
                  <SelectTrigger id="branchCurrency" className="h-10">
                    <SelectValue placeholder="Selecciona la moneda" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PEN">PEN — Soles</SelectItem>
                    <SelectItem value="USD">USD — Dólares</SelectItem>
                    <SelectItem value="EUR">EUR — Euros</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Símbolo y formato de todos los importes del sistema.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="branchTaxRate">IGV (%)</Label>
                <Input
                  id="branchTaxRate"
                  className="h-10"
                  disabled={!canWrite}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  inputMode="decimal"
                  value={branchForm.taxRate}
                  aria-invalid={taxRateInvalido}
                  aria-describedby="branchTaxRateHelp"
                  onChange={(e) => setBranchForm({ ...branchForm, taxRate: e.target.value })}
                />
                {taxRateInvalido ? (
                  <p id="branchTaxRateHelp" role="alert" className="text-xs text-destructive">
                    Escribe un porcentaje entre 0 y 100 (ej. 18.00).
                  </p>
                ) : (
                  <p id="branchTaxRateHelp" className="text-xs text-muted-foreground">
                    En Perú es 18.00. Afecta a los importes de todos los comprobantes nuevos.
                  </p>
                )}
              </div>
            </div>

            {/*
              Zona horaria: el sistema calcula el DÍA OPERATIVO en hora de Lima
              (UTC-5, sin horario de verano) en todo el backend — arqueo de caja,
              reportes, resumen diario de SUNAT. Ofrecer siete zonas horarias y
              responder "Guardado correctamente" era mentir: el valor se guardaba
              y no cambiaba absolutamente nada. Se muestra el dato real y se dice
              qué falta.
            */}
            <div className="rounded-lg border border-dashed p-4">
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">Zona horaria: hora de Perú (UTC-5)</p>
                  <p className="text-xs text-muted-foreground">
                    Los cierres de caja, los reportes y el resumen diario de SUNAT usan el
                    día civil peruano. Todavía no es configurable por sede: si operas fuera
                    de Perú, escríbenos antes de abrir el local.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/*
                El modo de carta va PRIMERO porque manda sobre los de abajo: en
                solo lectura no hay sesiones que aprobar ni mesas que asignar.
              */}
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium">¿Para qué sirve tu QR?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lo decides tú y puedes cambiarlo cuando quieras. No hay que
                  reimprimir nada: los mismos códigos QR valen para los dos.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <ModoCarta
                    activo={branchForm.menuMode === "dynamic"}
                    disabled={!canWrite}
                    onSelect={() => setBranchForm({ ...branchForm, menuMode: "dynamic" })}
                    titulo="Pedir desde la mesa"
                    descripcion="El comensal escanea, entra a la mesa y hace su pedido desde el móvil. Necesita que alguien apruebe su entrada, salvo que actives la entrada directa."
                  />
                  <ModoCarta
                    activo={branchForm.menuMode === "static"}
                    disabled={!canWrite}
                    onSelect={() => setBranchForm({ ...branchForm, menuMode: "static" })}
                    titulo="Solo enseñar la carta"
                    descripcion="El comensal escanea y ve la carta al instante. No abre cuenta, no pide desde el móvil y no molesta a nadie para poder mirar. Sustituye a la carta de papel."
                  />
                </div>

                {branchForm.menuMode === "static" && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Mientras esté así, nadie puede pedir desde el móvil: los pedidos
                      se toman como siempre, hablando con un mozo. Lo que ya estaba
                      abierto se puede seguir cobrando con normalidad.
                    </p>
                  </div>
                )}

                {branchData?.public_code && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-3">
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                      Tu carta también tiene una dirección propia, sin mesa, para
                      imprimir en la puerta o en el mostrador.
                    </p>
                    <a
                      href={`/${branchData.slug}/carta/${branchData.public_code}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver mi carta
                    </a>
                  </div>
                )}
              </div>

              <SettingSwitch
                id="autoApproveSessions"
                checked={branchForm.autoApproveSessions}
                onChange={(v) => setBranchForm({ ...branchForm, autoApproveSessions: v })}
                // En solo lectura no hay entradas que aprobar: dejarlo visible
                // haría creer que se puede pedir.
                oculto={branchForm.menuMode === "static"}
                disabled={!canWrite}
                title="Entrada directa del comensal (auto-aprobación)"
                description="Activado: quien escanea el QR pasa a la carta al instante. Desactivado: su solicitud queda en espera hasta que un mozo la aprueba, y caduca a los 10 minutos."
              />
              <div
                className={
                  branchForm.menuMode === "static"
                    ? "hidden"
                    : "flex items-start gap-2 rounded-md bg-muted/40 p-3"
                }
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {branchForm.autoApproveSessions
                    ? "Con la entrada directa el comensal nunca espera, pero cualquiera con el QR (o el código corto) puede abrir cuenta en la mesa. Recomendado en locales con rotación alta."
                    : "Con la aprobación manual controlas quién se sienta en cada mesa, a costa de que el comensal espere hasta 10 minutos si el mozo está ocupado. Es la causa número uno de abandono en la carta digital."}
                </p>
              </div>

              <SettingSwitch
                id="inventoryEnabled"
                checked={branchForm.inventoryEnabled}
                onChange={(v) => setBranchForm({ ...branchForm, inventoryEnabled: v })}
                disabled={!canWrite}
                title="Control de inventario"
                description="Descuenta ingredientes por receta al cerrar cada pedido y habilita el módulo de stock."
              />

              <SettingSwitch
                id="waiterTableAssignmentEnabled"
                checked={branchForm.waiterTableAssignmentEnabled}
                onChange={(v) =>
                  setBranchForm({ ...branchForm, waiterTableAssignmentEnabled: v })
                }
                disabled={!canWrite}
                title="Asignación de mozos a mesas"
                description="Cada mozo ve y recibe los avisos únicamente de las mesas que tiene asignadas."
              />
            </div>

            {canWrite && (
              <Button
                className="h-10"
                onClick={handleBranchSave}
                disabled={updateBranch.isPending || taxRateInvalido}
              >
                {updateBranch.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Una de las dos formas de usar el QR.
 *
 * Son tarjetas y no un interruptor porque no es "encendido/apagado": son dos
 * maneras distintas de trabajar, y cada una necesita su frase para que el dueño
 * elija sabiendo. Un interruptor llamado "carta estática" no dice nada a quien
 * nunca ha oído la expresión.
 */
function ModoCarta({
  activo,
  disabled,
  onSelect,
  titulo,
  descripcion,
}: {
  activo: boolean;
  disabled?: boolean;
  onSelect: () => void;
  titulo: string;
  descripcion: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
        activo
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            activo ? "border-primary" : "border-muted-foreground/40"
          }`}
        >
          {activo && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span className="text-sm font-medium">{titulo}</span>
      </span>
      <span className="mt-1.5 block text-xs leading-snug text-muted-foreground">
        {descripcion}
      </span>
    </button>
  );
}
