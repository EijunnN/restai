"use client";

import { ImageOff, UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Casilla, CasillaCabecera, Interruptor } from "./controls";
import { estadoCabecera, type Producto } from "./menu-filters";

/**
 * Una LISTA, no una rejilla de tarjetas.
 *
 * La rejilla anterior enseñaba fotos grandes y escondía las cuatro acciones
 * hasta pasar el ratón por encima —es decir, no existían en tablet ni en móvil—
 * y obligaba a desplazarse tres pantallas para ver doce platos. Quien administra
 * una carta compara precios y tiempos entre platos; para eso hacen falta
 * columnas alineadas, no tarjetas.
 */

/**
 * Las columnas se deciden por el ancho de ESTA tabla, no por el de la ventana.
 *
 * Con `sm:`/`md:` normales, una ventana de 1280 px cuenta como ancha aunque la
 * tabla viva en 450 px —entre la barra lateral del panel, la columna de
 * categorías y la ficha de la derecha— y las siete columnas se aplastaban unas
 * contra otras. `@container` mide el contenedor, que es lo que importa.
 */
const REJILLA =
  "grid items-center gap-3 px-3.5 " +
  "grid-cols-[20px_44px_minmax(0,1fr)_84px_46px] " +
  "@md:grid-cols-[20px_44px_minmax(0,1fr)_88px_84px_46px] " +
  "@2xl:grid-cols-[20px_44px_minmax(0,1fr)_88px_60px_84px_46px]";

function Miniatura({ producto }: { producto: Producto }) {
  if (!producto.imageUrl) {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-dashed border-border bg-muted/40">
        <ImageOff className="h-[15px] w-[15px] text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={producto.imageUrl}
      alt=""
      className="h-11 w-11 rounded-[10px] object-cover"
    />
  );
}

function EtiquetaCarencia({ texto }: { texto: string }) {
  return (
    <span className="flex h-[17px] shrink-0 items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground">
      {texto}
    </span>
  );
}

export function ProductsTable({
  productos,
  categorias,
  seleccion,
  productoActivoId,
  cambiandoDisponibilidad,
  puedeSeleccionar,
  puedeAlternar,
  onSeleccionar,
  onAlternarTodos,
  onAbrir,
  onAlternarDisponible,
}: {
  productos: Producto[];
  categorias: { id: string; name: string }[];
  seleccion: string[];
  productoActivoId: string | null;
  /** Ids con una petición de disponibilidad en vuelo. */
  cambiandoDisponibilidad: Set<string>;
  puedeSeleccionar: boolean;
  puedeAlternar: boolean;
  onSeleccionar: (id: string) => void;
  onAlternarTodos: () => void;
  onAbrir: (id: string) => void;
  onAlternarDisponible: (p: Producto) => void;
}) {
  const nombrePorCategoria = new Map(categorias.map((c) => [c.id, c.name]));
  const visibles = productos.map((p) => p.id);
  const estado = estadoCabecera(visibles, seleccion);

  return (
    <div className="@container flex min-h-0 flex-col overflow-hidden rounded-2xl bg-muted/25">
      <div
        className={`${REJILLA} h-9 shrink-0 border-b border-border/60 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground`}
      >
        {puedeSeleccionar ? (
          <CasillaCabecera
            estado={estado}
            onChange={onAlternarTodos}
            disabled={productos.length === 0}
          />
        ) : (
          <span />
        )}
        <span />
        <span>Producto</span>
        <span className="hidden @md:block">Categoría</span>
        <span className="hidden text-right @2xl:block">Prep</span>
        <span className="text-right">Precio</span>
        <span className="text-right">Disp.</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {productos.map((p) => {
          const marcado = seleccion.includes(p.id);
          const activo = productoActivoId === p.id && !marcado;

          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onAbrir(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAbrir(p.id);
                }
              }}
              className={`${REJILLA} h-14 cursor-pointer border-b border-border/40 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                marcado
                  ? "bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]"
                  : activo
                    ? "bg-muted/60 shadow-[inset_3px_0_0_var(--foreground)]"
                    : ""
              } ${p.isAvailable ? "" : "opacity-60"}`}
            >
              {puedeSeleccionar ? (
                <Casilla
                  marcada={marcado}
                  onChange={() => onSeleccionar(p.id)}
                  etiqueta={`Seleccionar ${p.name}`}
                />
              ) : (
                <span />
              )}

              <Miniatura producto={p} />

              <span className="flex min-w-0 flex-col gap-[3px]">
                <span className="flex min-w-0 items-center gap-[7px]">
                  <span
                    className={`truncate text-[13.5px] font-semibold ${
                      p.isAvailable
                        ? ""
                        : "line-through decoration-amber-500/60"
                    }`}
                  >
                    {p.name}
                  </span>
                  {p.modifierGroups > 0 && (
                    <span className="flex h-[17px] shrink-0 items-center rounded-md bg-violet-500/15 px-1.5 text-[10.5px] font-bold text-violet-500 dark:text-violet-300">
                      {p.modifierGroups} {p.modifierGroups === 1 ? "grupo" : "grupos"}
                    </span>
                  )}
                  {!p.imageUrl && <EtiquetaCarencia texto="Sin foto" />}
                </span>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {p.description || "Sin descripción"}
                </span>
              </span>

              <span className="hidden truncate text-xs text-muted-foreground @md:block">
                {nombrePorCategoria.get(p.categoryId) ?? "—"}
              </span>

              <span
                className={`hidden text-right text-[12.5px] tabular-nums @2xl:block ${
                  p.prepMin === null ? "text-amber-500" : "text-muted-foreground"
                }`}
              >
                {p.prepMin === null ? "—" : `${p.prepMin} min`}
              </span>

              <span className="text-right text-[13.5px] font-bold tabular-nums">
                {formatCurrency(p.price)}
              </span>

              <span className="flex justify-end">
                <Interruptor
                  activo={p.isAvailable}
                  disabled={!puedeAlternar || cambiandoDisponibilidad.has(p.id)}
                  etiqueta={
                    p.isAvailable
                      ? `Marcar «${p.name}» como agotado`
                      : `Devolver «${p.name}» a la carta`
                  }
                  onChange={() => onAlternarDisponible(p)}
                />
              </span>
            </div>
          );
        })}

        {productos.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <UtensilsCrossed className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Ningún producto cumple lo que has pedido
            </p>
            <p className="text-xs text-muted-foreground/70">
              Prueba a quitar el filtro o a buscar en otra categoría.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
