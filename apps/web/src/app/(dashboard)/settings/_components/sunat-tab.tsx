"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  RefreshCw,
  Upload,
  FileCheck2,
  KeyRound,
  Building2,
  PlugZap,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useOrgSettings,
  useUpdateOrg,
  useSunatConfig,
  useSaveSunatConfig,
  useTestSunatConfig,
  type SunatConfigInput,
  type SunatTestResult,
} from "@/hooks/use-settings";
import { SunatStatusCard } from "./sunat-status-card";
import { SunatTestPanel } from "./sunat-test-panel";
import { SunatSeriesCard } from "./sunat-series-card";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

/**
 * RUC que acepta PUT /api/sunat/config: 11 dígitos que empiezan por 10, 15, 16,
 * 17 o 20.
 */
const RUC_SUNAT_RE = /^(10|15|16|17|20)\d{9}$/;
/**
 * RUC que acepta PATCH /api/settings/org (y el CHECK de la base): NO admite el
 * prefijo 16 que sí acepta la configuración SUNAT. Se comprueba antes de ofrecer
 * copiar el RUC del emisor a los datos del negocio, para no proponer al usuario
 * una acción que el servidor va a rechazar.
 */
const RUC_ORG_RE = /^(10|15|17|20)\d{9}$/;
/** Tamaño máximo razonable para un certificado (un PFX típico no llega a 20 KB). */
const CERT_MAX_BYTES = 1024 * 1024;

interface CertificadoElegido {
  nombre: string;
  contenido: string;
  formato: "pfx" | "pem";
}

/** Lee un PFX/P12 como base64 y un PEM como texto plano. */
function leerCertificado(file: File): Promise<CertificadoElegido> {
  const nombre = file.name;
  const esPem = /\.(pem|crt|cer|key)$/i.test(nombre);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo del certificado"));
    reader.onload = () => {
      const resultado = reader.result;
      if (typeof resultado !== "string") {
        reject(new Error("No se pudo leer el archivo del certificado"));
        return;
      }
      if (esPem) {
        resolve({ nombre, contenido: resultado, formato: "pem" });
        return;
      }
      // readAsDataURL devuelve "data:...;base64,XXXX": el servidor espera solo XXXX.
      const base64 = resultado.slice(resultado.indexOf(",") + 1);
      resolve({ nombre, contenido: base64, formato: "pfx" });
    };
    if (esPem) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

const FORM_VACIO = {
  ruc: "",
  razonSocial: "",
  nombreComercial: "",
  direccion: "",
  ubigeo: "",
  departamento: "",
  provincia: "",
  distrito: "",
  ambiente: "beta" as "beta" | "production",
  endpointOverride: "",
  solUser: "",
  solPass: "",
  certificatePassword: "",
  enabled: false,
};

export function SunatTab({ canWrite }: { canWrite: boolean }) {
  const { data: config, isLoading, error, refetch, isFetching } = useSunatConfig();
  const { data: org } = useOrgSettings();
  const role = useAuthStore((s) => s.user?.role);
  const puedeEditarOrg = hasPermission(role, "org:update");
  const guardar = useSaveSunatConfig();
  const actualizarOrg = useUpdateOrg();
  const probar = useTestSunatConfig();
  const certInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState(FORM_VACIO);
  const [cert, setCert] = useState<CertificadoElegido | null>(null);
  const [resultado, setResultado] = useState<SunatTestResult | null>(null);
  const [confirmProduccion, setConfirmProduccion] = useState(false);

  // Hidratación: los secretos NUNCA vuelven del servidor, así que sus campos se
  // dejan vacíos y significan "conservar el guardado".
  useEffect(() => {
    if (!config) return;
    setForm({
      ruc: config.ruc ?? "",
      razonSocial: config.razon_social ?? "",
      nombreComercial: config.nombre_comercial ?? "",
      direccion: config.direccion ?? "",
      ubigeo: config.ubigeo ?? "",
      departamento: config.departamento ?? "",
      provincia: config.provincia ?? "",
      distrito: config.distrito ?? "",
      ambiente: config.ambiente === "production" ? "production" : "beta",
      endpointOverride: config.endpoint_override ?? "",
      solUser: "",
      solPass: "",
      certificatePassword: "",
      enabled: !!config.enabled,
    });
    setCert(null);
  }, [config]);

  // Cortesía al configurar por primera vez: si la organización ya tiene RUC y
  // razón social, no hay que teclearlos otra vez.
  useEffect(() => {
    if (!config || config.configurado || !org) return;
    setForm((prev) => {
      if (prev.ruc || prev.razonSocial) return prev;
      return {
        ...prev,
        ruc: org.ruc ?? "",
        razonSocial: org.legal_name ?? org.name ?? "",
      };
    });
  }, [config, org]);

  const rucLimpio = form.ruc.trim();
  const rucInvalido = rucLimpio.length > 0 && !RUC_SUNAT_RE.test(rucLimpio);
  const ubigeoLimpio = form.ubigeo.trim();
  const ubigeoInvalido = ubigeoLimpio.length > 0 && !/^\d{6}$/.test(ubigeoLimpio);
  const endpointLimpio = form.endpointOverride.trim();
  const endpointInvalido = endpointLimpio.length > 0 && !/^https?:\/\/\S+$/i.test(endpointLimpio);

  const tendraSolUser = !!form.solUser.trim() || !!config?.tiene_credenciales_sol;
  const tendraSolPass = !!form.solPass || !!config?.tiene_credenciales_sol;
  const tendraCert = !!cert || !!config?.certificado?.presente;
  const puedeActivar = tendraSolUser && tendraSolPass && tendraCert;

  // El RUC del emisor electrónico (tabla sunat_config) y el RUC del negocio
  // (tabla organizations, el que se imprime en los tickets) son dos campos
  // distintos en dos endpoints distintos. Configurar uno y olvidar el otro es el
  // error silencioso más caro de esta pantalla, así que se avisa en ambos casos:
  // cuando no coinciden y cuando el negocio directamente no tiene RUC.
  const rucOrg = org?.ruc ?? null;
  const rucEmisor = config?.ruc ?? null;
  const orgSinRuc = !!rucEmisor && !rucOrg;
  const rucDescuadrado = !!rucOrg && !!rucEmisor && rucOrg !== rucEmisor;
  const puedeCopiarRuc = !!rucEmisor && RUC_ORG_RE.test(rucEmisor);

  /**
   * ¿El formulario tiene cambios que todavía no están en el servidor?
   *
   * Importa porque "Probar conexión" prueba lo GUARDADO: sin este aviso el
   * usuario corrige la clave SOL, pulsa probar, ve el mismo fallo y concluye que
   * la credencial nueva tampoco sirve.
   */
  const hayCambiosSinGuardar =
    !!config?.configurado &&
    (rucLimpio !== (config.ruc ?? "") ||
      form.razonSocial.trim() !== (config.razon_social ?? "") ||
      form.nombreComercial.trim() !== (config.nombre_comercial ?? "") ||
      form.direccion.trim() !== (config.direccion ?? "") ||
      ubigeoLimpio !== (config.ubigeo ?? "") ||
      form.departamento.trim() !== (config.departamento ?? "") ||
      form.provincia.trim() !== (config.provincia ?? "") ||
      form.distrito.trim() !== (config.distrito ?? "") ||
      endpointLimpio !== (config.endpoint_override ?? "") ||
      form.ambiente !== (config.ambiente === "production" ? "production" : "beta") ||
      form.enabled !== !!config.enabled ||
      !!cert ||
      !!form.solUser.trim() ||
      !!form.solPass ||
      !!form.certificatePassword);

  const copiarRucALaOrganizacion = async () => {
    if (!rucEmisor) return;
    try {
      await actualizarOrg.mutateAsync({
        ruc: rucEmisor,
        legalName: config?.razon_social || null,
      });
      toast.success("RUC y razón social copiados a los datos del negocio");
    } catch (err: any) {
      toast.error(err?.message || "No se pudieron copiar los datos a la organización");
    }
  };

  const construirPayload = (): SunatConfigInput => {
    const payload: SunatConfigInput = {
      ruc: rucLimpio,
      razonSocial: form.razonSocial.trim(),
      nombreComercial: form.nombreComercial.trim() || null,
      ubigeo: ubigeoLimpio || null,
      departamento: form.departamento.trim() || null,
      provincia: form.provincia.trim() || null,
      distrito: form.distrito.trim() || null,
      direccion: form.direccion.trim() || null,
      ambiente: form.ambiente,
      endpointOverride: endpointLimpio || null,
      enabled: form.enabled,
    };
    if (form.solUser.trim()) payload.solUser = form.solUser.trim();
    if (form.solPass) payload.solPass = form.solPass;
    if (cert) {
      payload.certificate = cert.contenido;
      payload.certificateFormat = cert.formato;
      // Certificado nuevo: la contraseña anterior es la de OTRO fichero. Se manda
      // siempre la del formulario (null si el PFX no lleva contraseña).
      payload.certificatePassword = form.certificatePassword || null;
    } else if (form.certificatePassword) {
      payload.certificatePassword = form.certificatePassword;
    }
    return payload;
  };

  const validar = (): string | null => {
    if (!rucLimpio) return "El RUC del emisor es obligatorio";
    if (rucInvalido) return "El RUC debe tener 11 dígitos y empezar por 10, 15, 16, 17 o 20";
    if (!form.razonSocial.trim()) return "La razón social es obligatoria";
    if (ubigeoInvalido) return "El ubigeo son exactamente 6 dígitos";
    if (endpointInvalido) return "El endpoint personalizado debe ser una URL válida (https://...)";
    if (form.enabled && !puedeActivar) {
      return "Para activar el envío hacen falta el usuario SOL, la clave SOL y el certificado digital";
    }
    return null;
  };

  const persistir = async () => {
    try {
      await guardar.mutateAsync(construirPayload());
      setConfirmProduccion(false);
      setResultado(null);
      toast.success("Configuración de facturación electrónica guardada");
    } catch (err: any) {
      setConfirmProduccion(false);
      toast.error(err?.message || "No se pudo guardar la configuración de SUNAT");
    }
  };

  const handleGuardar = () => {
    const problema = validar();
    if (problema) {
      toast.error(problema);
      return;
    }
    // Pasar a producción emite comprobantes con validez fiscal reales: se
    // confirma explícitamente.
    const pasaAProduccion = form.ambiente === "production" && config?.ambiente !== "production";
    if (pasaAProduccion) {
      setConfirmProduccion(true);
      return;
    }
    void persistir();
  };

  const handleProbar = async () => {
    try {
      const res = await probar.mutateAsync();
      setResultado(res);
      if (res.ok) toast.success(res.mensaje);
      else toast.error(res.mensaje);
    } catch (err: any) {
      setResultado(null);
      toast.error(err?.message || "No se pudo ejecutar la prueba de conexión");
    }
  };

  const handleCertFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > CERT_MAX_BYTES) {
      toast.error("El certificado no puede pesar más de 1 MB. ¿Seguro que es el archivo correcto?");
      return;
    }
    try {
      const elegido = await leerCertificado(file);
      setCert(elegido);
      toast.success(`Certificado ${elegido.nombre} listo para guardar`);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo leer el certificado");
    } finally {
      if (certInputRef.current) certInputRef.current.value = "";
    }
  };

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
      >
        <p className="text-sm text-destructive">
          No se pudo cargar la configuración de SUNAT: {(error as Error).message}
        </p>
        <Button variant="outline" size="sm" className="h-10" onClick={() => void refetch()}>
          <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
          Reintentar
        </Button>
      </div>
    );
  }

  if (isLoading || !config) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SunatStatusCard config={config} />

      {!canWrite && (
        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Puedes consultar la configuración, pero solo el administrador de la organización puede
          modificarla o probar la conexión.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Datos del emisor electrónico
          </CardTitle>
          <CardDescription>
            Tal como figuran en tu ficha RUC. Viajan dentro de cada comprobante: un dato
            equivocado provoca el rechazo de SUNAT.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(rucDescuadrado || orgSinRuc) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0 space-y-2">
                <p className="text-xs">
                  {rucDescuadrado
                    ? `El RUC de los datos del negocio (${rucOrg}) no coincide con el del emisor electrónico (${rucEmisor}). Los tickets impresos llevarían un RUC y los comprobantes electrónicos otro. Corrige el que esté mal antes de emitir.`
                    : `Tienes ${rucEmisor} como emisor electrónico, pero los datos del negocio siguen sin RUC: los tickets impresos saldrán sin el dato que identifica al local.`}
                </p>
                {puedeEditarOrg && puedeCopiarRuc ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10"
                    disabled={actualizarOrg.isPending}
                    onClick={() => void copiarRucALaOrganizacion()}
                  >
                    {actualizarOrg.isPending
                      ? "Guardando..."
                      : "Usar este RUC también en los datos del negocio"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {puedeEditarOrg
                      ? "Corrígelo en la pestaña Organización: allí el RUC debe empezar por 10, 15, 17 o 20."
                      : "Pide al administrador de la organización que lo corrija en la pestaña Organización."}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sunatRuc">RUC del emisor</Label>
              <Input
                id="sunatRuc"
                className="h-10 font-mono"
                inputMode="numeric"
                maxLength={11}
                disabled={!canWrite}
                placeholder="20123456789"
                value={form.ruc}
                aria-invalid={rucInvalido}
                aria-describedby="sunatRucHelp"
                onChange={(e) =>
                  setForm({ ...form, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })
                }
              />
              {rucInvalido ? (
                <p id="sunatRucHelp" role="alert" className="text-xs text-destructive">
                  11 dígitos que empiezan por 10, 15, 16, 17 o 20.
                </p>
              ) : (
                <p id="sunatRucHelp" className="text-xs text-muted-foreground">
                  Debe ser el mismo RUC con el que están emitidas tus credenciales SOL.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatRazonSocial">Razón social</Label>
              <Input
                id="sunatRazonSocial"
                className="h-10"
                maxLength={255}
                disabled={!canWrite}
                placeholder="INVERSIONES EL SABOR S.A.C."
                value={form.razonSocial}
                onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sunatNombreComercial">Nombre comercial (opcional)</Label>
              <Input
                id="sunatNombreComercial"
                className="h-10"
                maxLength={255}
                disabled={!canWrite}
                value={form.nombreComercial}
                onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatDireccion">Domicilio fiscal</Label>
              <Input
                id="sunatDireccion"
                className="h-10"
                maxLength={500}
                disabled={!canWrite}
                placeholder="Av. Principal 123, Miraflores"
                value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="sunatUbigeo">Ubigeo</Label>
              <Input
                id="sunatUbigeo"
                className="h-10 font-mono"
                inputMode="numeric"
                maxLength={6}
                disabled={!canWrite}
                placeholder="150122"
                value={form.ubigeo}
                aria-invalid={ubigeoInvalido}
                aria-describedby="sunatUbigeoHelp"
                onChange={(e) =>
                  setForm({ ...form, ubigeo: e.target.value.replace(/\D/g, "").slice(0, 6) })
                }
              />
              <p
                id="sunatUbigeoHelp"
                role={ubigeoInvalido ? "alert" : undefined}
                className={cn("text-xs", ubigeoInvalido ? "text-destructive" : "text-muted-foreground")}
              >
                {ubigeoInvalido ? "Son exactamente 6 dígitos." : "Código INEI del distrito."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatDepartamento">Departamento</Label>
              <Input
                id="sunatDepartamento"
                className="h-10"
                maxLength={100}
                disabled={!canWrite}
                placeholder="LIMA"
                value={form.departamento}
                onChange={(e) => setForm({ ...form, departamento: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatProvincia">Provincia</Label>
              <Input
                id="sunatProvincia"
                className="h-10"
                maxLength={100}
                disabled={!canWrite}
                placeholder="LIMA"
                value={form.provincia}
                onChange={(e) => setForm({ ...form, provincia: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatDistrito">Distrito</Label>
              <Input
                id="sunatDistrito"
                className="h-10"
                maxLength={100}
                disabled={!canWrite}
                placeholder="MIRAFLORES"
                value={form.distrito}
                onChange={(e) => setForm({ ...form, distrito: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Credenciales y certificado
          </CardTitle>
          <CardDescription>
            Se guardan cifrados en el servidor y NUNCA vuelven a mostrarse. Deja un campo vacío
            para conservar el valor que ya está guardado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sunatSolUser">Usuario SOL (secundario)</Label>
              <Input
                id="sunatSolUser"
                className="h-10"
                autoComplete="off"
                maxLength={100}
                disabled={!canWrite}
                placeholder={
                  config.tiene_credenciales_sol
                    ? `Configurado (${config.usuario_sol_enmascarado ?? "oculto"}) — escribe para cambiarlo`
                    : "MODDATOS"
                }
                value={form.solUser}
                onChange={(e) => setForm({ ...form, solUser: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Es el usuario secundario de Clave SOL con el perfil de facturación electrónica,
                no tu usuario principal.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatSolPass">Clave SOL</Label>
              <Input
                id="sunatSolPass"
                className="h-10"
                type="password"
                autoComplete="new-password"
                maxLength={100}
                disabled={!canWrite}
                placeholder={
                  config.tiene_credenciales_sol
                    ? "Configurada — escribe para cambiarla"
                    : "Clave del usuario secundario"
                }
                value={form.solPass}
                onChange={(e) => setForm({ ...form, solPass: e.target.value })}
              />
              {config.tiene_credenciales_sol && config.secretos_actualizados_en && (
                <p className="text-xs text-muted-foreground">
                  Última actualización de las credenciales:{" "}
                  {new Date(config.secretos_actualizados_en).toLocaleDateString("es-PE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                  .
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <Label>Certificado digital</Label>
            <p className="text-xs text-muted-foreground">
              Archivo .pfx o .p12 entregado por tu proveedor (también se admite un .pem con la
              clave privada incluida). Es lo que firma cada comprobante.
            </p>

            {cert ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {cert.nombre}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({cert.formato.toUpperCase()}) · se subirá al guardar
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10"
                  aria-label="Quitar el certificado seleccionado"
                  onClick={() => setCert(null)}
                >
                  <X className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Quitar</span>
                </Button>
              </div>
            ) : (
              <p className="text-sm">
                {config.certificado?.presente
                  ? "Hay un certificado guardado. Sube uno nuevo solo si lo has renovado."
                  : "Todavía no has subido ningún certificado."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-10"
                disabled={!canWrite}
                onClick={() => certInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                {config.certificado?.presente ? "Sustituir certificado" : "Subir certificado"}
              </Button>
              <input
                ref={certInputRef}
                type="file"
                accept=".pfx,.p12,.pem,.crt,.cer"
                className="hidden"
                aria-label="Archivo del certificado digital"
                onChange={(e) => void handleCertFile(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-2 pt-2">
              <Label htmlFor="sunatCertPass">Clave del certificado</Label>
              <Input
                id="sunatCertPass"
                className="h-10"
                type="password"
                autoComplete="new-password"
                maxLength={200}
                disabled={!canWrite}
                placeholder={cert ? "Clave del archivo que acabas de elegir" : "Escribe para cambiarla"}
                value={form.certificatePassword}
                onChange={(e) => setForm({ ...form, certificatePassword: e.target.value })}
              />
              {cert && (
                <p role="alert" className="text-xs text-amber-600">
                  Al subir un certificado nuevo se descarta la contraseña anterior: si el archivo
                  lleva contraseña, escríbela aquí antes de guardar o la firma fallará.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sunatAmbiente">Ambiente</Label>
              <Select
                value={form.ambiente}
                disabled={!canWrite}
                onValueChange={(v) => setForm({ ...form, ambiente: v === "production" ? "production" : "beta" })}
              >
                <SelectTrigger id="sunatAmbiente" className="h-10">
                  <SelectValue placeholder="Selecciona el ambiente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beta">Pruebas (beta) — sin validez fiscal</SelectItem>
                  <SelectItem value="production">Producción — comprobantes reales</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Empieza en pruebas, comprueba que la conexión funciona y solo entonces pasa a
                producción.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sunatEndpoint">Endpoint personalizado (opcional)</Label>
              <Input
                id="sunatEndpoint"
                className="h-10 font-mono text-xs"
                disabled={!canWrite}
                placeholder="Déjalo vacío para usar el oficial de SUNAT"
                value={form.endpointOverride}
                aria-invalid={endpointInvalido}
                aria-describedby="sunatEndpointHelp"
                onChange={(e) => setForm({ ...form, endpointOverride: e.target.value })}
              />
              <p
                id="sunatEndpointHelp"
                role={endpointInvalido ? "alert" : undefined}
                className={cn("text-xs", endpointInvalido ? "text-destructive" : "text-muted-foreground")}
              >
                {endpointInvalido
                  ? "Debe ser una URL completa (https://...)."
                  : "Solo si un OSE intermedia tus envíos."}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            aria-label="Enviar los comprobantes a SUNAT"
            disabled={!canWrite || (!form.enabled && !puedeActivar)}
            onClick={() => setForm({ ...form, enabled: !form.enabled })}
            className={cn(
              "flex min-h-[64px] w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              (!canWrite || (!form.enabled && !puedeActivar)) && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Enviar los comprobantes a SUNAT</span>
              <span className="block text-xs text-muted-foreground">
                {!puedeActivar
                  ? "Necesitas el usuario SOL, la clave SOL y el certificado digital antes de poder activarlo."
                  : form.enabled
                    ? "Activado: cada boleta o factura se firma y se declara a SUNAT en el momento de emitirla."
                    : "Desactivado: los comprobantes se numeran en el sistema, pero no se declaran y no tienen valor fiscal."}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
                form.enabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
                  form.enabled ? "translate-x-5" : "translate-x-0",
                )}
              />
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <Button className="h-10" onClick={handleGuardar} disabled={!canWrite || guardar.isPending}>
              {guardar.isPending ? "Guardando..." : "Guardar configuración"}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => void handleProbar()}
              disabled={!canWrite || !config.configurado || probar.isPending}
            >
              <PlugZap className={cn("h-4 w-4 mr-2", probar.isPending && "animate-pulse")} />
              {probar.isPending ? "Probando..." : "Probar conexión"}
            </Button>
            {!config.configurado ? (
              <span className="text-xs text-muted-foreground">
                Guarda primero la configuración para poder probarla.
              </span>
            ) : (
              hayCambiosSinGuardar && (
                <span role="alert" className="text-xs text-amber-600">
                  La prueba usa la configuración guardada: guarda antes para probar los cambios
                  que acabas de escribir.
                </span>
              )
            )}
          </div>

          {resultado && <SunatTestPanel resultado={resultado} />}
        </CardContent>
      </Card>

      <SunatSeriesCard canWrite={canWrite} />

      <ConfirmDialog
        open={confirmProduccion}
        onOpenChange={setConfirmProduccion}
        title="Vas a pasar a producción"
        description="A partir de ahora los comprobantes se declararán a SUNAT con validez fiscal real: anularlos exige una comunicación de baja o una nota de crédito. Asegúrate de haber probado la conexión y de que las series son las definitivas. ¿Continuar?"
        confirmLabel="Sí, emitir en producción"
        variant="destructive"
        loading={guardar.isPending}
        onConfirm={() => void persistir()}
      />
    </div>
  );
}
