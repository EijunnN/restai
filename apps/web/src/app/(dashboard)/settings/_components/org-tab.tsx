"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Upload, AlertTriangle, RefreshCw } from "lucide-react";
import { useOrgSettings, useUpdateOrg } from "@/hooks/use-settings";
import { useUploadImage } from "@/hooks/use-uploads";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

/**
 * Formato de RUC que acepta PATCH /api/settings/org: 11 dígitos que empiezan por
 * 10 (persona natural), 15, 17 o 20 (persona jurídica). La base de datos aplica
 * el mismo CHECK, así que validarlo aquí evita un viaje y un error opaco.
 */
const RUC_RE = /^(10|15|17|20)\d{9}$/;

export function OrgTab({ canWrite }: { canWrite: boolean }) {
  const {
    data: orgData,
    isLoading: orgLoading,
    error: orgError,
    refetch: refetchOrg,
    isFetching: orgFetching,
  } = useOrgSettings();
  const updateOrg = useUpdateOrg();
  const uploadImage = useUploadImage();
  const logoFileRef = useRef<HTMLInputElement>(null);

  const [orgForm, setOrgForm] = useState({
    name: "",
    logoUrl: "",
    ruc: "",
    legalName: "",
  });

  useEffect(() => {
    if (orgData) {
      setOrgForm({
        name: orgData.name || "",
        logoUrl: orgData.logo_url || "",
        ruc: orgData.ruc || "",
        legalName: orgData.legal_name || "",
      });
    }
  }, [orgData]);

  const rucLimpio = orgForm.ruc.trim();
  const rucInvalido = rucLimpio.length > 0 && !RUC_RE.test(rucLimpio);

  const handleOrgSave = async () => {
    if (rucInvalido) {
      toast.error("El RUC debe tener 11 dígitos y empezar por 10, 15, 17 o 20");
      return;
    }
    if (!orgForm.name.trim()) {
      toast.error("El nombre de la organización no puede estar vacío");
      return;
    }
    try {
      await updateOrg.mutateAsync({
        name: orgForm.name.trim(),
        logoUrl: orgForm.logoUrl || null,
        ruc: rucLimpio || null,
        legalName: orgForm.legalName.trim() || null,
      });
      toast.success("Datos de la organización guardados");
    } catch (err: any) {
      toast.error(err.message || "No se pudieron guardar los datos de la organización");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organización</CardTitle>
        <CardDescription>
          Nombre, logo y datos fiscales del negocio. El RUC y la razón social se
          imprimen en los tickets y son obligatorios para emitir comprobantes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {orgError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
          >
            <p className="text-sm text-destructive">
              No se pudieron cargar los datos: {(orgError as Error).message}
            </p>
            <Button variant="outline" size="sm" className="h-10" onClick={() => void refetchOrg()}>
              <RefreshCw className={`h-4 w-4 mr-2 ${orgFetching ? "animate-spin" : ""}`} />
              Reintentar
            </Button>
          </div>
        ) : orgLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {!canWrite && (
              <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Solo el administrador de la organización puede modificar estos datos.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="orgName">Nombre comercial</Label>
              <Input
                id="orgName"
                className="h-10"
                disabled={!canWrite}
                value={orgForm.name}
                onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                El nombre con el que te conoce el cliente. Aparece en la carta y en el panel.
              </p>
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <p className="text-sm font-medium">Datos del emisor</p>
                <p className="text-xs text-muted-foreground">
                  Identifican al negocio ante SUNAT y ante el cliente.
                </p>
              </div>

              {!orgData?.ruc && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  <p className="text-xs">
                    Todavía no has registrado el RUC. Los tickets se imprimen sin el dato
                    que identifica al negocio y no podrás emitir comprobantes electrónicos.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgRuc">RUC</Label>
                  <Input
                    id="orgRuc"
                    className="h-10 font-mono"
                    disabled={!canWrite}
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="20123456789"
                    value={orgForm.ruc}
                    aria-invalid={rucInvalido}
                    aria-describedby="orgRucHelp"
                    onChange={(e) =>
                      setOrgForm({ ...orgForm, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })
                    }
                  />
                  {rucInvalido ? (
                    <p id="orgRucHelp" role="alert" className="text-xs text-destructive">
                      El RUC debe tener 11 dígitos y empezar por 10, 15, 17 o 20.
                    </p>
                  ) : (
                    <p id="orgRucHelp" className="text-xs text-muted-foreground">
                      11 dígitos. Déjalo vacío solo si aún no estás formalizado.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgLegalName">Razón social</Label>
                  <Input
                    id="orgLegalName"
                    className="h-10"
                    disabled={!canWrite}
                    placeholder="INVERSIONES EL SABOR S.A.C."
                    maxLength={255}
                    value={orgForm.legalName}
                    onChange={(e) => setOrgForm({ ...orgForm, legalName: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tal como figura en tu ficha RUC. Puede diferir del nombre comercial.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex flex-wrap items-center gap-4">
                {orgForm.logoUrl && (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                    <img
                      src={orgForm.logoUrl}
                      alt="Logo de la organización"
                      className="h-full w-full object-contain p-1.5"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    onClick={() => logoFileRef.current?.click()}
                    disabled={!canWrite || uploadImage.isPending}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadImage.isPending
                      ? "Subiendo..."
                      : orgForm.logoUrl
                        ? "Cambiar logo"
                        : "Subir logo"}
                  </Button>
                  <p className="text-xs text-muted-foreground">JPEG, PNG, WebP o GIF. Máximo 5 MB.</p>
                </div>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  aria-label="Archivo del logo"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const result = await uploadImage.mutateAsync({ file, type: "logo" });
                      setOrgForm((prev) => ({ ...prev, logoUrl: result.url }));
                      toast.success("Logo subido correctamente");
                    } catch (err: any) {
                      toast.error(err.message || "No se pudo subir el logo");
                    }
                    if (logoFileRef.current) logoFileRef.current.value = "";
                  }}
                />
              </div>
            </div>

            {canWrite && (
              <Button className="h-10" onClick={handleOrgSave} disabled={updateOrg.isPending}>
                {updateOrg.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
