"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Check,
  Copy,
  Link2,
  Pencil,
  Trash2,
  Unlink,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  useCreateMenuItem,
  useItemModifierGroups,
  useLinkModifierGroup,
  useUnlinkModifierGroup,
  useUpdateMenuItem,
} from "@/hooks/use-menu";
import { Interruptor } from "./controls";
import { ImageUploadButton } from "./image-upload-button";
import { describirRegla, type Producto } from "./menu-filters";

/**
 * La ficha del producto, a la derecha y sin modal.
 *
 * El modal tapaba la lista, así que comparar el precio de este plato con el del
 * de al lado obligaba a cerrarlo, mirar y volver a abrirlo. Aquí la lista sigue
 * visible y el editor cambia con ella.
 *
 * IMPORTANTE: este componente siembra su estado UNA vez, en los inicializadores
 * de `useState`. Quien lo monte debe darle `key={producto.id}` para que React lo
 * remonte al cambiar de plato; sin esa clave, seleccionar otro producto dejaría
 * los campos del anterior.
 */

export function ProductInspector({
  producto,
  categorias,
  gruposDisponibles,
  puedeEditar,
  puedeBorrar,
  puedeCrear,
  puedeAlternar,
  alternandoDisponible,
  onCerrar,
  onAlternarDisponible,
  onPedirBorrado,
  onDuplicado,
}: {
  producto: Producto;
  categorias: { id: string; name: string }[];
  gruposDisponibles: any[];
  puedeEditar: boolean;
  puedeBorrar: boolean;
  puedeCrear: boolean;
  puedeAlternar: boolean;
  alternandoDisponible: boolean;
  onCerrar: () => void;
  onAlternarDisponible: () => void;
  onPedirBorrado: () => void;
  onDuplicado: (nuevoId: string) => void;
}) {
  const actualizar = useUpdateMenuItem();
  const crear = useCreateMenuItem();
  const vincular = useLinkModifierGroup();
  const desvincular = useUnlinkModifierGroup();
  const { data: gruposDelPlato, isLoading: cargandoGrupos } = useItemModifierGroups(
    producto.id,
  );

  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(producto.name);
  const [descripcion, setDescripcion] = useState(producto.description);
  const [precioSoles, setPrecioSoles] = useState((producto.price / 100).toFixed(2));
  const [categoryId, setCategoryId] = useState(producto.categoryId);
  const [prepMin, setPrepMin] = useState(
    producto.prepMin === null ? "" : String(producto.prepMin),
  );
  const [vinculando, setVinculando] = useState(false);
  const [claveSelect, setClaveSelect] = useState(0);

  const grupos: any[] = gruposDelPlato ?? [];
  const idsVinculados = grupos.map((g) => g.id);
  const sinVincular = gruposDisponibles.filter((g: any) => !idsVinculados.includes(g.id));
  const nombreCategoria =
    categorias.find((c) => c.id === producto.categoryId)?.name ?? "Sin categoría";

  const guardar = async () => {
    const centimos = Math.round(parseFloat(precioSoles) * 100);
    if (!nombre.trim()) {
      toast.error("El producto necesita un nombre");
      return;
    }
    if (!Number.isFinite(centimos) || centimos < 0) {
      toast.error("Ese precio no es un importe válido");
      return;
    }

    try {
      await actualizar.mutateAsync({
        id: producto.id,
        name: nombre.trim(),
        // `null` explícito, no `undefined`: vaciar la descripción tiene que
        // borrarla de verdad, y `undefined` se omite del envío.
        description: descripcion.trim() || null,
        price: centimos,
        categoryId,
        preparationTimeMin: prepMin === "" ? null : parseInt(prepMin, 10),
      });
      toast.success("Producto guardado");
      setEditando(false);
    } catch (err: any) {
      toast.error("No se pudo guardar", { description: err?.message });
    }
  };

  const duplicar = async () => {
    try {
      const creado = await crear.mutateAsync({
        name: `${producto.name} (copia)`,
        description: producto.description || undefined,
        price: producto.price,
        categoryId: producto.categoryId,
        imageUrl: producto.imageUrl || undefined,
        preparationTimeMin: producto.prepMin ?? undefined,
        allergens: producto.allergens,
        dietaryTags: producto.dietaryTags,
        spiceLevel: producto.spiceLevel ?? undefined,
      });
      // La copia nace AGOTADA a propósito: un duplicado con el nombre "(copia)"
      // y el precio del original no debe poder venderse por accidente antes de
      // que alguien lo revise.
      await actualizar.mutateAsync({ id: creado.id, isAvailable: false });
      toast.success("Copia creada", {
        description: "Nace agotada para que la revises antes de venderla.",
      });
      onDuplicado(creado.id);
    } catch (err: any) {
      toast.error("No se pudo duplicar", { description: err?.message });
    }
  };

  const cambiarFoto = async (url: string) => {
    try {
      await actualizar.mutateAsync({ id: producto.id, imageUrl: url });
      toast.success("Foto actualizada");
    } catch (err: any) {
      toast.error("No se pudo guardar la foto", { description: err?.message });
    }
  };

  const quitarFoto = async () => {
    try {
      await actualizar.mutateAsync({ id: producto.id, imageUrl: null });
      toast.success("Foto quitada");
    } catch (err: any) {
      toast.error("No se pudo quitar la foto", { description: err?.message });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-muted/35">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Foto
              El plato se ve ENTERO (`object-contain`): esta foto es lo que el
              comensal verá en la carta, así que recortarla aquí escondía
              justo lo que hay que revisar. Los botones van debajo, fuera de
              la imagen, porque flotando encima tapaban el plato. */}
          <div className="space-y-2">
            <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl bg-muted">
              {producto.imageUrl ? (
                <>
                  {/* Copia difuminada para rellenar los lados en vez de dejar
                      dos franjas muertas cuando la foto no es apaisada. */}
                  <img
                    src={producto.imageUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                  />
                  <img
                    src={producto.imageUrl}
                    alt=""
                    className="relative h-full w-full object-contain"
                  />
                </>
              ) : (
                <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>
            {puedeEditar && (
              <div className="flex items-center gap-3">
                <ImageUploadButton
                  currentUrl={producto.imageUrl}
                  onUploaded={cambiarFoto}
                  showPreview={false}
                />
                {producto.imageUrl && (
                  <button
                    type="button"
                    onClick={quitarFoto}
                    className="text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-destructive"
                  >
                    Quitar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Cabecera */}
          {editando ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="insp-nombre">Nombre</Label>
                <Input
                  id="insp-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="insp-desc">Descripción</Label>
                <textarea
                  id="insp-desc"
                  rows={2}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Lo que el comensal lee bajo el nombre"
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="insp-precio">Precio (S/)</Label>
                  <Input
                    id="insp-precio"
                    type="number"
                    step="0.01"
                    min="0"
                    value={precioSoles}
                    onChange={(e) => setPrecioSoles(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="insp-prep">Prep. (min)</Label>
                  <Input
                    id="insp-prep"
                    type="number"
                    min="0"
                    value={prepMin}
                    onChange={(e) => setPrepMin(e.target.value)}
                    placeholder="Sin definir"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={guardar} disabled={actualizar.isPending}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  {actualizar.isPending ? "Guardando…" : "Guardar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditando(false)}
                  disabled={actualizar.isPending}
                >
                  Descartar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3.5 flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[22px] font-extrabold leading-tight tracking-tight">
                    {producto.name}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                    {producto.description || "Sin descripción. El comensal solo verá el nombre."}
                  </p>
                </div>
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setEditando(true)}
                    aria-label="Editar producto"
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

              <div className="mt-3.5 grid grid-cols-3 gap-2">
                <Dato titulo="Precio" valor={formatCurrency(producto.price)} />
                <Dato
                  titulo="Prep"
                  valor={producto.prepMin === null ? "—" : `${producto.prepMin} min`}
                  alerta={producto.prepMin === null}
                />
                <Dato titulo="Categoría" valor={nombreCategoria} />
              </div>
            </>
          )}

          {/* Disponibilidad */}
          <div
            className={`mt-2.5 flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${
              producto.isAvailable ? "bg-emerald-500/10" : "bg-amber-500/10"
            }`}
          >
            <Interruptor
              activo={producto.isAvailable}
              disabled={!puedeAlternar || alternandoDisponible}
              etiqueta={
                producto.isAvailable
                  ? `Marcar «${producto.name}» como agotado`
                  : `Devolver «${producto.name}» a la carta`
              }
              onChange={onAlternarDisponible}
            />
            <span
              className={`flex-1 text-[12.5px] font-semibold ${
                producto.isAvailable
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {producto.isAvailable ? "En la carta" : "Agotado"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {producto.isAvailable ? "Se puede pedir" : "No se puede pedir"}
            </span>
          </div>
        </div>

        {/* Modificadores */}
        <div className="px-4 pb-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Modificadores
            </p>
            {puedeEditar && sinVincular.length > 0 && (
              <button
                type="button"
                onClick={() => setVinculando((v) => !v)}
                className="flex h-[26px] items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[11.5px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
              >
                <Link2 className="h-3 w-3" />
                Vincular
              </button>
            )}
          </div>

          {vinculando && (
            <div className="mb-2.5">
              <Select
                key={claveSelect}
                onValueChange={async (groupId) => {
                  try {
                    await vincular.mutateAsync({ itemId: producto.id, groupId });
                    toast.success("Grupo vinculado", {
                      description: "El cambio ya está guardado.",
                    });
                  } catch (err: any) {
                    toast.error("No se pudo vincular", { description: err?.message });
                  }
                  setClaveSelect((k) => k + 1);
                  setVinculando(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elige un grupo…" />
                </SelectTrigger>
                <SelectContent>
                  {sinVincular.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} · {g.modifiers?.length ?? 0} opciones
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Vincular y desvincular se guardan al instante, no con el botón de
                arriba.
              </p>
            </div>
          )}

          {cargandoGrupos ? (
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          ) : grupos.length === 0 ? (
            <p className="rounded-xl bg-muted/50 px-3 py-4 text-center text-[12px] text-muted-foreground">
              Sin modificadores. Este plato se pide tal cual.
            </p>
          ) : (
            <div className="flex flex-col gap-[7px]">
              {grupos.map((g: any) => (
                <div key={g.id} className="rounded-xl bg-muted/60 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {g.name}
                    </span>
                    <span className="flex h-[19px] items-center rounded-md bg-violet-500/15 px-1.5 text-[11px] font-bold text-violet-500 dark:text-violet-300">
                      {describirRegla(g)}
                    </span>
                    {puedeEditar && (
                      <button
                        type="button"
                        aria-label={`Desvincular ${g.name}`}
                        disabled={desvincular.isPending}
                        onClick={async () => {
                          try {
                            await desvincular.mutateAsync({
                              itemId: producto.id,
                              groupId: g.id,
                            });
                            toast.success("Grupo desvinculado");
                          } catch (err: any) {
                            toast.error("No se pudo desvincular", {
                              description: err?.message,
                            });
                          }
                        }}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                    {(g.modifiers ?? []).length === 0
                      ? "Este grupo se quedó sin opciones: el comensal no podrá completarlo."
                      : (g.modifiers ?? [])
                          .map((m: any) =>
                            m.price > 0 ? `${m.name} +${formatCurrency(m.price)}` : m.name,
                          )
                          .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pie */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-3">
        <span className="flex-1 text-[11.5px] text-muted-foreground">
          {actualizar.isPending ? "Guardando…" : "Los cambios se guardan al pulsar Guardar"}
        </span>
        {puedeCrear && (
          <Button size="sm" variant="ghost" onClick={duplicar} disabled={crear.isPending}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Duplicar
          </Button>
        )}
        {puedeBorrar && (
          <button
            type="button"
            onClick={onPedirBorrado}
            aria-label={`Eliminar ${producto.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Dato({
  titulo,
  valor,
  alerta,
}: {
  titulo: string;
  valor: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/70 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {titulo}
      </p>
      <p
        className={`mt-1 truncate text-base font-bold tabular-nums ${
          alerta ? "text-amber-500" : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
