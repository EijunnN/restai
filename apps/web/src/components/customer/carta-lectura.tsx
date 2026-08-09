"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Search, UtensilsCrossed, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { ALERGENOS, DishFacts } from "./dish-facts";

/**
 * La carta cuando el QR es solo para leer.
 *
 * Sustituye a la carta de papel y nada más: sin carrito, sin botones de añadir,
 * sin pedir permiso a un mozo para poder mirar. Es lo que quiere la mayoría de
 * locales pequeños, y hasta ahora el sistema no lo contemplaba.
 *
 * La sirven DOS entradas —el QR de una mesa y el código público de la sede— y
 * por eso vive aquí y no dentro de una de ellas. Si estuviera duplicada, un día
 * el comensal vería una carta distinta según por dónde entrase.
 *
 * Al tocar un plato se abre su ficha en una hoja y NO se navega: la carta de
 * sede no tiene ruta de detalle, y volver atrás en el móvil después de mirar
 * cuatro platos es el tipo de fricción por la que se abandona una pantalla.
 */

export interface PlatoCarta {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  preparation_time_min?: number | null;
  allergens?: string[] | null;
  dietary_tags?: string[] | null;
  spice_level?: number | null;
  has_modifiers?: boolean;
}

export interface CategoriaCarta {
  id: string;
  name: string;
  description?: string | null;
}

/** Sin tildes ni mayúsculas: se busca "aji" y tiene que salir "ají". */
function normalizar(texto: string): string {
  return texto
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function CartaLectura({
  branchName,
  currency,
  categories,
  items,
  /** "Mesa 5", cuando se entra por el QR de una mesa. */
  subtitulo,
  /** Cómo se pide aquí. Se dice porque el comensal va a preguntárselo. */
  comoPedir = "Cuando quieras pedir, llama a un mozo.",
}: {
  branchName: string;
  currency?: string;
  categories: CategoriaCarta[];
  items: PlatoCarta[];
  subtitulo?: string | null;
  comoPedir?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<PlatoCarta | null>(null);

  const q = normalizar(busqueda.trim());

  const visibles = useMemo(() => {
    if (!q) return items;
    return items.filter(
      (i) =>
        normalizar(i.name).includes(q) ||
        normalizar(i.description ?? "").includes(q),
    );
  }, [items, q]);

  const secciones = useMemo(
    () =>
      categories
        .map((cat) => ({ cat, platos: visibles.filter((i) => i.category_id === cat.id) }))
        .filter((s) => s.platos.length > 0),
    [categories, visibles],
  );

  const irASeccion = (id: string) => {
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-dvh bg-background pb-20">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 pb-3 pt-4">
          <h1 className="text-[19px] font-semibold leading-tight">{branchName}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {subtitulo ? `${subtitulo} · Carta` : "Carta"}
          </p>

          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar un plato…"
              aria-label="Buscar un plato"
              className="h-11 w-full rounded-xl bg-muted pl-9 pr-9 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                aria-label="Borrar la búsqueda"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {!q && secciones.length > 1 && (
            <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5">
              {secciones.map(({ cat }) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => irASeccion(cat.id)}
                  className="h-9 shrink-0 rounded-full border border-border px-4 text-[13.5px] font-medium text-muted-foreground"
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4">
        {q && (
          <p className="pt-4 text-[13px] text-muted-foreground">
            {visibles.length === 0
              ? "Ningún plato coincide con lo que buscas."
              : `${visibles.length} ${visibles.length === 1 ? "plato" : "platos"}`}
          </p>
        )}

        {secciones.map(({ cat, platos }) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-40 pt-6">
            <h2 className="text-[15px] font-semibold uppercase tracking-wide text-muted-foreground">
              {cat.name}
            </h2>
            {cat.description && (
              <p className="mt-1 text-[13px] text-muted-foreground">{cat.description}</p>
            )}

            <div className="mt-2">
              {platos.map((plato) => (
                <FilaLectura
                  key={plato.id}
                  plato={plato}
                  currency={currency}
                  onAbrir={() => setAbierto(plato)}
                />
              ))}
            </div>
          </section>
        ))}

        {secciones.length === 0 && !q && (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Este local todavía no ha publicado su carta.
            </p>
          </div>
        )}

        <p className="border-t border-border/70 py-6 text-center text-[13px] text-muted-foreground">
          {comoPedir}
        </p>
      </main>

      {abierto && (
        <FichaLectura
          plato={abierto}
          currency={currency}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

function FilaLectura({
  plato,
  currency,
  onAbrir,
}: {
  plato: PlatoCarta;
  currency?: string;
  onAbrir: () => void;
}) {
  const agotado = !plato.is_available;
  const alergenos = (plato.allergens ?? []).map((a) => ALERGENOS[a] ?? a).filter(Boolean);

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "flex w-full gap-3.5 border-b border-border/70 py-4 text-left last:border-b-0",
        agotado && "opacity-60",
      )}
    >
      <span className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl bg-muted">
        {plato.image_url ? (
          <Image
            src={plato.image_url}
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
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium leading-tight">{plato.name}</span>
        {plato.description && (
          <span className="mt-1 block line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {plato.description}
          </span>
        )}
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
          {!agotado && plato.preparation_time_min ? (
            <span className="text-[11px] text-muted-foreground">
              ~{plato.preparation_time_min} min
            </span>
          ) : null}
        </span>
      </span>

      <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">
        {formatCurrency(plato.price, currency)}
      </span>
    </button>
  );
}

/**
 * La ficha, en una hoja que sube desde abajo.
 *
 * No navega a otra ruta a propósito: la carta de sede no tiene ruta de detalle,
 * y en el móvil volver atrás tras mirar cuatro platos cansa. Al cerrarse, la
 * carta sigue exactamente donde estaba.
 */
function FichaLectura({
  plato,
  currency,
  onCerrar,
}: {
  plato: PlatoCarta;
  currency?: string;
  onCerrar: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={plato.name}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onCerrar}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background pb-8">
        {plato.image_url && (
          <div className="relative h-56 w-full overflow-hidden rounded-t-3xl bg-muted">
            <Image src={plato.image_url} alt="" fill unoptimized className="object-cover" />
          </div>
        )}

        <div className="px-5 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[22px] font-semibold leading-tight">{plato.name}</h3>
              <p className="mt-1 text-[17px] font-semibold">
                {formatCurrency(plato.price, currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar la ficha"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {plato.description && (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {plato.description}
            </p>
          )}

          {!plato.is_available && (
            <p className="mt-3 rounded-xl border border-border bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">
              Hoy se acabó. Pregunta al mozo si vuelve mañana.
            </p>
          )}

          <DishFacts
            prepTime={plato.preparation_time_min}
            spiceLevel={plato.spice_level}
            dietaryTags={plato.dietary_tags}
            allergens={plato.allergens}
            // En modo lectura no se eligen opciones, así que la frase "se sirve
            // tal cual" sobra: aquí nadie iba a elegir nada.
            hasOptions
          />
        </div>
      </div>
    </div>
  );
}
