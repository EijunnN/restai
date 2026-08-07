"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SunatTestResult } from "@/hooks/use-settings";

interface PasoProps {
  titulo: string;
  ok: boolean;
  detalle?: string;
  codigo?: string;
}

function Paso({ titulo, ok, detalle, codigo }: PasoProps) {
  return (
    <li className="flex items-start gap-3 rounded-md border p-3">
      {ok ? (
        <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
      ) : (
        <XCircle className="h-5 w-5 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {titulo}: <span className={ok ? "text-green-600" : "text-destructive"}>{ok ? "correcto" : "falla"}</span>
        </p>
        {(detalle || codigo) && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {codigo ? `[${codigo}] ` : ""}
            {detalle}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Resultado de la prueba de conexión, paso a paso.
 *
 * El diagnóstico llega con 200 aunque falle: lo que importa es `ok`. Mostrar los
 * cuatro pasos por separado es la diferencia entre "no funciona" y "el
 * certificado está bien pero la clave SOL es de otro usuario".
 */
export function SunatTestPanel({ resultado }: { resultado: SunatTestResult }) {
  const cert = resultado.certificado;
  const sujeto = (cert?.sujeto ?? "")
    .split(/\r?\n/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      // Un diagnóstico fallido es lo que el usuario tiene que leer ya: se anuncia
      // como alerta, no como una actualización de estado que el lector de
      // pantalla puede dejar para después.
      role={resultado.ok ? "status" : "alert"}
      className={cn(
        "space-y-3 rounded-lg border p-4",
        resultado.ok ? "border-green-500/50 bg-green-500/10" : "border-destructive/50 bg-destructive/10",
      )}
    >
      <div>
        <p className="text-sm font-medium">{resultado.mensaje}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ambiente {resultado.ambiente === "production" ? "producción" : "pruebas (beta)"} ·{" "}
          <span className="font-mono break-all">{resultado.endpoint}</span> ·{" "}
          {Math.round(resultado.duracion_ms)} ms
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        <Paso
          titulo="Certificado digital"
          ok={!!cert?.presente && !!cert?.valido}
          detalle={
            cert?.motivo ??
            (cert?.presente ? sujeto || "Certificado válido" : "No hay ningún certificado guardado")
          }
        />
        <Paso titulo="Firma del comprobante" ok={resultado.firma.ok} detalle={resultado.firma.motivo} />
        <Paso
          titulo="Conexión con SUNAT"
          ok={resultado.conexion.ok}
          detalle={resultado.conexion.motivo}
          codigo={resultado.conexion.codigo}
        />
        <Paso
          titulo="Usuario y clave SOL"
          ok={resultado.credenciales.ok}
          detalle={resultado.credenciales.motivo}
          codigo={resultado.credenciales.codigo}
        />
      </ul>

      {!resultado.habilitado && (
        <p className="text-xs text-muted-foreground">
          Recuerda que el envío a SUNAT sigue desactivado: aunque la prueba salga correcta, los
          comprobantes no se declararán hasta que actives el interruptor y guardes.
        </p>
      )}
    </div>
  );
}
