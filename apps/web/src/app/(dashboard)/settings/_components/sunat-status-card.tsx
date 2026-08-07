"use client";

import { Badge } from "@restai/ui/components/badge";
import { AlertTriangle, ShieldAlert, ShieldCheck, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SunatConfig } from "@/hooks/use-settings";

/** "2027-03-14T00:00:00.000Z" -> "14/03/2027". Vacío si no hay fecha. */
function formatIsoDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * El titular del certificado llega como un DN de X.509 multilínea
 * ("CN=...\nO=...\nC=PE"). En HTML los saltos se colapsan y quedan pegados, así
 * que se separan explícitamente.
 */
function formatSujeto(dn?: string): string {
  if (!dn) return "Titular desconocido";
  return dn
    .split(/\r?\n/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(" · ");
}

/**
 * Semáforo del estado fiscal.
 *
 * Es lo primero que se ve al abrir la pestaña porque responde a la única
 * pregunta que importa: ¿los comprobantes que emito tienen valor fiscal o no?
 */
export function SunatStatusCard({ config }: { config: SunatConfig }) {
  const configurado = config.configurado;
  const activo = !!config.enabled;
  const produccion = config.ambiente === "production";
  const cert = config.certificado;

  const estado: {
    tono: "bad" | "warn" | "good";
    titulo: string;
    detalle: string;
  } = !configurado
    ? {
        tono: "bad",
        titulo: "La facturación electrónica no está configurada",
        detalle:
          "El sistema responde SUNAT_NOT_CONFIGURED al intentar declarar: los comprobantes que emitas quedan solo en RestAI y NO tienen valor fiscal. Completa los datos de esta pantalla antes de operar con clientes que pidan boleta o factura.",
      }
    : !activo
      ? {
          tono: "warn",
          titulo: "Configurada, pero desactivada",
          detalle:
            "Los comprobantes se numeran y se guardan en el sistema, pero no se envían a SUNAT y no tienen valor fiscal. Activa el interruptor cuando la prueba de conexión salga correcta.",
        }
      : !produccion
        ? {
            tono: "warn",
            titulo: "Activa en ambiente de pruebas (BETA)",
            detalle:
              "Todo lo que envíes va al entorno de homologación de SUNAT: sirve para probar, pero NINGÚN comprobante tiene validez fiscal. Cambia a Producción cuando termines las pruebas.",
          }
        : {
            tono: "good",
            titulo: "Facturación electrónica activa en producción",
            detalle:
              "Los comprobantes se declaran a SUNAT con validez fiscal. Vigila la fecha de vencimiento del certificado digital.",
          };

  const tonos = {
    bad: "border-destructive/50 bg-destructive/10",
    warn: "border-amber-500/50 bg-amber-500/10",
    good: "border-green-500/50 bg-green-500/10",
  } as const;

  const Icono = estado.tono === "good" ? ShieldCheck : estado.tono === "warn" ? AlertTriangle : ShieldAlert;

  return (
    <div className="space-y-3">
      <div role="alert" className={cn("rounded-lg border p-4", tonos[estado.tono])}>
        <div className="flex items-start gap-3">
          <Icono
            className={cn(
              "h-5 w-5 mt-0.5 shrink-0",
              estado.tono === "good"
                ? "text-green-600"
                : estado.tono === "warn"
                  ? "text-amber-600"
                  : "text-destructive",
            )}
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{estado.titulo}</p>
            <p className="text-sm text-muted-foreground">{estado.detalle}</p>
          </div>
        </div>
      </div>

      {!config.cifrado_disponible && (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">El servidor no puede guardar credenciales</p>
              <p className="text-sm text-muted-foreground">
                Falta la variable SUNAT_ENCRYPTION_KEY (mínimo 16 caracteres) en el servidor.
                Sin ella no se pueden cifrar ni leer el usuario SOL ni el certificado. Es una
                tarea del administrador del sistema, no se resuelve desde aquí.
              </p>
            </div>
          </div>
        </div>
      )}

      {configurado && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Emisor</p>
            <p className="mt-1 truncate text-sm font-medium">{config.razon_social || "—"}</p>
            <p className="font-mono text-xs text-muted-foreground">RUC {config.ruc || "—"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={produccion ? "default" : "secondary"}>
                {produccion ? "Producción" : "Pruebas (beta)"}
              </Badge>
              <Badge variant={activo ? "default" : "outline"}>
                {activo ? "Envío activado" : "Envío desactivado"}
              </Badge>
              <Badge variant={config.tiene_credenciales_sol ? "default" : "destructive"}>
                {config.tiene_credenciales_sol
                  ? `Usuario SOL ${config.usuario_sol_enmascarado ?? "configurado"}`
                  : "Sin usuario SOL"}
              </Badge>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Certificado digital
            </p>
            {!cert?.presente ? (
              <p className="mt-1 text-sm text-destructive">
                No has subido ningún certificado. Sin él no se puede firmar ni un solo comprobante.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm font-medium">
                  {cert.valido ? "Válido" : "No utilizable"}
                  {typeof cert.diasParaVencer === "number" && cert.valido && (
                    <span
                      className={cn(
                        "ml-2 text-xs font-normal",
                        cert.diasParaVencer <= 30 ? "text-amber-600" : "text-muted-foreground",
                      )}
                    >
                      vence en {cert.diasParaVencer} día(s)
                    </span>
                  )}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {formatSujeto(cert.sujeto)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Vigencia: {formatIsoDate(cert.validoDesde)} — {formatIsoDate(cert.validoHasta)} ·
                  formato {(cert.formato || "pfx").toUpperCase()}
                </p>
                {cert.motivo && (
                  <p className="mt-1 text-xs text-amber-600" role="alert">
                    {cert.motivo}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {configurado && config.endpoint_efectivo && (
        <p className="flex items-center gap-2 break-all text-xs text-muted-foreground">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          Endpoint en uso: <span className="font-mono">{config.endpoint_efectivo}</span>
        </p>
      )}

      {config.advertencias?.length > 0 && (
        // Son ADVERTENCIAS, no confirmaciones: un icono de "correcto" delante de
        // "la facturación está desactivada" le dice al usuario lo contrario de
        // lo que la frase significa.
        <ul className="space-y-1">
          {config.advertencias.map((aviso, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle
                className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{aviso}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
