"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  CheckCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Printer,
  Ban,
  RotateCcw,
  Phone,
  MapPin,
  Bike,
  Package,
  Grid3X3,
  CircleAlert,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import {
  registrarAnulacionLocal,
  useCancelKitchenItem,
  useKitchenMenuAvailability,
  useToggleMenuAvailability,
  useUpdateKitchenItemStatus,
} from "@/hooks/use-kitchen";
import { KITCHEN_BACK_TRANSITIONS } from "@restai/config";
import { useKitchenContext, type KitchenCardView } from "./kitchen-context";

/** Nombre del paso al que devuelve el botón "volver". */
const ESTADO_ANTERIOR_LABEL: Record<string, string> = {
  pending: "En cola",
  preparing: "Preparando",
  ready: "Listo",
};

const VISIBLE_ITEMS_LIMIT = 4;

/**
 * Motivos de un "86". Cubren el 95% de los casos reales del servicio y evitan
 * que el cocinero tenga que escribir con guantes; el texto libre queda para el
 * resto. El motivo es obligatorio: sin él, al día siguiente nadie sabe qué se
 * acabó ni por qué.
 */
const MOTIVOS_RAPIDOS = ["Se acabó", "Producto en mal estado", "Error de comanda"] as const;

const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;

/** Milisegundos que el botón "Listo" queda armado esperando el segundo toque. */
const CONFIRMACION_MS = 3500;

// ---------------------------------------------------------------------------
// Traducción de los errores del backend a algo accionable
// ---------------------------------------------------------------------------

/** Estados de línea en castellano, para no enseñar el valor crudo del enum. */
const ESTADOS_ITEM: Record<string, string> = {
  pending: "en cola",
  preparing: "en preparación",
  ready: "listo",
  served: "servido",
  cancelled: "anulado",
};

/**
 * Cualquier respuesta que no sea 2xx significa que el backend NO tocó nada
 * (así lo garantiza la ruta: todas las validaciones van antes de escribir), de
 * modo que siempre se puede decir con seguridad "el pedido no se modificó".
 *
 * El orden de las comprobaciones importa: los mensajes del servidor comparten
 * palabras ("cobro" aparece tanto en "el ítem ya fue cobrado" como en "la orden
 * ya está cerrada: anula el cobro"), así que se va de lo más específico a lo más
 * general o se acaba dando la instrucción equivocada.
 */
function mensajeDeAnulacion(err: any): { title: string; description: string } {
  const status = err?.status;
  const mensaje: string = err?.message || "";

  if (status === 409 && /comprobante/i.test(mensaje)) {
    return {
      title: "El pedido ya tiene comprobante emitido",
      description: `${mensaje} El pedido no se modificó: corrígelo con una nota de crédito desde Comprobantes.`,
    };
  }
  if (status === 409 && /ya está anulada/i.test(mensaje)) {
    return {
      title: "El pedido ya estaba anulado",
      description:
        "Otro puesto anuló el pedido entero. Actualizamos la pantalla para que veas el estado real.",
    };
  }
  if (status === 409 && /cerrada/i.test(mensaje)) {
    return {
      title: "El pedido ya está cerrado",
      description:
        "Ya se cobró por completo: hay que anular el cobro desde Pagos antes de tocar los platos. El pedido no se modificó.",
    };
  }
  if (status === 409 && /por encima del nuevo total/i.test(mensaje)) {
    return {
      title: "Ya se cobró más de lo que quedaría",
      description:
        "Al quitar este plato el pedido valdría menos de lo ya cobrado. Anula primero el cobro desde Pagos. El pedido no se modificó.",
    };
  }
  if (status === 409 && /cobrad|cobro/i.test(mensaje)) {
    return {
      title: "Este plato ya fue cobrado",
      description:
        "Primero hay que anular el cobro desde Pagos y luego volver a anular el plato. El pedido no se modificó.",
    };
  }
  if (status === 409) {
    // Incluye la carrera entre dos tablets ("El ítem fue modificado por otra
    // operación"): no se reintenta a ciegas, se refresca y se vuelve a mirar.
    return {
      title: "Otro puesto tocó este plato a la vez",
      description: `${mensaje} Actualizamos la comanda: el pedido no se modificó.`,
    };
  }
  if (status === 400) {
    const crudo = /estado "(\w+)"/i.exec(mensaje)?.[1];
    const estado = crudo ? ESTADOS_ITEM[crudo] : undefined;
    return {
      title: "Este plato ya no se puede anular",
      description: estado
        ? `El plato figura como ${estado} y desde ese punto ya no se anula desde cocina. El pedido no se modificó.`
        : `${mensaje} El pedido no se modificó.`,
    };
  }
  if (status === 404) {
    return {
      title: "El plato ya no está en el tablero",
      description:
        "Otro puesto pudo anularlo o cerrar el pedido. Actualizamos la pantalla para que veas el estado real.",
    };
  }
  return {
    title: "No se pudo anular el plato",
    description:
      mensaje || "Revisa la conexión e inténtalo de nuevo. El pedido no se modificó.",
  };
}

// ---------------------------------------------------------------------------
// Diálogo del "86": motivo + retirada opcional de la carta
// ---------------------------------------------------------------------------

function AnularPlatoDialog({
  open,
  onOpenChange,
  item,
  puedeTocarCarta,
  platoDisponible,
  onContinuar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: any | null;
  puedeTocarCarta: boolean;
  platoDisponible: boolean;
  onContinuar: (motivo: string, marcarAgotado: boolean) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [marcarAgotado, setMarcarAgotado] = useState(false);

  // Cada apertura empieza en limpio: arrastrar el motivo del plato anterior es
  // la forma más rápida de llenar el histórico de anulaciones mentirosas.
  useEffect(() => {
    if (open) {
      setMotivo("");
      setMarcarAgotado(false);
    }
  }, [open, item?.id]);

  if (!item) return null;

  const motivoValido = motivo.trim().length >= MOTIVO_MIN;
  const ofrecerAgotado = puedeTocarCarta && platoDisponible && !!item.menu_item_id;

  const elegirMotivo = (valor: string) => {
    setMotivo(valor);
    // "Se acabó" implica, casi siempre, retirar el plato de la carta: se
    // propone marcado, pero se puede desmarcar.
    if (valor === "Se acabó" && ofrecerAgotado) setMarcarAgotado(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Anular {item.quantity}x {item.name}
          </DialogTitle>
          <DialogDescription>
            El plato se marcará como anulado y los totales del pedido se
            recalcularán. Indica el motivo: queda registrado en la auditoría.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Motivos frecuentes</p>
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_RAPIDOS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => elegirMotivo(m)}
                  aria-pressed={motivo.trim() === m}
                  className={cn(
                    "h-10 rounded-xl border px-4 text-sm font-semibold transition-colors",
                    motivo.trim() === m
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="motivo-anulacion"
              className="text-sm font-semibold text-foreground"
            >
              Motivo
            </label>
            <textarea
              id="motivo-anulacion"
              value={motivo}
              maxLength={MOTIVO_MAX}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Escribe el motivo o elige uno de arriba"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={cn(
                  "text-muted-foreground",
                  motivo.length > 0 && !motivoValido && "text-destructive",
                )}
                role={motivo.length > 0 && !motivoValido ? "alert" : undefined}
              >
                {motivo.length > 0 && !motivoValido
                  ? `Escribe al menos ${MOTIVO_MIN} caracteres`
                  : "Obligatorio"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {motivo.length}/{MOTIVO_MAX}
              </span>
            </div>
          </div>

          {ofrecerAgotado && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
              <input
                type="checkbox"
                checked={marcarAgotado}
                onChange={(e) => setMarcarAgotado(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-destructive"
              />
              <span className="text-sm">
                <span className="font-semibold text-foreground">
                  Marcar «{item.name}» como agotado en la carta
                </span>
                <span className="block text-muted-foreground">
                  Deja de ofrecerse a los comensales y en el POS hasta que se reponga.
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={!motivoValido}
            onClick={() => onContinuar(motivo.trim(), marcarAgotado)}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Línea de comanda
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  columnStatus,
  platoAgotado,
  puedeTocarCarta,
  puedeTocarLineas,
  readyArmado,
  ocupado,
  cambiandoCarta,
  onListo,
  onAnular,
  onAlternarCarta,
}: {
  item: any;
  columnStatus: "pending" | "preparing" | "ready";
  platoAgotado: boolean;
  puedeTocarCarta: boolean;
  puedeTocarLineas: boolean;
  readyArmado: boolean;
  ocupado: boolean;
  cambiandoCarta: boolean;
  onListo: (itemId: string) => void;
  onAnular: (item: any) => void;
  onAlternarCarta: (menuItemId: string, nombre: string, disponible: boolean) => void;
}) {
  const anulado = item.status === "cancelled";
  const servido = item.status === "served";
  const listo = item.status === "ready";

  // La máquina de estados no permite volver de "ready" a "preparing": marcar un
  // plato como listo es IRREVERSIBLE. Por eso el botón pide dos toques en vez de
  // ofrecer un "deshacer" que el servidor rechazaría.
  const puedeMarcarListo =
    puedeTocarLineas && columnStatus === "preparing" && !listo && !anulado && !servido;
  const puedeAnular = puedeTocarLineas && !anulado && !servido;
  const puedeCambiarCarta = puedeTocarCarta && !!item.menu_item_id;

  // Los modificadores se leen en una sola línea ("Arroz extra · Sin cebolla"):
  // en una lista vertical, una comanda de cinco platos con opciones ocupaba
  // media pantalla y obligaba a desplazar para ver el resto del pedido.
  const modificadores = Array.isArray(item.modifiers)
    ? item.modifiers.map((m: any) => m.name).filter(Boolean).join(" · ")
    : "";

  return (
    <div className={cn("px-3 py-1.5", anulado && "opacity-60")}>
      <div className="flex gap-2.5">
        {/*
          La cantidad va en monoespaciada y tabular para que todas las cifras
          caigan en la misma columna óptica, y solo se resalta cuando es mayor
          que uno: en una comanda, "2×" es la información que hay que cazar de
          un vistazo; el "1×" es ruido de fondo.
        */}
        <span
          className={cn(
            "min-w-[26px] font-mono text-[13px] font-semibold leading-[1.45] tabular-nums",
            item.quantity > 1 ? "text-foreground" : "text-muted-foreground",
            anulado && "text-muted-foreground line-through",
          )}
        >
          {item.quantity}×
        </span>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-[14px] font-semibold leading-[1.3] text-foreground",
              (listo || anulado) && "text-muted-foreground line-through",
            )}
          >
            {item.name}
          </div>

          {modificadores && !anulado && (
            <div className="mt-0.5 text-[12px] leading-[1.35] text-muted-foreground">
              {modificadores}
            </div>
          )}

          {item.notes && !anulado && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] font-semibold leading-[1.3] text-amber-700 bg-amber-500/[0.14] dark:text-amber-400">
              <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
              {item.notes}
            </div>
          )}

          {platoAgotado && !anulado && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-destructive bg-destructive/15">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Agotado en carta
            </div>
          )}

          {anulado && (
            <div className="mt-0.5 text-[12px] font-semibold leading-[1.3] text-destructive">
              Anulado{item.cancel_reason ? `: ${item.cancel_reason}` : ""}
            </div>
          )}
        </div>

        {listo && !anulado && (
          <CheckCircle
            className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400"
            aria-label="Plato listo"
          />
        )}
      </div>

      {(puedeMarcarListo || puedeAnular || puedeCambiarCarta) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[34px]">
          {puedeMarcarListo && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onListo(item.id)}
              aria-label={
                readyArmado
                  ? `Confirmar que ${item.name} está listo`
                  : `Marcar ${item.name} como listo`
              }
              className={cn(
                "inline-flex h-10 flex-1 min-w-[7rem] items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors disabled:opacity-50",
                readyArmado
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "border border-blue-500/50 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400",
              )}
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              {ocupado ? "Guardando…" : readyArmado ? "Confirmar" : "Listo"}
            </button>
          )}

          {puedeAnular && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onAnular(item)}
              aria-label={`Anular ${item.name} de la comanda (86)`}
              title="Anular este plato de la comanda (86)"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-destructive/50 px-3 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
              86
            </button>
          )}

          {puedeCambiarCarta && (
            <button
              type="button"
              disabled={cambiandoCarta}
              onClick={() => onAlternarCarta(item.menu_item_id, item.name, platoAgotado)}
              aria-label={
                platoAgotado
                  ? `Reponer ${item.name} en la carta`
                  : `Marcar ${item.name} como agotado en la carta`
              }
              title={
                platoAgotado
                  ? "Volver a ofrecer este plato en la carta"
                  : "Retirar este plato de la carta (se acabó)"
              }
              className={cn(
                "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition-colors disabled:opacity-50",
                platoAgotado
                  ? "border-green-600/50 text-green-700 hover:bg-green-500/10 dark:text-green-400"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {platoAgotado ? (
                <>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reponer
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" aria-hidden="true" />
                  Sin stock
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Cronómetro de la comanda.
 *
 * Tres estados y solo uno grita. Antes las tres urgencias iban sobre fondo
 * sólido —verde, ámbar, rojo—, de modo que una cocina al día se veía igual de
 * saturada que una desbordada y el rojo dejaba de destacar. Ahora lo normal es
 * texto plano, el aviso es un fondo tenue, y el fondo rojo pleno queda reservado
 * para lo que de verdad pasó de la meta.
 *
 * La urgencia llega calculada desde el contexto contra la meta configurable, no
 * contra umbrales fijos: la meta de una parrilla no es la de una barra.
 */
function ElapsedTimerBadge({
  timeLabel,
  late,
  warn,
}: {
  timeLabel: string;
  late: boolean;
  warn: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-[3px] font-mono text-[14px] font-semibold tabular-nums",
        late
          ? "bg-red-500 text-white"
          : warn
            ? "bg-amber-500/[0.14] text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
      )}
      aria-label={late ? `${timeLabel}, pasó la meta` : timeLabel}
    >
      {timeLabel}
    </span>
  );
}

/** Destino de la comanda: mesa, para llevar o reparto. */
function DestinationBadge({ order }: { order: any }) {
  const isDelivery = order.type === "delivery";
  const isTakeout = order.type === "takeout";
  const tableNumber =
    order.table_number ?? order.tableNumber ?? order.tableName ?? order.table_name ?? null;

  const Icon = isDelivery ? Bike : isTakeout ? Package : Grid3X3;
  const label = isDelivery
    ? "Delivery"
    : isTakeout
      ? "Para llevar"
      : tableNumber
        ? `Mesa ${tableNumber}`
        : order.customer_name || order.customerName || "Salón";

  // La zona (terraza, segundo piso) solo importa para lo que se sirve en mesa, y
  // solo si el local tiene ambientes configurados. Es lo que le dice al corredor
  // a dónde sube el plato cuando la pantalla muestra todo el local.
  const zona = !isDelivery && !isTakeout ? order.space_name : null;

  return (
    <span
      className={cn(
        "inline-flex max-w-[190px] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold tracking-[0.04em]",
        // El reparto se distingue por color porque es el único destino que sale
        // del local: confundirlo con una mesa cuesta un viaje.
        isDelivery ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground",
      )}
    >
      <Icon className="h-[13px] w-[13px] shrink-0" aria-hidden="true" />
      {label}
      {zona && (
        <span className="truncate font-medium opacity-70" title={zona}>
          · {zona}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de comanda
// ---------------------------------------------------------------------------

export function KitchenOrderCard({
  view,
  columnStatus,
  onAdvance,
  onBack,
  onPrint,
  isAdvancing,
  isNew,
  totalInBoard,
}: {
  view: KitchenCardView;
  columnStatus: "pending" | "preparing" | "ready";
  onAdvance: (orderId: string, status: string) => void;
  onBack: (orderId: string, status: string) => void;
  onPrint: (order: any) => void;
  isAdvancing: boolean;
  isNew?: boolean;
  /** Comandas visibles en todo el tablero: decide si vale la pena numerar. */
  totalInBoard: number;
}) {
  const { order, rank, timeLabel, late, warn, pct } = view;
  const [expanded, setExpanded] = useState(false);
  const { refetch } = useKitchenContext();

  // Se ocultan las acciones que el rol no puede ejecutar: enseñar un botón que
  // devuelve 403 al tocarlo es peor que no tenerlo.
  const role = useAuthStore((s) => s.user?.role);
  const puedeTocarCarta = hasPermission(role, "menu:availability");
  const puedeTocarLineas = hasPermission(role, "orders:update_item_status");
  // Saber qué platos están agotados es información, no una acción: el mozo y el
  // cajero (que tienen menu:read pero no menu:availability) también necesitan
  // ver el distintivo. Antes la consulta se pedía solo con permiso de escritura,
  // así que para ellos el tablero nunca mostraba "Agotado en carta".
  const puedeVerCarta = hasPermission(role, "menu:read");

  const { data: carta } = useKitchenMenuAvailability(puedeVerCarta);
  const agotados = useMemo(() => {
    const set = new Set<string>();
    for (const plato of carta ?? []) {
      if (plato && plato.is_available === false) set.add(plato.id);
    }
    return set;
  }, [carta]);

  const updateItemStatus = useUpdateKitchenItemStatus();
  const cancelItem = useCancelKitchenItem();
  const { alternar: alternarCarta, enCambio: platosEnCambio } = useToggleMenuAvailability();

  // Bloqueo POR LÍNEA, no por tarjeta: un toque no puede congelar los botones de
  // los demás platos de la misma comanda.
  const [lineasOcupadas, setLineasOcupadas] = useState<Set<string>>(new Set());

  const marcarOcupada = (itemId: string, activa: boolean) =>
    setLineasOcupadas((prev) => {
      const next = new Set(prev);
      if (activa) next.add(itemId);
      else next.delete(itemId);
      return next;
    });

  // ── Confirmación en dos toques del botón "Listo" ────────────────────────
  const [readyArmado, setReadyArmado] = useState<string | null>(null);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    };
  }, []);

  const desarmar = () => {
    if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    temporizadorRef.current = null;
    setReadyArmado(null);
  };

  const handleListo = (itemId: string) => {
    if (readyArmado !== itemId) {
      // Primer toque: se arma y se desarma solo. Con guantes, un roce no puede
      // dejar un plato marcado como listo sin remedio.
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
      setReadyArmado(itemId);
      temporizadorRef.current = setTimeout(() => setReadyArmado(null), CONFIRMACION_MS);
      return;
    }

    desarmar();
    marcarOcupada(itemId, true);
    updateItemStatus.mutate(
      { id: itemId, status: "ready" },
      {
        onError: (err: any) => {
          if (err?.status === 409) {
            toast.warning("Otra pantalla ya movió este plato", {
              description: "Actualizamos la comanda para que veas el estado real.",
            });
          } else {
            toast.error("No se pudo marcar el plato como listo", {
              description: err?.message || "Revisa la conexión e inténtalo de nuevo.",
            });
          }
          refetch();
        },
        onSettled: () => marcarOcupada(itemId, false),
      },
    );
  };

  // ── Anulación ("86") ─────────────────────────────────────────────────────
  const [motivoAbierto, setMotivoAbierto] = useState(false);
  const [confirmAbierto, setConfirmAbierto] = useState(false);
  const [itemAAnular, setItemAAnular] = useState<any | null>(null);
  const [motivoElegido, setMotivoElegido] = useState("");
  const [retirarDeCarta, setRetirarDeCarta] = useState(false);

  const abrirAnulacion = (item: any) => {
    desarmar();
    setItemAAnular(item);
    setMotivoElegido("");
    setRetirarDeCarta(false);
    setMotivoAbierto(true);
  };

  const continuarAnulacion = (motivo: string, marcarAgotado: boolean) => {
    setMotivoElegido(motivo);
    setRetirarDeCarta(marcarAgotado);
    setMotivoAbierto(false);
    setConfirmAbierto(true);
  };

  const confirmarAnulacion = () => {
    const item = itemAAnular;
    if (!item) return;

    // Se registra ANTES de lanzar la petición, no en onSuccess: el servidor
    // difunde `order:item_cancelled` mientras responde, así que el evento puede
    // llegar a esta misma pantalla antes que la respuesta HTTP. Registrándolo
    // después, el cocinero veía su propio "86" anunciado como si lo hubiera
    // hecho otro puesto. Si la petición falla no pasa nada: la marca caduca sola
    // y no habrá evento que silenciar.
    registrarAnulacionLocal(item.id);

    marcarOcupada(item.id, true);
    cancelItem.mutate(
      { orderId: order.id, itemId: item.id, reason: motivoElegido },
      {
        onSuccess: (data) => {
          setConfirmAbierto(false);
          setItemAAnular(null);

          toast.success(`Anulado: ${item.quantity}x ${item.name}`, {
            description: data.order_cancelled
              ? "Era el último plato vivo: el pedido completo quedó anulado."
              : `Nuevo total del pedido #${data.order.order_number}: ${formatCurrency(
                  data.order.total,
                )}`,
          });

          if (retirarDeCarta && item.menu_item_id) {
            alternarCarta(item.menu_item_id, item.name, false, { silencioSiIgual: true });
          }
        },
        onError: (err: any) => {
          const { title, description } = mensajeDeAnulacion(err);
          toast.error(title, { description });
          setConfirmAbierto(false);
          setItemAAnular(null);
          refetch();
        },
        onSettled: () => marcarOcupada(item.id, false),
      },
    );
  };

  // ── Datos de cabecera ────────────────────────────────────────────────────
  const orderNum = order.orderNumber || order.order_number || order.id;
  const createdAt = order.createdAt || order.created_at || "";
  const isDelivery = order.type === "delivery";
  // La urgencia ya no se calcula aquí: llega en `view`, medida contra la meta
  // configurable de la pantalla en vez de contra umbrales fijos.
  const deliveryPhone = order.delivery_phone || order.deliveryPhone || "";
  const deliveryAddress = order.delivery_address || order.deliveryAddress || "";

  // Los platos anulados siguen viniendo del servidor: se muestran (tachados y al
  // final) para que la cocina vea qué se cayó, pero no cuentan como trabajo.
  const todosLosItems: any[] = order.items || [];
  const items = useMemo(() => {
    return [...todosLosItems].sort((a, b) => {
      const aAnulado = a.status === "cancelled" ? 1 : 0;
      const bAnulado = b.status === "cancelled" ? 1 : 0;
      return aAnulado - bAnulado;
    });
  }, [todosLosItems]);

  const itemsVivos = items.filter((i) => i.status !== "cancelled");
  const anuladosCount = items.length - itemsVivos.length;

  const hasOverflow = items.length > VISIBLE_ITEMS_LIMIT;
  const visibleItems = expanded ? items : items.slice(0, VISIBLE_ITEMS_LIMIT);
  const hiddenCount = items.length - VISIBLE_ITEMS_LIMIT;

  const anulandoAhora = itemAAnular ? lineasOcupadas.has(itemAAnular.id) : false;

  // El número de prioridad solo aparece cuando hay cola de verdad. Con tres
  // comandas en pantalla, un "01" sobre cada una es ruido: el orden ya se ve.
  const mostrarRank = totalInBoard >= 4;

  // El destino del retroceso sale de la MISMA tabla que valida el servidor, así
  // que el botón no puede ofrecer un movimiento que vaya a rechazarse.
  const backTarget = KITCHEN_BACK_TRANSITIONS[columnStatus];

  return (
    <article
      className={cn(
        "flex-none overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.18)]",
        // El borde rojo es la única señal de la tarjeta que compite con el
        // cronómetro; se reserva para lo que ya pasó la meta.
        late && "border-red-500/60",
        isNew && "animate-kitchen-flash",
      )}
    >
      {/* Cabecera: prioridad, número, destino y reloj en una sola línea */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        {mostrarRank && (
          <span
            className={cn(
              "w-[18px] shrink-0 text-[11px] font-bold tabular-nums tracking-[0.02em]",
              rank === 1 ? "text-foreground" : "text-muted-foreground",
            )}
            aria-label={`Prioridad ${rank}`}
          >
            {String(rank).padStart(2, "0")}
          </span>
        )}

        <span className="text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          #{orderNum}
        </span>

        <DestinationBadge order={order} />

        <span className="flex-1" />

        {createdAt && (
          <ElapsedTimerBadge timeLabel={timeLabel} late={late} warn={warn} />
        )}

        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onPrint(order)}
          aria-label={`Imprimir la comanda ${orderNum}`}
          title="Imprimir comanda"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/*
        Barra de avance contra la meta. Es la lectura periférica del tablero: sin
        leer un solo número se ve qué comanda está a punto de pasarse. En la
        columna de listos no se pinta — ahí el reloj de cocina ya paró.
      */}
      {columnStatus !== "ready" && (
        <div
          className="mx-3 h-0.5 overflow-hidden rounded-full bg-foreground/[0.07] dark:bg-white/[0.07]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Avance respecto a la meta de tiempo"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              late
                ? "bg-red-500 opacity-70"
                : warn
                  ? "bg-amber-500 opacity-80"
                  : "bg-muted-foreground opacity-35",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Datos de reparto: sin esto el repartidor no sabe a dónde va */}
      {isDelivery && (deliveryPhone || deliveryAddress) && (
        <div className="mx-3 mt-2 space-y-0.5 rounded border border-border/70 bg-muted/40 px-2.5 py-1.5 text-[12px]">
          {deliveryPhone && (
            <a
              href={`tel:${deliveryPhone}`}
              className="inline-flex items-center gap-1.5 font-semibold text-foreground underline-offset-2 hover:underline"
              aria-label={`Llamar al ${deliveryPhone}`}
            >
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {deliveryPhone}
            </a>
          )}
          {deliveryAddress && (
            <p className="flex items-start gap-1.5 leading-snug text-muted-foreground">
              <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{deliveryAddress}</span>
            </p>
          )}
        </div>
      )}

      <div className="py-2">
        {visibleItems.map((item: any) => (
          <ItemRow
            key={item.id}
            item={item}
            columnStatus={columnStatus}
            platoAgotado={!!item.menu_item_id && agotados.has(item.menu_item_id)}
            puedeTocarCarta={puedeTocarCarta}
            puedeTocarLineas={puedeTocarLineas}
            readyArmado={readyArmado === item.id}
            ocupado={lineasOcupadas.has(item.id)}
            cambiandoCarta={
              !!item.menu_item_id && platosEnCambio.has(item.menu_item_id)
            }
            onListo={handleListo}
            onAnular={abrirAnulacion}
            onAlternarCarta={(menuItemId, nombre, disponible) =>
              alternarCarta(menuItemId, nombre, disponible)
            }
          />
        ))}
        {hasOverflow && (
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                Ver {hiddenCount} platos más
              </>
            )}
          </button>
        )}
        {order.notes && (
          <div className="mx-3 mb-1 mt-1 flex gap-1.5 rounded px-2 py-1.5 text-[12.5px] font-semibold leading-[1.35] text-amber-700 bg-amber-500/[0.12] dark:text-amber-400">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {order.notes}
          </div>
        )}
      </div>

      {/*
        Acción principal a ancho completo y 44px de alto: es el único control que
        se pulsa con guantes y de pasada, así que domina el pie de la tarjeta.
        Junto a ella, un botón discreto para devolver la comanda un paso — el
        toque errado es constante en un pase y antes obligaba a buscar a alguien
        con más permisos.
      */}
      <div className="flex gap-2 px-2.5 pb-2.5">
        {columnStatus === "pending" && (
          <Button
            className="h-11 flex-1 rounded-md bg-indigo-600 text-[14.5px] font-bold tracking-[0.01em] text-white hover:bg-indigo-700"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "pending")}
          >
            {isAdvancing ? "Guardando…" : "Preparar"}
            {!isAdvancing && <ArrowRight className="ml-2 h-[17px] w-[17px]" aria-hidden="true" />}
          </Button>
        )}

        {columnStatus === "preparing" && (
          <Button
            className="h-11 flex-1 rounded-md bg-foreground text-[14.5px] font-bold tracking-[0.01em] text-background hover:bg-foreground/90"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "preparing")}
          >
            {isAdvancing ? "Guardando…" : "Marcar listo"}
            {!isAdvancing && (
              <CheckCircle className="ml-2 h-[17px] w-[17px]" aria-hidden="true" />
            )}
          </Button>
        )}

        {columnStatus === "ready" && (
          <Button
            variant="outline"
            className="h-11 flex-1 rounded-md border-border text-[14.5px] font-bold tracking-[0.01em] text-muted-foreground hover:text-foreground"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "ready")}
          >
            {isAdvancing ? "Guardando…" : "Entregado"}
          </Button>
        )}

        {backTarget && (
          <button
            type="button"
            disabled={isAdvancing}
            onClick={() => onBack(order.id, columnStatus)}
            aria-label={`Devolver la comanda ${orderNum} a ${ESTADO_ANTERIOR_LABEL[backTarget] ?? "el paso anterior"}`}
            title={`Volver a ${ESTADO_ANTERIOR_LABEL[backTarget] ?? "el paso anterior"}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Undo2 className="h-[17px] w-[17px]" aria-hidden="true" />
          </button>
        )}
      </div>

      <AnularPlatoDialog
        open={motivoAbierto}
        onOpenChange={(v) => {
          setMotivoAbierto(v);
          if (!v && !confirmAbierto) setItemAAnular(null);
        }}
        item={itemAAnular}
        puedeTocarCarta={puedeTocarCarta}
        platoDisponible={
          !!itemAAnular?.menu_item_id && !agotados.has(itemAAnular.menu_item_id)
        }
        onContinuar={continuarAnulacion}
      />

      <ConfirmDialog
        open={confirmAbierto}
        onOpenChange={(v) => {
          setConfirmAbierto(v);
          if (!v) setItemAAnular(null);
        }}
        title={
          itemAAnular
            ? `¿Anular ${itemAAnular.quantity}x ${itemAAnular.name}?`
            : "¿Anular el plato?"
        }
        description={
          itemAAnular
            ? `Motivo: "${motivoElegido}". Se recalcularán los totales del pedido #${orderNum}` +
              (itemsVivos.length === 1
                ? " y, al no quedar más platos, el pedido completo quedará anulado."
                : ".") +
              (retirarDeCarta ? ` Además, «${itemAAnular.name}» se retirará de la carta.` : "") +
              " Esta acción no se puede deshacer desde cocina."
            : ""
        }
        confirmLabel="Anular plato"
        loading={anulandoAhora}
        onConfirm={confirmarAnulacion}
      />
    </article>
  );
}
