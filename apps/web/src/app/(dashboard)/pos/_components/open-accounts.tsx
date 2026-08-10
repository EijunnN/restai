"use client";

import { Bike, Package, Users, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  agruparCuentas,
  estadoDe,
  type CuentaAbierta,
  type GrupoCuenta,
} from "./pos-accounts";

/**
 * Todas las cuentas abiertas del local, de un vistazo.
 *
 * El punto de venta solo sabía de UNA cuenta: la del carrito que tenía delante,
 * en memoria y perdida al recargar. Para saber qué debía la mesa 7 había que
 * irse a la pantalla de mesas y volver.
 *
 * Doce caben en una rejilla; no caben en pestañas. Y no se ordenan por número de
 * mesa sino por lo que espera algo de ti: primero quien ya pidió la cuenta
 * —porque hay alguien de pie—, después lo que está cantado y sin mandar, y al
 * final lo que no necesita nada de nadie.
 */

const ICONO: Record<string, typeof Users> = {
  mesa: Users,
  llevar: Package,
  delivery: Bike,
};

const TONO: Record<GrupoCuenta, { punto: string; texto: string; fondo: string }> = {
  cobro: {
    punto: "bg-amber-500",
    texto: "text-amber-600 dark:text-amber-400",
    fondo: "bg-amber-500/[0.07] border-amber-500/25",
  },
  entregar: {
    punto: "bg-blue-500",
    texto: "text-blue-600 dark:text-blue-400",
    fondo: "bg-blue-500/[0.07] border-blue-500/25",
  },
  tranquilas: {
    punto: "bg-muted-foreground/40",
    texto: "text-muted-foreground",
    fondo: "bg-muted/40 border-border/60",
  },
};

/** "52 m", "1 h 41". */
export function formatearApertura(minutos: number): string {
  if (minutos < 60) return `${minutos} m`;
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")}`;
}

export function OpenAccounts({
  cuentas,
  claveActiva,
  cargando,
  onElegir,
  onCerrar,
  acciones,
}: {
  cuentas: CuentaAbierta[];
  claveActiva: string | null;
  cargando: boolean;
  onElegir: (cuenta: CuentaAbierta) => void;
  onCerrar: () => void;
  /** Botones de "nueva cuenta" que aporta la pantalla. */
  acciones?: React.ReactNode;
}) {
  const secciones = agruparCuentas(cuentas);
  const total = cuentas.reduce((suma, c) => suma + c.saldo, 0);
  const esperando = cuentas.filter((c) => c.cuentaPedida && c.saldo > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-4 backdrop-blur md:p-6">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight">Cuentas abiertas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cuentas.length === 0
                ? "No hay ninguna cuenta abierta ahora mismo"
                : `${cuentas.length} ${cuentas.length === 1 ? "cuenta" : "cuentas"} · ${formatCurrency(total)} sin cobrar${
                    esperando > 0
                      ? ` · ${esperando} ${esperando === 1 ? "espera" : "esperan"} cobro`
                      : ""
                  }`}
            </p>
          </div>
          {acciones}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar las cuentas abiertas"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {cargando && cuentas.length === 0 && (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )}

          {!cargando && cuentas.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <Users className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Ninguna mesa ocupada y nada pendiente en mostrador
              </p>
              <p className="max-w-sm text-xs text-muted-foreground/70">
                Las cuentas aparecen aquí en cuanto se canta el primer pedido, venga de
                una mesa, del mostrador o de un reparto.
              </p>
            </div>
          )}

          {secciones.map((seccion) => {
            const tono = TONO[seccion.clave];
            return (
              <section key={seccion.clave}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span
                    className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${tono.texto}`}
                  >
                    {seccion.titulo}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="text-[11.5px] text-muted-foreground">{seccion.nota}</span>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {seccion.cuentas.map((c) => {
                    const Icono = ICONO[c.tipo] ?? Users;
                    const activa = claveActiva === c.clave;
                    return (
                      <button
                        key={c.clave}
                        type="button"
                        onClick={() => onElegir(c)}
                        // El nombre accesible se dicta entero: leído a trozos,
                        // "Mesa 12 · 52 · 226,56" no dice nada.
                        aria-label={`${c.nombre}: ${estadoDe(c)}. ${formatCurrency(c.saldo)} sin cobrar, abierta hace ${formatearApertura(c.minutos)}`}
                        aria-current={activa ? "true" : undefined}
                        className={`flex h-[104px] flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-colors ${
                          activa
                            ? "border-foreground/25 bg-muted"
                            : `${tono.fondo} hover:bg-muted/70`
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${tono.punto}`} />
                          <Icono className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
                            {c.nombre}
                          </span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                            {formatearApertura(c.minutos)}
                          </span>
                        </span>

                        <span className="truncate text-[11.5px] text-muted-foreground">
                          {[estadoDe(c), c.cliente].filter(Boolean).join(" · ")}
                        </span>

                        <span className="mt-auto flex items-baseline gap-2">
                          <span className="text-[19px] font-extrabold tabular-nums tracking-tight">
                            {formatCurrency(c.saldo)}
                          </span>
                          <span className="flex-1" />
                          <span className={`text-[11px] font-bold ${tono.texto}`}>
                            {seccion.clave === "cobro"
                              ? "Cobrar"
                              : seccion.clave === "entregar"
                                ? "Entregar"
                                : "Abierta"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
