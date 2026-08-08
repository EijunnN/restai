"use client";

import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/**
 * El resto de la sección, al pie de la ficha.
 *
 * Un plato sin opciones dejaba media pantalla en blanco, y el único camino era
 * el botón de atrás. Aquí el comensal sigue eligiendo dentro de la misma
 * categoría —que es como se lee una carta: "a ver qué más hay de entradas"— sin
 * perder el sitio.
 *
 * Solo se muestran platos disponibles: ofrecer lo agotado como sugerencia es
 * hacer perder el tiempo.
 */

export interface RelatedDish {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  category_id: string;
}

export function RelatedDishes({
  dishes,
  categoryName,
  currency,
  onOpen,
}: {
  dishes: RelatedDish[];
  categoryName?: string;
  currency?: string;
  onOpen: (id: string) => void;
}) {
  if (dishes.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[15px] font-semibold">
        {categoryName ? `Más de ${categoryName.toLowerCase()}` : "Más de la carta"}
      </h2>

      {/* Carrusel horizontal: en vertical competiría con el plato que se está
          mirando, que es el que hay que decidir primero. */}
      <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
        {dishes.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onOpen(d.id)}
            className="w-[132px] shrink-0 text-left"
          >
            <span className="relative block h-[92px] w-full overflow-hidden rounded-2xl bg-muted">
              {d.image_url ? (
                <Image src={d.image_url} alt="" fill unoptimized className="object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center">
                  <UtensilsCrossed
                    className="h-5 w-5 text-muted-foreground/40"
                    aria-hidden="true"
                  />
                </span>
              )}
            </span>
            <span className="mt-2 block line-clamp-2 text-[13px] font-medium leading-tight">
              {d.name}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground tabular-nums">
              {formatCurrency(d.price, currency)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
