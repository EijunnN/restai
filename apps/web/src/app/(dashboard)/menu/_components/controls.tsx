"use client";

import { Check, Minus } from "lucide-react";
import type { EstadoCabecera } from "./menu-filters";

/**
 * Interruptor y casilla.
 *
 * Se escriben aquí, y no se traen de una librería, porque son `<button>` con
 * `role` correcto: un `<div>` con `onClick` no se alcanza con el tabulador, no
 * se activa con la barra espaciadora y el lector de pantalla no dice si está
 * encendido. En una pantalla donde el interruptor decide si un plato se vende,
 * eso no es un detalle de estilo.
 */

export function Interruptor({
  activo,
  onChange,
  disabled,
  etiqueta,
  tamano = "md",
}: {
  activo: boolean;
  onChange: (siguiente: boolean) => void;
  disabled?: boolean;
  /** Se lee en voz alta: debe nombrar el plato, no decir "interruptor". */
  etiqueta: string;
  tamano?: "sm" | "md";
}) {
  const pista = tamano === "sm" ? "h-[17px] w-[30px]" : "h-[19px] w-[34px]";
  const bola = tamano === "sm" ? "h-[13px] w-[13px]" : "h-[15px] w-[15px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!activo);
      }}
      className={`${pista} flex shrink-0 items-center rounded-full px-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        activo ? "justify-end bg-emerald-500" : "justify-start bg-muted-foreground/25"
      }`}
    >
      <span
        className={`${bola} rounded-full transition-colors ${
          activo ? "bg-background" : "bg-muted-foreground"
        }`}
      />
    </button>
  );
}

export function Casilla({
  marcada,
  onChange,
  etiqueta,
  disabled,
}: {
  marcada: boolean;
  onChange: (siguiente: boolean) => void;
  etiqueta: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!marcada);
      }}
      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-40 ${
        marcada
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/35 hover:border-muted-foreground/70"
      }`}
    >
      {marcada && <Check className="h-[11px] w-[11px]" strokeWidth={3} />}
    </button>
  );
}

/**
 * La casilla de la cabecera tiene TRES estados, no dos.
 *
 * "Parcial" se pinta con un guion, no con un tic: un tic diría "los tienes
 * todos" cuando tienes tres de nueve, y el siguiente clic borraría una
 * selección que el usuario creía completa.
 */
export function CasillaCabecera({
  estado,
  onChange,
  disabled,
}: {
  estado: EstadoCabecera;
  onChange: () => void;
  disabled?: boolean;
}) {
  const activa = estado !== "vacio";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={estado === "todo" ? true : estado === "parcial" ? "mixed" : false}
      aria-label={
        estado === "todo" ? "Quitar la selección de todo lo visible" : "Seleccionar todo lo visible"
      }
      disabled={disabled}
      onClick={onChange}
      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-40 ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/35 hover:border-muted-foreground/70"
      }`}
    >
      {estado === "todo" && <Check className="h-[11px] w-[11px]" strokeWidth={3} />}
      {estado === "parcial" && <Minus className="h-[11px] w-[11px]" strokeWidth={3} />}
    </button>
  );
}
