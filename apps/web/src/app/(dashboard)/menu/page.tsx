"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@restai/ui/components/sheet";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { useMediaQuery, CARTA_TRES_COLUMNAS } from "@/hooks/use-media-query";
import { useToggleMenuAvailability } from "@/hooks/use-kitchen";
import { useBranches } from "@/hooks/use-settings";
import {
  useCategories,
  useDeleteCategory,
  useDeleteMenuItem,
  useDeleteModifierGroup,
  useMenuItems,
  useModifierGroups,
} from "@/hooks/use-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CategoryDialog } from "./_components/category-dialog";
import { ProductDialog } from "./_components/product-dialog";
import { ModifierGroupDialog } from "./_components/modifier-group-dialog";
import { MenuToolbar } from "./_components/menu-toolbar";
import { FilterChips } from "./_components/filter-chips";
import { CategoryChips, CategoryRail } from "./_components/category-rail";
import { ProductsTable } from "./_components/products-table";
import { SortMenu } from "./_components/sort-menu";
import { ProductInspector } from "./_components/product-inspector";
import { BulkInspector } from "./_components/bulk-inspector";
import { ModifierGroupsList } from "./_components/modifier-groups-list";
import { ModifierGroupInspector } from "./_components/modifier-group-inspector";
import {
  FILTROS,
  alternarSeleccion,
  alternarTodosVisibles,
  contarFiltros,
  contarFiltrosGrupo,
  filtrarGrupos,
  filtrarProductos,
  normalizarProducto,
  ordenarProductos,
  type ClaveFiltro,
  type ClaveOrden,
  type ClaveFiltroGrupo,
  type GrupoConUso,
  type Producto,
} from "./_components/menu-filters";

const FILTROS_GRUPO = [
  { clave: "todos" as const, label: "Todos" },
  { clave: "obligatorios" as const, label: "Obligatorios" },
  { clave: "opcionales" as const, label: "Opcionales" },
  { clave: "sin-usar" as const, label: "Sin usar" },
];

export default function MenuPage() {
  const role = useAuthStore((s) => s.user?.role);
  const branchId = useAuthStore((s) => s.selectedBranchId);

  /**
   * Los permisos se comprueban AQUÍ y bajan a cada componente.
   *
   * Antes esta pantalla no comprobaba ninguno: el cajero y el mesero, que tienen
   * `menu:read` pero nada más, veían todos los botones de crear, editar, borrar
   * y subir foto, y cada uno moría en un 403. El servidor nunca dejó de gatear;
   * mentía la interfaz.
   */
  const puedeCrear = hasPermission(role, "menu:create");
  const puedeEditar = hasPermission(role, "menu:update");
  const puedeBorrar = hasPermission(role, "menu:delete");
  const puedeAlternar = hasPermission(role, "menu:availability");

  const anchoCompleto = useMediaQuery(CARTA_TRES_COLUMNAS);

  const categoriasQ = useCategories();
  const itemsQ = useMenuItems();
  const gruposQ = useModifierGroups();
  const { data: sedes } = useBranches();

  const borrarCategoria = useDeleteCategory();
  const borrarProducto = useDeleteMenuItem();
  const borrarGrupo = useDeleteModifierGroup();
  const { alternar, enCambio } = useToggleMenuAvailability();

  const [vista, setVista] = useState<"productos" | "modificadores">("productos");
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("all");
  const [filtro, setFiltro] = useState<ClaveFiltro>("todos");
  const [orden, setOrden] = useState<ClaveOrden>("carta");
  const [filtroGrupo, setFiltroGrupo] = useState<ClaveFiltroGrupo>("todos");
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [productoActivoId, setProductoActivoId] = useState<string | null>(null);
  const [grupoActivoId, setGrupoActivoId] = useState<string | null>(null);

  const [dialogoCategoria, setDialogoCategoria] = useState<{ abierto: boolean; cat: any }>({
    abierto: false,
    cat: null,
  });
  const [dialogoProducto, setDialogoProducto] = useState(false);
  const [dialogoGrupo, setDialogoGrupo] = useState(false);
  const [porBorrar, setPorBorrar] = useState<
    { tipo: "categoria" | "producto" | "grupo"; id: string; nombre: string } | null
  >(null);

  const categorias: any[] = categoriasQ.data ?? [];
  const grupos: GrupoConUso[] = gruposQ.data ?? [];

  const productos: Producto[] = useMemo(
    () => ((itemsQ.data ?? []) as any[]).map(normalizarProducto),
    [itemsQ.data],
  );

  const visibles = useMemo(
    () =>
      ordenarProductos(
        filtrarProductos({ items: productos, categoryId: categoria, search: busqueda, filtro }),
        orden,
      ),
    [productos, categoria, busqueda, filtro, orden],
  );

  const conteo = useMemo(() => contarFiltros(productos), [productos]);
  const gruposVisibles = useMemo(
    () => filtrarGrupos(grupos, busqueda, filtroGrupo),
    [grupos, busqueda, filtroGrupo],
  );
  const conteoGrupos = useMemo(() => contarFiltrosGrupo(grupos), [grupos]);

  const seleccionados = productos.filter((p) => seleccion.includes(p.id));
  const productoActivo = productos.find((p) => p.id === productoActivoId) ?? null;
  const grupoActivo = grupos.find((g) => g.id === grupoActivoId) ?? null;
  const nombreSede = sedes?.find((s: any) => s.id === branchId)?.name;

  const subtitulo = [
    nombreSede,
    `${productos.length} ${productos.length === 1 ? "producto" : "productos"}`,
    `${categorias.length} ${categorias.length === 1 ? "categoría" : "categorías"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const confirmarBorrado = async () => {
    if (!porBorrar) return;
    try {
      if (porBorrar.tipo === "categoria") {
        await borrarCategoria.mutateAsync(porBorrar.id);
        if (categoria === porBorrar.id) setCategoria("all");
        toast.success("Categoría eliminada");
      } else if (porBorrar.tipo === "producto") {
        await borrarProducto.mutateAsync(porBorrar.id);
        if (productoActivoId === porBorrar.id) setProductoActivoId(null);
        toast.success("Producto archivado", {
          description: "Sale de la carta. Los pedidos antiguos lo conservan.",
        });
      } else {
        await borrarGrupo.mutateAsync(porBorrar.id);
        if (grupoActivoId === porBorrar.id) setGrupoActivoId(null);
        toast.success("Grupo eliminado");
      }
    } catch (err: any) {
      // Un 409 aquí no es un fallo: es el servidor diciendo que ese elemento
      // está en uso. Se enseña su mensaje, que ya explica por qué.
      toast.error("No se pudo eliminar", { description: err?.message });
    }
    setPorBorrar(null);
  };

  const error = categoriasQ.error || itemsQ.error;
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-extrabold tracking-tight">Carta</h1>
        <div className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            No se pudo cargar la carta: {(error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              categoriasQ.refetch();
              itemsQ.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const cargando = categoriasQ.isLoading || itemsQ.isLoading;

  /** La ficha de la derecha: la selección múltiple manda sobre el plato suelto. */
  const inspector =
    vista === "productos" ? (
      seleccion.length > 0 ? (
        <BulkInspector
          seleccionados={seleccionados}
          categorias={categorias}
          grupos={grupos}
          puedeEditar={puedeEditar}
          puedeBorrar={puedeBorrar}
          onLimpiar={() => setSeleccion([])}
          categoriaActual={
            categoria === "all" ? null : categorias.find((c) => c.id === categoria) ?? null
          }
          onSeleccionarTodaLaCategoria={() =>
            setSeleccion(
              productos.filter((p) => p.categoryId === categoria).map((p) => p.id),
            )
          }
        />
      ) : productoActivo ? (
        <ProductInspector
          // Sin esta clave, elegir otro plato dejaría en los campos los datos
          // del anterior: el inspector siembra su estado una sola vez.
          key={productoActivo.id}
          producto={productoActivo}
          categorias={categorias}
          gruposDisponibles={grupos}
          puedeEditar={puedeEditar}
          puedeBorrar={puedeBorrar}
          puedeCrear={puedeCrear}
          puedeAlternar={puedeAlternar}
          alternandoDisponible={enCambio.has(productoActivo.id)}
          onCerrar={() => setProductoActivoId(null)}
          onAlternarDisponible={() =>
            alternar(productoActivo.id, productoActivo.name, !productoActivo.isAvailable)
          }
          onPedirBorrado={() =>
            setPorBorrar({
              tipo: "producto",
              id: productoActivo.id,
              nombre: productoActivo.name,
            })
          }
          onDuplicado={setProductoActivoId}
        />
      ) : (
        <Vacio texto="Elige un producto para ver y editar su ficha." />
      )
    ) : grupoActivo ? (
      <ModifierGroupInspector
        key={grupoActivo.id}
        grupo={grupoActivo}
        puedeEditar={puedeEditar}
        puedeBorrar={puedeBorrar}
        puedeCrear={puedeCrear}
        onCerrar={() => setGrupoActivoId(null)}
        onPedirBorrado={() =>
          setPorBorrar({ tipo: "grupo", id: grupoActivo.id, nombre: grupoActivo.name })
        }
        onDuplicado={setGrupoActivoId}
      />
    ) : (
      <Vacio texto="Elige un grupo para editarlo y ver dónde se usa." />
    );

  /** En pantalla estrecha la ficha es un panel; en ancha, la tercera columna. */
  const fichaAbierta =
    seleccion.length > 0 || (vista === "productos" ? !!productoActivo : !!grupoActivo);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-3 md:h-[calc(100vh-4rem)]">
      <MenuToolbar
        subtitulo={subtitulo}
        vista={vista}
        onVista={(v) => {
          setVista(v);
          setBusqueda("");
        }}
        totalProductos={productos.length}
        totalGrupos={grupos.length}
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        puedeCrear={puedeCrear}
        onCrear={() => (vista === "productos" ? setDialogoProducto(true) : setDialogoGrupo(true))}
      />

      {vista === "productos" ? (
        <FilterChips
          filtros={FILTROS}
          activo={filtro}
          conteo={conteo}
          onCambiar={setFiltro}
          extra={<SortMenu criterio={orden} onCambiar={setOrden} />}
        />
      ) : (
        <FilterChips
          filtros={FILTROS_GRUPO}
          activo={filtroGrupo}
          conteo={conteoGrupos}
          onCambiar={setFiltroGrupo}
          nota="Un cambio aquí llega a todos los platos vinculados"
        />
      )}

      {vista === "productos" && (
        <CategoryChips
          categorias={categorias}
          productos={productos}
          seleccionada={categoria}
          onSeleccionar={setCategoria}
        />
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {vista === "productos" && (
          <aside className="hidden w-48 shrink-0 lg:block">
            <CategoryRail
              categorias={categorias}
              productos={productos}
              seleccionada={categoria}
              onSeleccionar={setCategoria}
              puedeCrear={puedeCrear}
              puedeEditar={puedeEditar}
              puedeBorrar={puedeBorrar}
              onCrear={() => setDialogoCategoria({ abierto: true, cat: null })}
              onEditar={(cat) => setDialogoCategoria({ abierto: true, cat })}
              onBorrar={(cat) =>
                setPorBorrar({ tipo: "categoria", id: cat.id, nombre: cat.name })
              }
            />
          </aside>
        )}

        <main className="flex min-h-0 flex-1 flex-col">
          {cargando ? (
            <div className="flex-1 animate-pulse rounded-2xl bg-muted/40" />
          ) : vista === "productos" ? (
            <ProductsTable
              productos={visibles}
              categorias={categorias}
              seleccion={seleccion}
              productoActivoId={productoActivoId}
              cambiandoDisponibilidad={enCambio}
              puedeSeleccionar={puedeEditar || puedeBorrar}
              puedeAlternar={puedeAlternar}
              onSeleccionar={(id) => setSeleccion((s) => alternarSeleccion(s, id))}
              onAlternarTodos={() =>
                setSeleccion((s) => alternarTodosVisibles(visibles.map((p) => p.id), s))
              }
              onAbrir={setProductoActivoId}
              onAlternarDisponible={(p) => alternar(p.id, p.name, !p.isAvailable)}
            />
          ) : (
            <ModifierGroupsList
              grupos={gruposVisibles}
              grupoActivoId={grupoActivoId}
              onAbrir={setGrupoActivoId}
            />
          )}
        </main>

        {anchoCompleto && <aside className="w-[348px] shrink-0">{inspector}</aside>}
      </div>

      {/* En estrecho la ficha se monta SOLO cuando toca: un Sheet escondido con
          clases sigue montando su fondo y su captura de foco, y la pantalla se
          quedaba oscurecida sin que se viera nada. */}
      {!anchoCompleto && (
        <Sheet
          open={fichaAbierta}
          onOpenChange={(abierto) => {
            if (abierto) return;
            setSeleccion([]);
            setProductoActivoId(null);
            setGrupoActivoId(null);
          }}
        >
          <SheetContent side="right" className="w-full p-0 sm:max-w-md">
            <SheetTitle className="sr-only">Ficha</SheetTitle>
            <div className="h-full p-3">{inspector}</div>
          </SheetContent>
        </Sheet>
      )}

      {dialogoCategoria.abierto && (
        <CategoryDialog
          open
          onOpenChange={(v) => !v && setDialogoCategoria({ abierto: false, cat: null })}
          initial={dialogoCategoria.cat}
        />
      )}
      {dialogoProducto && (
        <ProductDialog
          open
          onOpenChange={setDialogoProducto}
          categories={categorias}
          allModifierGroups={grupos}
        />
      )}
      {dialogoGrupo && <ModifierGroupDialog open onOpenChange={setDialogoGrupo} />}
      {porBorrar && (
        <ConfirmDialog
          open
          onOpenChange={(v) => !v && setPorBorrar(null)}
          title={
            porBorrar.tipo === "categoria"
              ? "Eliminar categoría"
              : porBorrar.tipo === "producto"
                ? "Archivar producto"
                : "Eliminar grupo"
          }
          description={
            porBorrar.tipo === "producto"
              ? `«${porBorrar.nombre}» sale de la carta. Los pedidos que ya lo incluían siguen enteros, y puedes devolverlo.`
              : porBorrar.tipo === "categoria"
                ? `Eliminar «${porBorrar.nombre}». Si tiene productos dentro, el servidor lo impedirá.`
                : `Eliminar «${porBorrar.nombre}» y sus opciones. Los platos vinculados dejarán de ofrecerlo.`
          }
          onConfirm={confirmarBorrado}
          loading={
            borrarCategoria.isPending || borrarProducto.isPending || borrarGrupo.isPending
          }
        />
      )}
    </div>
  );
}

function Vacio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl bg-muted/25 p-6 text-center">
      <p className="max-w-[15rem] text-[12.5px] text-muted-foreground">{texto}</p>
    </div>
  );
}
