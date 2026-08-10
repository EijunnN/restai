"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  AlertTriangle,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  Star,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  componerSecciones,
  contarPorCategoria,
  unidadesEnCarrito,
  type CategoriaDeCarta,
} from "./carta-pos";
import type { PosCartItem, PosMenuItem } from "../page";

/**
 * La carta del punto de venta.
 *
 * Antes era la misma rejilla que ve el comensal: foto 4:3, cuatro por fila como
 * mucho, ocho platos en pantalla. Pero quien cobra no está eligiendo qué le
 * apetece —ya sabe lo que es un lomo saltado—, está buscando un nombre concreto
 * lo más rápido que puede, muchas veces mientras el cliente se lo dicta. Con
 * fichas de texto caben el doble, y el plato que se canta cincuenta veces por
 * noche deja de estar a dos scrolls.
 *
 * La foto no desaparece: se queda en un interruptor, porque en una carta de
 * postres o de tragos el color sí ayuda a distinguir. Pero por defecto manda el
 * texto.
 */

/** Dónde recuerda el navegador si esta caja prefiere texto o foto. */
const CLAVE_VISTA = "pos:carta-vista";

function ProductGridComponent({
  categories,
  items,
  isLoading,
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  cart,
  onItemClick,
  pendingItemIds,
  isError,
  errorMessage,
  onRetry,
  pieDelCarril,
}: {
  categories: CategoriaDeCarta[];
  items: PosMenuItem[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (id: string | null) => void;
  cart: PosCartItem[];
  onItemClick: (item: PosMenuItem) => void;
  /** Productos cuya consulta de modificadores está en vuelo (uno por producto). */
  pendingItemIds: ReadonlySet<string>;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  /** Lo que va al pie del carril de categorías (el resumen del turno). */
  pieDelCarril?: React.ReactNode;
}) {
  /*
    Texto o foto.

    Arranca SIEMPRE en texto y solo después de montar lee lo guardado: leer
    `localStorage` durante el render da una marca en servidor distinta de la del
    navegador y React rehidrata mal la pantalla entera.
  */
  const [conFoto, setConFoto] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_VISTA) === "foto") setConFoto(true);
    } catch {
      // Navegador con el almacenamiento capado: la vista de texto es el defecto
      // y no hay nada que recuperar.
    }
  }, []);

  const cambiarVista = (foto: boolean) => {
    setConFoto(foto);
    try {
      window.localStorage.setItem(CLAVE_VISTA, foto ? "foto" : "texto");
    } catch {
      /* Sin persistencia; la sesión sigue funcionando igual. */
    }
  };

  const secciones = useMemo(
    () =>
      componerSecciones({
        platos: items,
        categorias: categories,
        categoriaElegida: selectedCategory,
        busqueda: search,
      }),
    [items, categories, selectedCategory, search],
  );

  const conteo = useMemo(() => contarPorCategoria(items), [items]);
  const totalDisponible = useMemo(
    () => items.filter((i) => i.is_available).length,
    [items],
  );
  const unidades = useMemo(() => unidadesEnCarrito(cart), [cart]);
  const totalEnCarrito = useMemo(
    () => cart.reduce((suma, linea) => suma + linea.quantity, 0),
    [cart],
  );

  /** Una fila del carril, y también un chip en el móvil. */
  const categoriaActiva = (id: string | null) => selectedCategory === id;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/*
        Carril de categorías. Solo desde `md`: en un teléfono, 152px fijos se
        comen media pantalla y la carta se queda sin sitio, así que ahí vuelven
        los chips horizontales de siempre.
      */}
      <aside className="hidden w-[152px] shrink-0 flex-col md:flex">
        <p className="mb-2 px-2.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Carta
        </p>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          <FilaDeCategoria
            nombre="Todos"
            cuenta={totalDisponible}
            activa={categoriaActiva(null)}
            onClick={() => onCategoryChange(null)}
          />
          {categories.map((cat) => (
            <FilaDeCategoria
              key={cat.id}
              nombre={cat.name}
              cuenta={conteo.get(cat.id) ?? 0}
              activa={categoriaActiva(cat.id)}
              oculta={cat.is_active === false}
              onClick={() => onCategoryChange(cat.id)}
            />
          ))}
        </nav>
        {pieDelCarril && <div className="mt-3 shrink-0">{pieDelCarril}</div>}
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Buscador y vista */}
        <div className="sticky top-0 z-10 space-y-3 rounded-[24px] bg-background/95 pb-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-11 rounded-2xl border-border/70 pl-9 pr-11"
                aria-label="Buscar producto en la carta"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  aria-label="Borrar la búsqueda"
                  className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/*
              Texto o foto. En una carta de fondos los nombres bastan y caben el
              doble; en una de postres o tragos el color distingue de un vistazo.
              Lo decide quien está en la caja, y se recuerda.
            */}
            <div className="hidden shrink-0 rounded-xl bg-muted p-[3px] sm:flex">
              <button
                type="button"
                onClick={() => cambiarVista(false)}
                aria-pressed={!conFoto}
                className={`h-8 rounded-lg px-3 text-xs transition-colors ${
                  conFoto ? "font-semibold text-muted-foreground" : "bg-background font-bold shadow-sm"
                }`}
              >
                Texto
              </button>
              <button
                type="button"
                onClick={() => cambiarVista(true)}
                aria-pressed={conFoto}
                className={`h-8 rounded-lg px-3 text-xs transition-colors ${
                  conFoto ? "bg-background font-bold shadow-sm" : "font-semibold text-muted-foreground"
                }`}
              >
                Foto
              </button>
            </div>

            <Badge
              variant="secondary"
              className="h-9 shrink-0 rounded-xl px-2.5 text-[11px] font-medium lg:hidden"
            >
              Pedido {totalEnCarrito}
            </Badge>
          </div>

          {/* Categorías en el móvil, donde no cabe el carril. */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              size="sm"
              className="h-10 shrink-0 rounded-full px-4"
              onClick={() => onCategoryChange(null)}
            >
              Todos
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={selectedCategory === cat.id ? "default" : "outline"}
                size="sm"
                className="h-10 shrink-0 rounded-full px-4"
                onClick={() => onCategoryChange(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        </div>

        {/*
          El ancho que decide cuántas fichas caben por fila es el de ESTA
          columna, no el de la ventana: con el panel del carrito abierto sobran
          400px que la ventana sigue contando. `@container` mide lo que hay.
        */}
        <div className="@container min-h-0 flex-1 overflow-y-auto pb-44 lg:pb-0">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="h-[88px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : isError ? (
            <div
              role="alert"
              className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-[24px] border border-destructive/40 bg-destructive/5 p-8 text-center"
            >
              <AlertTriangle className="h-7 w-7 text-destructive" />
              <p className="text-sm font-medium">No se pudo cargar la carta</p>
              <p className="text-xs text-muted-foreground">
                {errorMessage || "Revisa la conexión y vuelve a intentarlo."}
              </p>
              {onRetry && (
                <Button type="button" variant="outline" className="h-10" onClick={onRetry}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reintentar
                </Button>
              )}
            </div>
          ) : secciones.length === 0 ? (
            <div className="mx-auto max-w-sm rounded-[24px] border border-dashed p-8 text-center">
              <UtensilsCrossed className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">
                {search
                  ? `Ningún producto coincide con "${search}"`
                  : "No hay productos disponibles"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search
                  ? "Prueba con otro nombre o cambia de categoría."
                  : "Los productos agotados no se muestran. Actívalos desde Carta."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {secciones.map((seccion) => (
                <section key={seccion.id}>
                  {/*
                    La cabecera hace de mojón: sin ella hay que leer sesenta
                    nombres para saber dónde acaban las entradas.
                  */}
                  <div className="mb-2 flex items-center gap-2.5">
                    {seccion.anclada && (
                      <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" />
                    )}
                    <span
                      className={`text-[11px] font-extrabold uppercase tracking-[0.16em] ${
                        seccion.anclada ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {seccion.titulo}
                    </span>
                    {seccion.oculta && (
                      <span className="flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        <EyeOff className="h-3 w-3" />
                        Fuera de la carta
                      </span>
                    )}
                    <span className="h-px flex-1 bg-border/70" />
                    <span className="text-[11.5px] text-muted-foreground">{seccion.nota}</span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4">
                    {seccion.platos.map((plato) => {
                      const enCarrito = unidades.get(plato.id) ?? 0;
                      // Cada toque consulta los grupos de opciones del plato. Sin
                      // este bloqueo, con red lenta el segundo toque añadía una
                      // unidad duplicada antes de que respondiera el primero.
                      const enVuelo = pendingItemIds.has(plato.id);
                      const tieneOpciones = (plato.modifier_group_count ?? 0) > 0;

                      return (
                        <button
                          key={plato.id}
                          onClick={() => onItemClick(plato as PosMenuItem)}
                          disabled={enVuelo}
                          aria-busy={enVuelo}
                          aria-label={`Añadir ${plato.name} al pedido, ${formatCurrency(plato.price)}${
                            tieneOpciones ? ", tiene opciones" : ""
                          }${enCarrito > 0 ? `, ${enCarrito} ya en el pedido` : ""}`}
                          className={`relative flex h-[88px] items-stretch gap-2.5 rounded-2xl border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-70 ${
                            enCarrito > 0
                              ? "border-primary/40 bg-primary/[0.06]"
                              : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/50"
                          }`}
                        >
                          {conFoto && (
                            <span className="flex w-[60px] shrink-0 items-center justify-center self-stretch overflow-hidden rounded-xl bg-muted">
                              {plato.image_url ? (
                                <img
                                  src={plato.image_url}
                                  alt=""
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </span>
                          )}

                          <span className="flex min-w-0 flex-1 flex-col justify-between">
                            <span className="flex items-start gap-2">
                              <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] font-semibold leading-tight">
                                {plato.name}
                              </span>
                              {enCarrito > 0 && (
                                <span className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-lg bg-primary px-1.5 text-xs font-extrabold tabular-nums text-primary-foreground">
                                  {enCarrito}
                                </span>
                              )}
                            </span>

                            <span className="flex items-baseline gap-2">
                              <span className="text-[15px] font-extrabold tabular-nums tracking-tight">
                                {formatCurrency(plato.price)}
                              </span>
                              {tieneOpciones && (
                                <span className="truncate text-[11px] font-medium text-muted-foreground">
                                  Opciones
                                </span>
                              )}
                            </span>
                          </span>

                          {enVuelo && (
                            <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-[1px]">
                              <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              <span className="sr-only">Añadiendo {plato.name}…</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilaDeCategoria({
  nombre,
  cuenta,
  activa,
  oculta,
  onClick,
}: {
  nombre: string;
  cuenta: number;
  activa: boolean;
  /** El dueño la sacó de la carta: se puede vender, pero el comensal no la ve. */
  oculta?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? "true" : undefined}
      className={`flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[13px] transition-colors ${
        activa ? "bg-muted font-bold" : "font-medium text-muted-foreground hover:bg-muted/50"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{nombre}</span>
      {oculta && (
        <EyeOff
          className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400"
          aria-label="Fuera de la carta del comensal"
        />
      )}
      <span className={`text-[11.5px] tabular-nums ${activa ? "" : "text-muted-foreground/60"}`}>
        {cuenta}
      </span>
    </button>
  );
}

export const ProductGrid = memo(ProductGridComponent);
