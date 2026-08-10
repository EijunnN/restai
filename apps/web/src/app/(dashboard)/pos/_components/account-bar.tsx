"use client";

import { Bike, ChevronRight, Package, Plus, Users, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { estadoDe, type CuentaAbierta } from "./pos-accounts";

/**
 * Sobre qué cuenta estoy cantando.
 *
 * El punto de venta solo sabía de una cuenta —la del carrito que tenía delante—
 * y no la nombraba en ningún sitio: el cajero deducía a qué mesa iba lo que
 * estaba tecleando por el selector de mesa, tres bloques más abajo. Cuando la
 * cuenta es una que ya existe, esto es lo primero que se lee, porque es lo
 * primero que hay que verificar antes de cobrar.
 */

const ICONO = { mesa: Users, llevar: Package, delivery: Bike } as const;

export function AccountBar({
  cuenta,
  abiertas,
  onVerTodas,
  onSoltar,
}: {
  /** Cuenta sobre la que se está cantando, o `null` si es una venta nueva. */
  cuenta: CuentaAbierta | null;
  /** Cuántas cuentas hay abiertas en el local ahora mismo. */
  abiertas: number;
  onVerTodas: () => void;
  onSoltar: () => void;
}) {
  const otras = cuenta ? Math.max(0, abiertas - 1) : abiertas;
  const Icono = cuenta ? ICONO[cuenta.tipo] : Plus;

  return (
    <div className="mb-3">
      <div
        className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${
          cuenta ? "border-primary/30 bg-primary/[0.06]" : "border-dashed border-border bg-muted/30"
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
            {cuenta ? cuenta.nombre : "Cuenta nueva"}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {cuenta
              ? `${estadoDe(cuenta)}${cuenta.saldo > 0 ? ` · ${formatCurrency(cuenta.saldo)} sin cobrar` : ""}`
              : "Lo que cantes aquí abre una cuenta"}
          </span>
        </span>

        {cuenta && (
          <button
            type="button"
            onClick={onSoltar}
            aria-label="Salir de esta cuenta y empezar una nueva"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/*
        La salida hacia el resto del local. Con una sola cuenta abierta —la que
        ya se está mirando— no hay nada que ver y el enlace desaparece en vez de
        prometer una lista vacía.
      */}
      {otras > 0 && (
        <button
          type="button"
          onClick={onVerTodas}
          className="mt-1.5 flex w-full items-center gap-1 rounded-lg px-1 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {otras} {otras === 1 ? "cuenta más abierta" : "cuentas más abiertas"}
          <span className="font-bold">· Ver todas</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
