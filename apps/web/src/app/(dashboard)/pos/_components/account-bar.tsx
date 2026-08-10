"use client";

import { Bike, ChevronDown, Package, Plus, Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { estadoDe, grupoDe, type CuentaAbierta } from "./pos-accounts";
import { formatearApertura } from "./open-accounts";

/**
 * Sobre qué cuenta estoy cantando.
 *
 * El punto de venta solo sabía de una cuenta —la del carrito que tenía delante—
 * y no la nombraba en ningún sitio: el cajero deducía a qué mesa iba lo que
 * estaba tecleando por el selector de mesa, tres bloques más abajo. Cuando la
 * cuenta ya existe, esto es lo primero que se lee, porque es lo primero que hay
 * que verificar antes de cobrar.
 *
 * Toda la barra es el conmutador: tocarla abre la lista. Antes había que buscar
 * un enlace de doce píxeles debajo.
 */

const ICONO = { mesa: Users, llevar: Package, delivery: Bike } as const;

/** Los tres colores de la lista, para que el resumen no mienta sobre el orden. */
const PUNTOS = [
  { clave: "cobro", clase: "bg-amber-500" },
  { clave: "entregar", clase: "bg-blue-500" },
  { clave: "tranquilas", clase: "bg-muted-foreground/30" },
] as const;

export function AccountBar({
  cuenta,
  cuentas,
  onVerTodas,
  onNuevaCuenta,
}: {
  /** Cuenta sobre la que se está cantando, o `null` si es una venta nueva. */
  cuenta: CuentaAbierta | null;
  /** Todas las cuentas abiertas del local ahora mismo. */
  cuentas: CuentaAbierta[];
  onVerTodas: () => void;
  /** Suelta la cuenta y empieza una venta nueva. */
  onNuevaCuenta: () => void;
}) {
  const otras = cuenta ? cuentas.length - 1 : cuentas.length;
  const porCobrar = cuentas
    .filter((c) => c.clave !== cuenta?.clave)
    .reduce((suma, c) => suma + c.saldo, 0);
  const Icono = cuenta ? ICONO[cuenta.tipo] : Plus;

  // Solo se pintan los colores que existen ahora mismo: tres puntos fijos
  // prometerían tres grupos aunque el local esté tranquilo.
  const gruposVivos = new Set(cuentas.map(grupoDe));

  const comensales =
    cuenta?.comensales && cuenta.comensales > 0
      ? `${cuenta.comensales} ${cuenta.comensales === 1 ? "pers." : "pers."}`
      : null;

  return (
    <div className="mb-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVerTodas}
          aria-label={
            cuenta
              ? `Cuenta activa: ${cuenta.nombre}. Cambiar de cuenta`
              : "Venta nueva. Ver las cuentas abiertas"
          }
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
            cuenta
              ? "border-primary/30 bg-primary/[0.06] hover:bg-primary/[0.1]"
              : "border-dashed border-border bg-muted/30 hover:bg-muted/50"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              cuenta ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            <Icono className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold tracking-tight">
              {cuenta
                ? [cuenta.nombre, comensales].filter(Boolean).join(" · ")
                : "Cuenta nueva"}
            </span>
            <span className="block truncate text-[11.5px] text-muted-foreground">
              {cuenta
                ? [cuenta.cliente, formatearApertura(cuenta.minutos)].filter(Boolean).join(" · ") ||
                  estadoDe(cuenta)
                : "Lo que cantes aquí abre una cuenta"}
            </span>
          </span>

          {cuenta && cuenta.saldo > 0 && (
            <span className="shrink-0 text-sm font-extrabold tabular-nums">
              {formatCurrency(cuenta.saldo)}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        {/*
          Cuenta nueva sin pasar por la lista. Es el gesto del mostrador: llega
          alguien mientras tienes abierta la mesa 7 y hay que empezar de cero.
        */}
        {cuenta && (
          <button
            type="button"
            onClick={onNuevaCuenta}
            aria-label="Empezar una cuenta nueva"
            title="Cuenta nueva"
            className="flex h-[58px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/*
        El resto del local en una línea. Con una sola cuenta abierta —la que ya
        se está mirando— no hay nada que ver y desaparece en vez de prometer una
        lista vacía.
      */}
      {otras > 0 && (
        <button
          type="button"
          onClick={onVerTodas}
          className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex shrink-0 gap-[3px]">
            {PUNTOS.filter((p) => gruposVivos.has(p.clave)).map((p) => (
              <span key={p.clave} className={`h-1.5 w-1.5 rounded-full ${p.clase}`} />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">
            {otras} {otras === 1 ? "cuenta más abierta" : "cuentas más abiertas"}
            {porCobrar > 0 && ` · ${formatCurrency(porCobrar)} por cobrar`}
          </span>
          <span className="shrink-0 font-bold text-foreground/80">Ver todas</span>
        </button>
      )}
    </div>
  );
}
