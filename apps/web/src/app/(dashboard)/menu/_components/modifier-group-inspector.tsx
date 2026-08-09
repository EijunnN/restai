"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  useAddModifier,
  useCreateModifierGroup,
  useDeleteModifier,
  useModifierGroupItems,
  useUpdateModifier,
  useUpdateModifierGroup,
} from "@/hooks/use-menu";
import { Interruptor } from "./controls";
import { describirRegla, type GrupoConUso } from "./menu-filters";

/**
 * La ficha del grupo.
 *
 * Dos cosas que antes no se podían hacer y ahora sí:
 *
 * 1. **Renombrar y reprecar una opción existente.** El diálogo anterior solo
 *    dejaba borrarla y volver a crearla, pese a que `PATCH /modifiers/:id`
 *    llevaba ahí desde el principio. Borrar y recrear pierde el vínculo con los
 *    pedidos que la mencionan.
 * 2. **Ver en qué platos se usa.** Sin esto, borrar un grupo era a ciegas: el
 *    diálogo prometía que "los productos vinculados perderán este grupo" sin
 *    poder nombrar ni uno.
 *
 * Siembra su estado una sola vez: quien lo monte debe pasarle `key={grupo.id}`.
 */

export function ModifierGroupInspector({
  grupo,
  puedeEditar,
  puedeBorrar,
  puedeCrear,
  onCerrar,
  onPedirBorrado,
  onDuplicado,
}: {
  grupo: GrupoConUso;
  puedeEditar: boolean;
  puedeBorrar: boolean;
  puedeCrear: boolean;
  onCerrar: () => void;
  onPedirBorrado: () => void;
  onDuplicado: (nuevoId: string) => void;
}) {
  const actualizarGrupo = useUpdateModifierGroup();
  const crearGrupo = useCreateModifierGroup();
  const anadirOpcion = useAddModifier();
  const actualizarOpcion = useUpdateModifier();
  const borrarOpcion = useDeleteModifier();
  const { data: platos, isLoading: cargandoPlatos } = useModifierGroupItems(grupo.id);

  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(grupo.name);
  const [min, setMin] = useState(String(grupo.min_selections ?? 0));
  const [max, setMax] = useState(String(grupo.max_selections ?? 1));
  const [obligatorio, setObligatorio] = useState(!!grupo.is_required);

  const [anadiendo, setAnadiendo] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [editandoOpcion, setEditandoOpcion] = useState<string | null>(null);
  const [opcionNombre, setOpcionNombre] = useState("");
  const [opcionPrecio, setOpcionPrecio] = useState("");

  const opciones: any[] = grupo.modifiers ?? [];
  // El endpoint devuelve `{group, items}`, no una lista pelada: leer `platos`
  // directamente daba un objeto de dos claves que se contaba como dos platos.
  const usos: any[] = platos?.items ?? [];

  const guardarGrupo = async () => {
    const minNum = parseInt(min, 10);
    const maxNum = parseInt(max, 10);
    if (!nombre.trim()) {
      toast.error("El grupo necesita un nombre");
      return;
    }
    if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || maxNum < 1) {
      toast.error("El máximo tiene que ser al menos 1");
      return;
    }
    if (minNum > maxNum) {
      toast.error("El mínimo no puede superar al máximo", {
        description: "Sería un grupo imposible de completar.",
      });
      return;
    }
    try {
      await actualizarGrupo.mutateAsync({
        id: grupo.id,
        name: nombre.trim(),
        minSelections: minNum,
        maxSelections: maxNum,
        isRequired: obligatorio,
      });
      toast.success("Grupo guardado", {
        description:
          (grupo.used_in_items ?? 0) > 0
            ? `El cambio llega a los ${grupo.used_in_items} platos que lo usan.`
            : undefined,
      });
      setEditando(false);
    } catch (err: any) {
      toast.error("No se pudo guardar", { description: err?.message });
    }
  };

  const duplicar = async () => {
    try {
      const nuevo = await crearGrupo.mutateAsync({
        name: `${grupo.name} (copia)`,
        minSelections: grupo.min_selections ?? 0,
        maxSelections: grupo.max_selections ?? 1,
        isRequired: !!grupo.is_required,
      });
      // Las opciones se copian una a una: no hay alta en lote de modificadores,
      // y crear el grupo vacío dejaría una copia inservible.
      for (const o of opciones) {
        await anadirOpcion.mutateAsync({
          groupId: nuevo.id,
          name: o.name,
          price: o.price,
          isAvailable: o.is_available ?? true,
        });
      }
      toast.success("Copia creada", {
        description: "Sin vincular a ningún plato todavía.",
      });
      onDuplicado(nuevo.id);
    } catch (err: any) {
      toast.error("No se pudo duplicar", { description: err?.message });
    }
  };

  const crearOpcion = async () => {
    const centimos = nuevoPrecio ? Math.round(parseFloat(nuevoPrecio) * 100) : 0;
    if (!nuevoNombre.trim()) return;
    if (!Number.isFinite(centimos) || centimos < 0) {
      toast.error("Ese recargo no es un importe válido");
      return;
    }
    try {
      await anadirOpcion.mutateAsync({
        groupId: grupo.id,
        name: nuevoNombre.trim(),
        price: centimos,
      });
      setNuevoNombre("");
      setNuevoPrecio("");
      setAnadiendo(false);
    } catch (err: any) {
      toast.error("No se pudo añadir", { description: err?.message });
    }
  };

  const guardarOpcion = async (id: string) => {
    const centimos = opcionPrecio ? Math.round(parseFloat(opcionPrecio) * 100) : 0;
    if (!opcionNombre.trim()) return;
    if (!Number.isFinite(centimos) || centimos < 0) {
      toast.error("Ese recargo no es un importe válido");
      return;
    }
    try {
      await actualizarOpcion.mutateAsync({
        id,
        name: opcionNombre.trim(),
        price: centimos,
      });
      setEditandoOpcion(null);
    } catch (err: any) {
      toast.error("No se pudo guardar la opción", { description: err?.message });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-muted/35">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Grupo
            </p>
            {editando ? (
              <Input
                className="mt-2"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            ) : (
              <h3 className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight">
                {grupo.name}
              </h3>
            )}
          </div>
          {puedeEditar && !editando && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label="Editar grupo"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar ficha"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:text-foreground xl:hidden"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {editando ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="grp-min">Mínimo</Label>
                <Input
                  id="grp-min"
                  type="number"
                  min="0"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grp-max">Máximo</Label>
                <Input
                  id="grp-max"
                  type="number"
                  min="1"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-muted/70 px-3 py-2.5">
              <Interruptor
                activo={obligatorio}
                onChange={setObligatorio}
                etiqueta="El comensal está obligado a elegir"
              />
              <span className="flex-1 text-[12.5px] font-semibold">Obligatorio</span>
            </div>
            <div className="rounded-xl bg-violet-500/10 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-violet-500 dark:text-violet-300">
                Resulta en
              </p>
              <p className="mt-1 text-[13px] font-bold text-violet-600 dark:text-violet-300">
                {describirRegla({
                  ...grupo,
                  min_selections: parseInt(min, 10) || 0,
                  max_selections: parseInt(max, 10) || 1,
                  is_required: obligatorio,
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={guardarGrupo} disabled={actualizarGrupo.isPending}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                Descartar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Dato titulo="Mínimo" valor={String(grupo.min_selections ?? 0)} />
            <Dato titulo="Máximo" valor={String(grupo.max_selections ?? 1)} />
            <div className="flex-[1.4] rounded-xl bg-violet-500/10 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-violet-500 dark:text-violet-300">
                Resulta en
              </p>
              <p className="mt-1 text-[13px] font-bold text-violet-600 dark:text-violet-300">
                {describirRegla(grupo)}
              </p>
            </div>
          </div>
        )}

        {/* Opciones */}
        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Opciones
            </p>
            {puedeEditar && (
              <button
                type="button"
                onClick={() => setAnadiendo((v) => !v)}
                className="flex h-[26px] items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-muted/70"
              >
                <Plus className="h-3 w-3" />
                Añadir
              </button>
            )}
          </div>

          {anadiendo && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/60 p-2">
              <Input
                className="h-8 flex-1"
                placeholder="Nombre"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crearOpcion()}
              />
              <Input
                className="h-8 w-20"
                type="number"
                step="0.10"
                min="0"
                placeholder="0.00"
                value={nuevoPrecio}
                onChange={(e) => setNuevoPrecio(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crearOpcion()}
              />
              <Button size="sm" onClick={crearOpcion} disabled={anadirOpcion.isPending}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {opciones.length === 0 && !anadiendo && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-3 text-center text-[12px] text-amber-600 dark:text-amber-400">
                Sin opciones. Un grupo vacío bloquea el pedido si es obligatorio.
              </p>
            )}

            {opciones.map((o: any) =>
              editandoOpcion === o.id ? (
                <div key={o.id} className="flex items-center gap-2 rounded-xl bg-muted/60 p-2">
                  <Input
                    className="h-8 flex-1"
                    value={opcionNombre}
                    onChange={(e) => setOpcionNombre(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && guardarOpcion(o.id)}
                  />
                  <Input
                    className="h-8 w-20"
                    type="number"
                    step="0.10"
                    min="0"
                    value={opcionPrecio}
                    onChange={(e) => setOpcionPrecio(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && guardarOpcion(o.id)}
                  />
                  <Button size="sm" onClick={() => guardarOpcion(o.id)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditandoOpcion(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div
                  key={o.id}
                  className="flex h-[42px] items-center gap-2.5 rounded-xl bg-muted/60 px-3"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{o.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {o.price > 0 ? `+${formatCurrency(o.price)}` : "Incluido"}
                  </span>
                  {puedeEditar && (
                    <>
                      <Interruptor
                        tamano="sm"
                        activo={o.is_available ?? true}
                        disabled={actualizarOpcion.isPending}
                        etiqueta={`Disponibilidad de ${o.name}`}
                        onChange={(siguiente) =>
                          actualizarOpcion.mutate({ id: o.id, isAvailable: siguiente })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Editar ${o.name}`}
                        onClick={() => {
                          setEditandoOpcion(o.id);
                          setOpcionNombre(o.name);
                          setOpcionPrecio((o.price / 100).toFixed(2));
                        }}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar ${o.name}`}
                        onClick={() => borrarOpcion.mutate(o.id)}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
          </div>

          {/* Dónde se usa */}
          <div className="mt-4 rounded-xl bg-muted/60 p-3">
            <p className="text-xs font-bold">
              {cargandoPlatos
                ? "Buscando dónde se usa…"
                : usos.length === 0
                  ? "No lo usa ningún producto"
                  : `Usado en ${usos.length} ${usos.length === 1 ? "producto" : "productos"}`}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {cargandoPlatos
                ? "…"
                : usos.length === 0
                  ? "Vincúlalo desde la ficha de un plato o con la selección múltiple."
                  : usos.map((p: any) => p.name).join(", ")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-3">
        <span className="flex-1 text-[11.5px] text-muted-foreground">
          Un cambio aquí llega a todos los platos vinculados
        </span>
        {puedeCrear && (
          <button
            type="button"
            onClick={duplicar}
            aria-label="Duplicar grupo"
            disabled={crearGrupo.isPending}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {puedeBorrar && (
          <button
            type="button"
            onClick={onPedirBorrado}
            aria-label={`Eliminar ${grupo.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="flex-1 rounded-xl bg-muted/70 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {titulo}
      </p>
      <p className="mt-1 text-base font-bold tabular-nums">{valor}</p>
    </div>
  );
}
