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
import { ChevronLeft, ChevronRight, EyeOff, Layers, Link2, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  useBulkDeleteMenuItems,
  useBulkLinkModifierGroup,
  useBulkUpdateMenuItems,
} from "@/hooks/use-menu";
import { describirSeleccion, type Producto } from "./menu-filters";

/**
 * Lo que se puede hacer con varios platos a la vez.
 *
 * Existe porque la operación real no es "editar un plato": es "se acabó la
 * merluza y la llevan tres". Antes eso eran tres ediciones seguidas, sin
 * garantía de que las tres se aplicaran y sin manera de volver atrás.
 *
 * Cada acción confirma ANTES de tocar nada cuando el cambio es difícil de
 * revertir (precio, borrado) y ofrece "Deshacer" DESPUÉS cuando la vuelta atrás
 * es exacta. Nunca las dos cosas a medias.
 */

type Accion = "agotar" | "categoria" | "precio" | "vincular" | "eliminar";

export function BulkInspector({
  seleccionados,
  categorias,
  grupos,
  puedeEditar,
  puedeBorrar,
  onLimpiar,
  onSeleccionarTodaLaCategoria,
  categoriaActual,
}: {
  seleccionados: Producto[];
  categorias: { id: string; name: string }[];
  grupos: any[];
  puedeEditar: boolean;
  puedeBorrar: boolean;
  onLimpiar: () => void;
  onSeleccionarTodaLaCategoria: () => void;
  categoriaActual: { id: string; name: string } | null;
}) {
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const bulk = useBulkUpdateMenuItems();
  const vincularLote = useBulkLinkModifierGroup();
  const borrarLote = useBulkDeleteMenuItems();

  const ids = seleccionados.map((p) => p.id);
  const nombres = seleccionados.map((p) => p.name);
  const trabajando = bulk.isPending || vincularLote.isPending || borrarLote.isPending;

  // --- Agotar / reponer ------------------------------------------------------

  const disponibles = seleccionados.filter((p) => p.isAvailable).length;
  const agotados = seleccionados.length - disponibles;

  const cambiarDisponibilidad = async (destino: boolean) => {
    // Se guarda el estado previo POR PLATO: la selección puede mezclar platos
    // disponibles y agotados, y deshacer con un solo valor los dejaría a todos
    // igual, que no es como estaban.
    const previos = new Map(seleccionados.map((p) => [p.id, p.isAvailable]));

    try {
      const res = await bulk.mutateAsync({ ids, patch: { isAvailable: destino } });
      toast.success(
        destino
          ? `${res.updated} ${res.updated === 1 ? "plato vuelve" : "platos vuelven"} a la carta`
          : `${res.updated} ${res.updated === 1 ? "plato marcado" : "platos marcados"} como agotado`,
        {
          description: destino
            ? "Los comensales ya pueden pedirlos."
            : "Los comensales y el POS dejan de verlos.",
          action: {
            label: "Deshacer",
            onClick: () => restaurarDisponibilidad(previos),
          },
        },
      );
    } catch (err: any) {
      toast.error("No se pudo aplicar el cambio", {
        description: err?.message ?? "No se ha modificado ningún plato.",
      });
    }
  };

  const restaurarDisponibilidad = async (previos: Map<string, boolean>) => {
    const porEstado = new Map<boolean, string[]>();
    for (const [id, estaba] of previos) {
      porEstado.set(estaba, [...(porEstado.get(estaba) ?? []), id]);
    }
    try {
      for (const [estado, grupo] of porEstado) {
        await bulk.mutateAsync({ ids: grupo, patch: { isAvailable: estado } });
      }
      toast.success("Deshecho");
    } catch (err: any) {
      toast.error("No se pudo deshacer del todo", { description: err?.message });
    }
  };

  // --- Categoría -------------------------------------------------------------

  const [categoriaDestino, setCategoriaDestino] = useState("");

  const mover = async () => {
    const previos = new Map(seleccionados.map((p) => [p.id, p.categoryId]));
    try {
      const res = await bulk.mutateAsync({
        ids,
        patch: { categoryId: categoriaDestino },
      });
      const destino = categorias.find((c) => c.id === categoriaDestino)?.name ?? "";
      toast.success(`${res.updated} en «${destino}»`, {
        action: {
          label: "Deshacer",
          onClick: async () => {
            const porCategoria = new Map<string, string[]>();
            for (const [id, cat] of previos) {
              porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), id]);
            }
            for (const [cat, grupo] of porCategoria) {
              await bulk.mutateAsync({ ids: grupo, patch: { categoryId: cat } });
            }
            toast.success("Deshecho");
          },
        },
      });
      setAbierta(null);
    } catch (err: any) {
      toast.error("No se pudo mover", { description: err?.message });
    }
  };

  // --- Precio ----------------------------------------------------------------

  const [modoPrecio, setModoPrecio] = useState<"percent" | "delta" | "set">("percent");
  const [valorPrecio, setValorPrecio] = useState("");

  const valorNumerico = parseFloat(valorPrecio);
  const valorEntero = Number.isFinite(valorNumerico)
    ? modoPrecio === "percent"
      ? Math.round(valorNumerico * 100) // puntos básicos
      : Math.round(valorNumerico * 100) // céntimos
    : null;

  /** Lo que va a costar cada plato si se aplica. Se calcula igual que el servidor. */
  const previsualizar = (p: Producto): number => {
    if (valorEntero === null) return p.price;
    if (modoPrecio === "percent") {
      return Math.max(0, Math.round((p.price * (10000 + valorEntero)) / 10000));
    }
    if (modoPrecio === "delta") return Math.max(0, p.price + valorEntero);
    return Math.max(0, valorEntero);
  };

  const aplicarPrecio = async () => {
    if (valorEntero === null) {
      toast.error("Escribe un número");
      return;
    }
    const previos = new Map(seleccionados.map((p) => [p.id, p.price]));
    try {
      const res = await bulk.mutateAsync({
        ids,
        patch: { price: { mode: modoPrecio, value: valorEntero } },
      });
      toast.success(`Precio actualizado en ${res.updated}`, {
        description: "Queda traza de cada importe anterior en la auditoría.",
        action: {
          label: "Deshacer",
          onClick: async () => {
            const porPrecio = new Map<number, string[]>();
            for (const [id, precio] of previos) {
              porPrecio.set(precio, [...(porPrecio.get(precio) ?? []), id]);
            }
            for (const [precio, grupo] of porPrecio) {
              await bulk.mutateAsync({
                ids: grupo,
                patch: { price: { mode: "set", value: precio } },
              });
            }
            toast.success("Precios restaurados");
          },
        },
      });
      setAbierta(null);
      setValorPrecio("");
    } catch (err: any) {
      toast.error("No se pudo cambiar el precio", { description: err?.message });
    }
  };

  // --- Vincular grupo --------------------------------------------------------

  const [grupoDestino, setGrupoDestino] = useState("");

  const vincular = async () => {
    try {
      const res = await vincularLote.mutateAsync({ ids, groupId: grupoDestino });
      if (res.linked.length === 0) {
        toast.info(`Todos ya tenían «${res.groupName}»`);
      } else {
        toast.success(
          `«${res.groupName}» añadido a ${res.linked.length} ${
            res.linked.length === 1 ? "plato" : "platos"
          }`,
          {
            description:
              res.alreadyLinked > 0
                ? `${res.alreadyLinked} ya lo tenían y no se han tocado.`
                : undefined,
          },
        );
      }
      setAbierta(null);
    } catch (err: any) {
      toast.error("No se pudo vincular", { description: err?.message });
    }
  };

  // --- Eliminar --------------------------------------------------------------

  const [confirmacion, setConfirmacion] = useState("");
  const PALABRA = "ELIMINAR";

  const eliminar = async () => {
    try {
      const res = await borrarLote.mutateAsync({ ids });
      toast.success(`${res.changed} ${res.changed === 1 ? "producto archivado" : "productos archivados"}`, {
        description: "Salen de la carta. Los pedidos antiguos los conservan.",
        action: {
          label: "Deshacer",
          onClick: async () => {
            await borrarLote.mutateAsync({ ids, restore: true });
            toast.success("Devueltos a la carta");
          },
        },
      });
      setAbierta(null);
      setConfirmacion("");
      onLimpiar();
    } catch (err: any) {
      toast.error("No se pudo eliminar", { description: err?.message });
    }
  };

  // ---------------------------------------------------------------------------

  const acciones: {
    clave: Accion;
    icono: typeof EyeOff;
    label: string;
    pista: string;
    tono: string;
    permitida: boolean;
  }[] = [
    {
      clave: "agotar",
      icono: EyeOff,
      label: agotados === seleccionados.length ? "Devolver a la carta" : "Marcar agotados",
      pista:
        agotados === seleccionados.length
          ? "Vuelven a poder pedirse"
          : disponibles === seleccionados.length
            ? "Salen de la carta hasta que los repongas"
            : `${disponibles} disponibles y ${agotados} agotados ahora mismo`,
      tono: "text-amber-500",
      permitida: puedeEditar,
    },
    {
      clave: "categoria",
      icono: Layers,
      label: "Mover de categoría",
      pista: "Cambia dónde aparecen en la carta",
      tono: "text-blue-500",
      permitida: puedeEditar,
    },
    {
      clave: "precio",
      icono: Zap,
      label: "Ajustar precio",
      pista: "Porcentaje, importe fijo o precio igual para todos",
      tono: "text-violet-500",
      permitida: puedeEditar,
    },
    {
      clave: "vincular",
      icono: Link2,
      label: "Vincular un grupo",
      pista: "Añade el mismo modificador a todos",
      tono: "text-violet-500",
      permitida: puedeEditar && grupos.length > 0,
    },
    {
      clave: "eliminar",
      icono: Trash2,
      label: "Eliminar",
      pista: "Pide confirmación escrita",
      tono: "text-destructive",
      permitida: puedeBorrar,
    },
  ];

  const visibles = acciones.filter((a) => a.permitida);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-primary/5">
      <div className="shrink-0 px-4 pt-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-primary">
          Selección
        </p>
        <h3 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight">
          {seleccionados.length} {seleccionados.length === 1 ? "producto" : "productos"}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted-foreground">
          {describirSeleccion(nombres)}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {categoriaActual && (
            <button
              type="button"
              onClick={onSeleccionarTodaLaCategoria}
              className="h-7 rounded-[9px] bg-muted px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-muted/70"
            >
              Seleccionar todo «{categoriaActual.name}»
            </button>
          )}
          <button
            type="button"
            onClick={onLimpiar}
            className="h-7 rounded-[9px] px-2.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Limpiar
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {abierta === null ? (
          <div className="flex flex-col gap-[7px]">
            {visibles.map((a) => (
              <button
                key={a.clave}
                type="button"
                disabled={trabajando}
                onClick={() => {
                  // Agotar es reversible con un clic y no necesita formulario:
                  // se aplica directamente y el aviso ofrece el deshacer.
                  if (a.clave === "agotar") {
                    cambiarDisponibilidad(agotados === seleccionados.length);
                    return;
                  }
                  setAbierta(a.clave);
                }}
                className="flex items-center gap-3 rounded-xl bg-muted/70 px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span
                  className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-background/70 ${a.tono}`}
                >
                  <a.icono className="h-[15px] w-[15px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{a.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {a.pista}
                  </span>
                </span>
                {a.clave !== "agotar" && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}

            {visibles.length === 0 && (
              <p className="rounded-xl bg-muted/60 px-3 py-4 text-center text-[12px] text-muted-foreground">
                Tu rol puede consultar la carta, pero no modificarla.
              </p>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setAbierta(null)}
              className="mb-3 flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Volver
            </button>

            {abierta === "categoria" && (
              <div className="space-y-3">
                <Label>Nueva categoría</Label>
                <Select value={categoriaDestino} onValueChange={setCategoriaDestino}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elige categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!categoriaDestino || trabajando}
                  onClick={mover}
                >
                  Mover {seleccionados.length}
                </Button>
              </div>
            )}

            {abierta === "precio" && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["percent", "Porcentaje"],
                      ["delta", "Sumar S/"],
                      ["set", "Precio fijo"],
                    ] as const
                  ).map(([modo, texto]) => (
                    <button
                      key={modo}
                      type="button"
                      onClick={() => setModoPrecio(modo)}
                      className={`h-8 rounded-lg text-[11.5px] font-semibold transition-colors ${
                        modoPrecio === modo
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-precio">
                    {modoPrecio === "percent"
                      ? "Porcentaje (usa negativo para bajar)"
                      : modoPrecio === "delta"
                        ? "Importe a sumar (negativo para restar)"
                        : "Precio para todos"}
                  </Label>
                  <Input
                    id="bulk-precio"
                    type="number"
                    step={modoPrecio === "percent" ? "0.5" : "0.10"}
                    value={valorPrecio}
                    onChange={(e) => setValorPrecio(e.target.value)}
                    placeholder={modoPrecio === "percent" ? "10" : "5.00"}
                  />
                </div>

                {/* La vista previa es la salvaguarda: con dinero, ver el
                    resultado antes vale más que poder deshacerlo después. */}
                {valorEntero !== null && (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-muted/60 p-2.5">
                    {seleccionados.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-[11.5px]">
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="tabular-nums text-muted-foreground line-through">
                          {formatCurrency(p.price)}
                        </span>
                        <span className="tabular-nums font-bold">
                          {formatCurrency(previsualizar(p))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  size="sm"
                  className="w-full"
                  disabled={valorEntero === null || trabajando}
                  onClick={aplicarPrecio}
                >
                  Aplicar a {seleccionados.length}
                </Button>
              </div>
            )}

            {abierta === "vincular" && (
              <div className="space-y-3">
                <Label>Grupo de modificadores</Label>
                <Select value={grupoDestino} onValueChange={setGrupoDestino}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} · {g.modifiers?.length ?? 0} opciones
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Los que ya lo tengan se quedan igual: no se duplica.
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!grupoDestino || trabajando}
                  onClick={vincular}
                >
                  Vincular a {seleccionados.length}
                </Button>
              </div>
            )}

            {abierta === "eliminar" && (
              <div className="space-y-3">
                <p className="text-[12.5px] leading-snug text-muted-foreground">
                  Vas a archivar <strong className="text-foreground">{seleccionados.length}</strong>{" "}
                  {seleccionados.length === 1 ? "producto" : "productos"}. Salen de la
                  carta, pero los pedidos que ya los incluían siguen enteros.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-confirm">
                    Escribe <span className="font-mono font-bold">{PALABRA}</span> para
                    confirmar
                  </Label>
                  <Input
                    id="bulk-confirm"
                    value={confirmacion}
                    onChange={(e) => setConfirmacion(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={confirmacion !== PALABRA || trabajando}
                  onClick={eliminar}
                >
                  Archivar {seleccionados.length}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
