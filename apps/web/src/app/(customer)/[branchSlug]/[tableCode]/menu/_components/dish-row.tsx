"use client";

import Image from "next/image";
import { ChevronRight, Plus, UtensilsCrossed } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Un plato en la carta.
 *
 * Pasa de tarjeta en rejilla a fila ancha. En una rejilla de dos columnas, la
 * descripción cabía en dos líneas recortadas y los alérgenos se cortaban: el
 * comensal tenía que abrir cada plato para saber qué era. En fila, la foto
 * sigue siendo la que vende y el texto tiene sitio para explicarse.
 */

export interface DishRowItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  preparation_time_min?: number | null;
  allergens?: string[] | null;
  has_modifiers?: boolean;
}

/** Alérgenos en castellano; sin traducir, el chip dice "shellfish" a un comensal peruano. */
const ALERGENOS: Record<string, string> = {
  gluten: "gluten",
  crustaceans: "crustáceos",
  eggs: "huevo",
  fish: "pescado",
  peanuts: "maní",
  soy: "soya",
  milk: "lácteos",
  nuts: "frutos secos",
  celery: "apio",
  mustard: "mostaza",
  sesame: "ajonjolí",
  sulphites: "sulfitos",
  lupin: "altramuces",
  molluscs: "moluscos",
  shellfish: "mariscos",
};

export function DishRow({
  item,
  currency,
  units,
  variantSummary,
  onOpen,
  onAdd,
  onOpenVariants,
}: {
  item: DishRowItem;
  currency?: string;
  /** Unidades en el pedido, sumando todas las configuraciones. */
  units: number;
  /** "1 clásica · 1 con palta extra". Solo si hay más de una configuración. */
  variantSummary?: string | null;
  onOpen: () => void;
  onAdd: () => void;
  onOpenVariants: () => void;
}) {
  const agotado = !item.is_available;
  const alergenos = (item.allergens ?? [])
    .map((a) => ALERGENOS[a] ?? a)
    .filter(Boolean);

  return (
    <div
      className={cn(
        "flex gap-3.5 border-b border-border/70 py-4 last:border-b-0",
        agotado && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={agotado}
        aria-label={`Ver ${item.name}`}
        className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl bg-muted"
      >
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt=""
            fill
            unoptimized
            className={cn("object-cover", agotado && "grayscale")}
          />
        ) : (
          <span className="flex h-full items-center justify-center">
            <UtensilsCrossed className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onOpen}
        disabled={agotado}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block text-[17px] font-medium leading-tight">{item.name}</span>
        {item.description && (
          <span className="mt-1 block line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {item.description}
          </span>
        )}

        {/* Lo que ya hay pedido manda sobre los alérgenos: es la información que
            el comensal busca cuando vuelve a la carta a mitad de comida. */}
        {units > 0 ? (
          <span className="mt-1.5 block">
            <span className="block text-[11px] font-medium text-foreground">
              {units} en tu pedido
            </span>
            {variantSummary && (
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {variantSummary}
              </span>
            )}
          </span>
        ) : (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {agotado && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Se acabó hoy
              </span>
            )}
            {!agotado && alergenos.length > 0 && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Contiene {alergenos.slice(0, 2).join(", ")}
              </span>
            )}
            {!agotado && item.preparation_time_min ? (
              <span className="text-[11px] text-muted-foreground">
                ~{item.preparation_time_min} min
              </span>
            ) : null}
          </span>
        )}
      </button>

      <div className="flex shrink-0 flex-col items-end justify-between">
        <span
          className={cn(
            "whitespace-nowrap text-[15px] font-semibold",
            agotado && "text-muted-foreground",
          )}
        >
          {formatCurrency(item.price, currency)}
        </span>

        {agotado ? (
          <span className="text-[12px] text-muted-foreground">Agotado</span>
        ) : units > 0 ? (
          /* Con algo ya pedido, el botón deja de añadir a ciegas y abre las
             configuraciones: un "+" aquí crearía una línea nueva sin que el
             comensal viera las que ya tiene. */
          <button
            type="button"
            onClick={onOpenVariants}
            aria-label={`Ver lo que pediste de ${item.name}`}
            className="flex h-10 items-center gap-2 rounded-full border border-border bg-muted/60 pl-2.5 pr-3"
          >
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[12px] font-semibold text-primary-foreground tabular-nums">
              {units}
            </span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            aria-label={
              item.has_modifiers ? `Elegir opciones de ${item.name}` : `Añadir ${item.name}`
            }
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              item.has_modifiers
                ? "border border-border"
                : "bg-primary text-primary-foreground",
            )}
          >
            {item.has_modifiers ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
