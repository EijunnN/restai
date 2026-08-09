"use client";

import { EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useReordenArrastre } from "./use-reorden";
import type { Producto } from "./menu-filters";

/**
 * La columna de categorías.
 *
 * Sigue siendo columna y no pestañas porque son siete u ocho y con nombres
 * largos: en pestañas se cortarían o se saldrían. Debajo, un aviso con los
 * agotados, que es lo que hay que arreglar antes de abrir.
 */

/**
 * Las categorías en una fila, para cuando no cabe la columna.
 *
 * Sin esto, por debajo de 1024 px la columna se escondía y no quedaba NINGUNA
 * forma de filtrar por categoría: el filtro existía y era inalcanzable justo en
 * la tablet que se lleva a la mesa.
 */
export function CategoryChips({
  categorias,
  productos,
  seleccionada,
  onSeleccionar,
}: {
  categorias: any[];
  productos: Producto[];
  seleccionada: string;
  onSeleccionar: (id: string) => void;
}) {
  const conteo = new Map<string, number>();
  for (const p of productos) {
    conteo.set(p.categoryId, (conteo.get(p.categoryId) ?? 0) + 1);
  }

  const chip = (id: string, nombre: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => onSeleccionar(id)}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-semibold transition-colors ${
        seleccionada === id
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {nombre}
      <span className="text-[11px] font-bold tabular-nums opacity-60">{n}</span>
    </button>
  );

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
      {chip("all", "Todas", productos.length)}
      {categorias.map((c: any) => chip(c.id, c.name, conteo.get(c.id) ?? 0))}
    </div>
  );
}

export function CategoryRail({
  categorias,
  productos,
  seleccionada,
  onSeleccionar,
  puedeCrear,
  puedeEditar,
  puedeBorrar,
  onCrear,
  onEditar,
  onBorrar,
  onReordenar,
}: {
  categorias: any[];
  productos: Producto[];
  seleccionada: string;
  onSeleccionar: (id: string) => void;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeBorrar: boolean;
  onCrear: () => void;
  onEditar: (cat: any) => void;
  onBorrar: (cat: any) => void;
  /** Nuevo orden completo. Solo se llama si de verdad cambió algo. */
  onReordenar: (ids: string[]) => void;
}) {
  const conteo = new Map<string, number>();
  for (const p of productos) {
    conteo.set(p.categoryId, (conteo.get(p.categoryId) ?? 0) + 1);
  }
  const agotados = productos.filter((p) => !p.isAvailable).length;

  /*
    El orden de las categorías es el orden de la carta del comensal: lo primero
    que ve al abrirla. Se arrastra por la manija y no por la fila entera, porque
    la fila ya sirve para filtrar.
  */
  const reorden = useReordenArrastre({
    ids: categorias.map((c: any) => c.id),
    habilitado: puedeEditar,
    onSoltar: onReordenar,
  });

  const porId = new Map(categorias.map((c: any) => [c.id, c]));
  const enOrden = reorden.visibles
    .map((id) => porId.get(id))
    .filter((c): c is any => !!c);

  const fila = (activa: boolean) =>
    `flex h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded-[10px] pl-2 pr-2.5 text-[13px] transition-colors ${
      activa ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      <p className="mb-2 ml-2.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Categorías
      </p>

      <button
        type="button"
        onClick={() => onSeleccionar("all")}
        className={fila(seleccionada === "all")}
      >
        <span className="min-w-0 flex-1 truncate text-left">Todas</span>
        <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">
          {productos.length}
        </span>
      </button>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {enOrden.map((cat: any) => {
          const activa = seleccionada === cat.id;
          const n = conteo.get(cat.id) ?? 0;
          const oculta = cat.is_active === false;
          const arrastrando = reorden.arrastrandoId === cat.id;

          return (
            <div
              key={cat.id}
              ref={(el) => reorden.registrarFila(cat.id, el)}
              className={`group relative flex items-center ${arrastrando ? "opacity-70" : ""}`}
            >
              {/* La manija va FUERA del botón: un control dentro de otro no es
                  HTML válido y el teclado se pierde entre los dos. */}
              {puedeEditar && (
                <button
                  type="button"
                  {...reorden.manija(cat.id)}
                  aria-label={`Mover ${cat.name}`}
                  className="flex h-[34px] w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onSeleccionar(cat.id)}
                className={fila(activa)}
              >
                <span className="min-w-0 flex-1 truncate text-left">{cat.name}</span>
                {oculta && <EyeOff className="h-3 w-3 shrink-0 text-amber-500" />}
                <span
                  className={`text-[11.5px] font-bold tabular-nums ${
                    n === 0 ? "text-muted-foreground/50" : "text-muted-foreground"
                  }`}
                >
                  {n}
                </span>
              </button>

              {(puedeEditar || puedeBorrar) && (
                <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-background/95 px-1 py-0.5 shadow-sm group-hover:flex hover:flex">
                  {puedeEditar && (
                    <button
                      type="button"
                      aria-label={`Editar ${cat.name}`}
                      onClick={() => onEditar(cat)}
                      className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {puedeBorrar && (
                    <button
                      type="button"
                      aria-label={`Eliminar ${cat.name}`}
                      onClick={() => onBorrar(cat)}
                      className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {puedeCrear && (
        <button
          type="button"
          onClick={onCrear}
          className="mt-1 flex h-[34px] items-center gap-2 rounded-[10px] border border-dashed border-border px-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Nueva categoría
        </button>
      )}

      {agotados > 0 && (
        <div className="mt-3 rounded-xl bg-amber-500/10 p-3">
          <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
            {agotados} {agotados === 1 ? "producto agotado" : "productos agotados"}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            Se ocultan de la carta pero siguen aquí. Vuelven cuando los repongas: no
            hay nada que lo haga solo por la mañana.
          </p>
        </div>
      )}
    </div>
  );
}
