"use client";

import { Clock, Flame, Leaf, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Los datos del plato que el comensal necesita ANTES de pedirlo.
 *
 * Todos llegaban ya de la API y ninguno se pintaba en la ficha: el resultado
 * era una pantalla con el nombre, el precio y una línea de descripción, más
 * vacía que la propia fila de la carta. Un plato sin opciones no tenía
 * literalmente nada que enseñar.
 *
 * Cada bloque aparece solo si hay dato. Nada de huecos con guiones: si el local
 * no cargó los alérgenos, no se finge que los tiene.
 */

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

const DIETAS: Record<string, string> = {
  vegetarian: "Vegetariano",
  vegan: "Vegano",
  gluten_free: "Sin gluten",
  dairy_free: "Sin lácteos",
  nut_free: "Sin frutos secos",
  halal: "Halal",
  kosher: "Kosher",
  keto: "Keto",
  low_carb: "Bajo en carbohidratos",
};

/** El picante se dice con palabras: "3" no significa nada para quien no cocina. */
const PICANTE = ["", "Poco picante", "Picante", "Muy picante", "Bien picante", "Ardiente"];

export function DishFacts({
  prepTime,
  spiceLevel,
  dietaryTags,
  allergens,
  hasOptions,
}: {
  prepTime?: number | null;
  spiceLevel?: number | null;
  dietaryTags?: string[] | null;
  allergens?: string[] | null;
  /** Sin opciones, conviene decirlo en vez de dejar la ficha en blanco. */
  hasOptions: boolean;
}) {
  const dietas = (dietaryTags ?? []).map((t) => DIETAS[t] ?? t).filter(Boolean);
  const alergenos = (allergens ?? []).map((a) => ALERGENOS[a] ?? a).filter(Boolean);
  const picante = spiceLevel ? PICANTE[Math.min(spiceLevel, 5)] : null;

  const hayChips = !!prepTime || !!picante || dietas.length > 0;
  if (!hayChips && alergenos.length === 0 && hasOptions) return null;

  return (
    <div className="mt-4 space-y-3">
      {hayChips && (
        <div className="flex flex-wrap items-center gap-2">
          {prepTime ? (
            <Chip icon={Clock}>
              Listo en ~{prepTime} min
            </Chip>
          ) : null}
          {picante && (
            <Chip
              icon={Flame}
              className="border-orange-500/40 text-orange-700 dark:text-orange-400"
            >
              {picante}
            </Chip>
          )}
          {dietas.map((d) => (
            <Chip
              key={d}
              icon={Leaf}
              className="border-green-600/40 text-green-700 dark:text-green-400"
            >
              {d}
            </Chip>
          ))}
        </div>
      )}

      {/* Los alérgenos no son un chip más: quien los mira lo hace por salud, y
          tienen que leerse sin buscarlos entre etiquetas de colores. */}
      {alergenos.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="text-[13px] leading-snug text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Contiene {alergenos.join(", ")}.</span>{" "}
            Si tienes alguna alergia, avísale al mozo antes de pedir.
          </p>
        </div>
      )}

      {!hasOptions && (
        <p className="text-[13px] text-muted-foreground">
          Este plato se sirve tal cual, sin opciones que elegir.
        </p>
      )}
    </div>
  );
}

function Chip({
  icon: Icon,
  children,
  className,
}: {
  icon: typeof Clock;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
