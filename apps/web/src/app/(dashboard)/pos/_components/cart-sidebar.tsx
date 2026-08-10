"use client";

import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@restai/ui/components/select";
import {
  ShoppingCart,
  User,
  Plus,
  Minus,
  Trash2,
  Loader2,
  UtensilsCrossed,
  Phone,
  MapPin,
  Truck,
  ChefHat,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/fetcher";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TablePicker } from "./table-picker";
import { CustomerPicker } from "./customer-picker";
import { AccountBar } from "./account-bar";
import { SentLines } from "./sent-lines";
import { accionPrincipal, type CuentaAbierta, type TipoCuenta } from "./pos-accounts";
import type { PosCartItem, PosCustomer } from "../page";

/** 1800 -> "18", 1850 -> "18,5". La tasa se pinta tal cual la tiene la sede. */
function formatTaxRate(rate: number): string {
  const pct = rate / 100;
  return Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(2).replace(/0+$/, "").replace(".", ",");
}

// ---------------------------------------------------------------------------
// CartSidebar
// ---------------------------------------------------------------------------

export function CartSidebar({
  className,
  cart,
  orderType,
  customerName,
  orderNotes,
  isPending,
  onOrderTypeChange,
  onCustomerNameChange,
  onOrderNotesChange,
  onUpdateQty,
  onRemove,
  onClearCart,
  onCreateOrder,
  onCobrar,
  cuenta,
  cuentasAbiertas,
  onVerCuentas,
  onSoltarCuenta,
  deliveryPhone,
  onDeliveryPhoneChange,
  deliveryAddress,
  onDeliveryAddressChange,
  deliveryFee,
  onDeliveryFeeChange,
  deliveryFeeCents,
  deliveryFeeInvalid,
  deliveryDriverId,
  onDeliveryDriverIdChange,
  paymentMethod,
  onPaymentMethodChange,
  isPaid,
  onIsPaidChange,
  taxRate = 1800,
  tableId,
  onTableChange,
  customer,
  onCustomerChange,
}: {
  className?: string;
  cart: PosCartItem[];
  orderType: "dine_in" | "takeout" | "delivery";
  customerName: string;
  orderNotes: string;
  isPending: boolean;
  onOrderTypeChange: (type: "dine_in" | "takeout" | "delivery") => void;
  onCustomerNameChange: (name: string) => void;
  onOrderNotesChange: (notes: string) => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onClearCart: () => void;
  /** Manda lo cantado a cocina: abre la cuenta o la amplía, y NO cobra. */
  onCreateOrder: () => void;
  /** Cierra la venta: manda lo que falte y abre el cobro. */
  onCobrar: () => void;
  /** Cuenta abierta sobre la que se está cantando. `null` = venta nueva. */
  cuenta: CuentaAbierta | null;
  /** Cuántas cuentas hay abiertas en el local ahora mismo. */
  cuentasAbiertas: number;
  onVerCuentas: () => void;
  onSoltarCuenta: () => void;
  deliveryPhone: string;
  onDeliveryPhoneChange: (v: string) => void;
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
  deliveryFee: string;
  onDeliveryFeeChange: (v: string) => void;
  /** Tarifa de delivery ya validada, en CÉNTIMOS. La calcula la página. */
  deliveryFeeCents: number;
  /** El campo tiene texto que no es un importe: no se puede crear la orden. */
  deliveryFeeInvalid: boolean;
  deliveryDriverId: string;
  onDeliveryDriverIdChange: (v: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;
  isPaid: boolean;
  onIsPaidChange: (v: boolean) => void;
  /** Tasa de IGV de la sede en centésimas de punto (1800 = 18 %). */
  taxRate?: number;
  /** Mesa del pedido "Aquí". null = venta de mostrador sin mesa. */
  tableId: string | null;
  onTableChange: (tableId: string | null) => void;
  /** Cliente identificado: es lo que hace que la venta sume puntos. */
  customer: PosCustomer | null;
  onCustomerChange: (customer: PosCustomer | null) => void;
}) {
  const role = useAuthStore((state) => state.user?.role);
  // El listado de personal solo lo puede leer quien tenga `staff:read` (el mozo
  // NO lo tiene) y solo hace falta para asignar repartidor. Pedirlo siempre era
  // un 403 silencioso en cada carga del POS de un mozo.
  const canReadStaff = hasPermission(role, "staff:read");
  const { data: staffData } = useQuery<any[]>({
    queryKey: ["staff", { includeInactive: false }],
    queryFn: () => apiFetch<any[]>("/api/staff"),
    enabled: canReadStaff && orderType === "delivery",
  });
  const staffList: any[] = staffData ?? [];
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const subtotal = cart.reduce((sum, item) => {
    const modTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
    return sum + (item.unitPrice + modTotal) * item.quantity;
  }, 0);
  // La tasa de IGV es la de la sede (branches.tax_rate), no un 18 % cableado:
  // con el valor fijo, el botón anunciaba un total distinto al que creaba el
  // servidor en cualquier sede con tasa distinta o exonerada.
  const tax = Math.round((subtotal * taxRate) / 10000);
  const total = subtotal + tax + deliveryFeeCents;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  /*
    Qué hace el botón grande.

    En salón lo que cierra el momento es mandar a cocina —se cobra al final, y a
    veces media hora después—; en mostrador es cobrar, porque el cliente está
    delante esperando su bolsa. Tratar los dos igual obligaba a uno de los dos a
    dar un rodeo, y ese rodeo se da cincuenta veces por servicio.
  */
  const tipoCuenta: TipoCuenta = cuenta
    ? cuenta.tipo
    : orderType === "dine_in"
      ? "mesa"
      : orderType === "takeout"
        ? "llevar"
        : "delivery";
  const saldoCuenta = cuenta?.saldo ?? 0;
  // En salón el botón de cobrar solo aparece con el carrito vacío, y entonces
  // cobra el saldo de la cuenta. En mostrador cobra lo ya abierto MÁS lo que
  // acaba de cantarse, porque va todo en el mismo movimiento.
  const importeACobrar =
    tipoCuenta === "mesa" ? (cart.length > 0 ? total : saldoCuenta) : saldoCuenta + total;
  const accion = accionPrincipal({
    tipo: tipoCuenta,
    platosPorEnviar: cart.length,
    totalCentimos: importeACobrar,
    formatearImporte: formatCurrency,
  });
  const bloqueado = isPending || deliveryFeeInvalid;
  // La salida que el botón grande deja fuera: cobrar una mesa que ya no espera
  // nada más, o mandar a cocina sin cobrar todavía en mostrador.
  const secundaria =
    accion?.clave === "enviar" && saldoCuenta > 0
      ? ({ clave: "cobrar", etiqueta: `Cobrar ${formatCurrency(saldoCuenta)}` } as const)
      : accion?.clave === "cobrar" && cart.length > 0
        ? ({ clave: "enviar", etiqueta: "Solo mandar a cocina" } as const)
        : null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Orden
          {totalQty > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalQty}
            </Badge>
          )}
        </h2>
        {cart.length > 0 && (
          <Button
            variant="ghost"
            className="h-10 px-3 text-destructive"
            onClick={() => setConfirmClearOpen(true)}
          >
            Limpiar
          </Button>
        )}
      </div>

      {/*
        Vaciar el carrito no tenía confirmación: un toque errado con el cliente
        delante borraba el pedido entero y había que volver a cantarlo.
      */}
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Vaciar la orden?"
        description={`Se quitarán ${totalQty} ${totalQty === 1 ? "producto" : "productos"} del carrito. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, vaciar"
        onConfirm={() => {
          onClearCart();
          setConfirmClearOpen(false);
        }}
      />

      <AccountBar
        cuenta={cuenta}
        abiertas={cuentasAbiertas}
        onVerTodas={onVerCuentas}
        onSoltar={onSoltarCuenta}
      />

      {/*
        Tipo y mesa: los elige quien ABRE la cuenta. Sobre una cuenta que ya
        existe no son preguntas, son hechos —cambiarlos ahí no movería el pedido
        de sitio, solo mentiría sobre dónde va—, así que desaparecen.
      */}
      {!cuenta && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            <Button
              variant={orderType === "dine_in" ? "default" : "outline"}
              size="sm"
              className="h-11"
              onClick={() => onOrderTypeChange("dine_in")}
            >
              Aquí
            </Button>
            <Button
              variant={orderType === "takeout" ? "default" : "outline"}
              size="sm"
              className="h-11"
              onClick={() => onOrderTypeChange("takeout")}
            >
              Llevar
            </Button>
            <Button
              variant={orderType === "delivery" ? "default" : "outline"}
              size="sm"
              className="h-11"
              onClick={() => onOrderTypeChange("delivery")}
            >
              <Truck className="h-3.5 w-3.5 mr-1" />
              Delivery
            </Button>
          </div>

          {/*
            Mesa: solo tiene sentido en el pedido "Aquí". Sin mesa el pedido nace
            sin visita, no entra en la cuenta del salón y liberar la mesa no lo
            cierra.
          */}
          {orderType === "dine_in" && (
            <div className="mb-3">
              <TablePicker value={tableId} onChange={onTableChange} />
            </div>
          )}
        </>
      )}

      {/*
        Cliente: identificarlo es lo que hace que la venta otorgue puntos.

        Sobre un pedido de mostrador ya abierto no se pregunta: la ampliación
        añade líneas a una orden que ya tiene su cliente, y volver a pedirlo
        sugeriría que se puede cambiar. En una mesa sí, porque cada ronda es una
        comanda nueva y todavía se puede identificar a quien paga.
      */}
      {(!cuenta || cuenta.tipo === "mesa") && (
        <div className="mb-3 space-y-2">
          <CustomerPicker customer={customer} onChange={onCustomerChange} />
          {!customer && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Nombre para la comanda (opcional)"
                value={customerName}
                onChange={(e) => onCustomerNameChange(e.target.value)}
                className="h-11 pl-9 text-sm"
                aria-label="Nombre del cliente para la comanda"
              />
            </div>
          )}
        </div>
      )}

      {/*
        Datos del reparto: viajan con la orden que se crea. Al ampliar un reparto
        ya despachado no se vuelven a preguntar —la dirección es la que es— y el
        endpoint de ampliación tampoco los aceptaría.
      */}
      {orderType === "delivery" && !cuenta && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg border border-dashed">
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Teléfono del cliente"
              value={deliveryPhone}
              onChange={(e) => onDeliveryPhoneChange(e.target.value)}
              className="h-11 pl-9 text-sm"
              type="tel"
              inputMode="tel"
              aria-label="Teléfono del cliente para el delivery"
            />
          </div>
          <textarea
            placeholder="Dirección de entrega (opcional: ubicación por WhatsApp)"
            value={deliveryAddress}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDeliveryAddressChange(e.target.value)}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={2}
            aria-label="Dirección de entrega"
          />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">S/</span>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Tarifa de delivery"
              value={deliveryFee}
              onChange={(e) => onDeliveryFeeChange(e.target.value)}
              className={cn("h-11 pl-9 text-sm", deliveryFeeInvalid && "border-destructive")}
              min="0"
              step="0.5"
              aria-label="Tarifa de delivery en soles"
              aria-invalid={deliveryFeeInvalid}
            />
          </div>
          {deliveryFeeInvalid && (
            <p role="alert" className="text-xs font-medium text-destructive">
              Escribe la tarifa en soles, con un máximo de dos decimales (ej. 8.50).
            </p>
          )}
          {canReadStaff && (
            <Select value={deliveryDriverId || undefined} onValueChange={onDeliveryDriverIdChange}>
              <SelectTrigger className="h-11 text-sm" aria-label="Repartidor asignado">
                <SelectValue placeholder="Repartidor (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {staffList.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={paymentMethod || undefined} onValueChange={onPaymentMethodChange}>
            <SelectTrigger className="h-11 text-sm" aria-label="Método de pago del delivery">
              <SelectValue placeholder="Método de pago" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="yape">Yape</SelectItem>
              <SelectItem value="plin">Plin</SelectItem>
              <SelectItem value="card">Tarjeta</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
            </SelectContent>
          </Select>
          {paymentMethod && (
            <label className="flex h-11 cursor-pointer items-center justify-between rounded-md px-1">
              <span className="text-sm">Ya pagó</span>
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => onIsPaidChange(e.target.checked)}
                className="h-6 w-6 rounded border-input accent-primary"
              />
            </label>
          )}
        </div>
      )}

      {/* Líneas del pedido */}
      <div className="mb-3 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {/*
          Lo que la cuenta YA pidió, antes de lo que está por mandarse. Sin esto,
          la segunda ronda repite un plato que ya está en la mesa.
        */}
        {cuenta && <SentLines cuenta={cuenta} />}

        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ShoppingCart className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">
              {cuenta ? "Toca un producto para ampliar esta cuenta" : "Toca un producto para agregar"}
            </p>
          </div>
        ) : (
          cart.map((item) => {
            const modTotal = item.modifiers.reduce((s, m) => s + m.price, 0);
            const lineTotal = (item.unitPrice + modTotal) * item.quantity;
            return (
              <div
                key={item.lineId}
                className="rounded-lg border p-2.5 space-y-1.5"
              >
                <div className="flex items-start gap-2">
                  {/* Miniatura del producto */}
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-9 w-9 rounded object-contain bg-muted flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.unitPrice + modTotal)} c/u
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(item.lineId)}
                    aria-label={`Quitar ${item.name} del pedido`}
                    className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Modificadores elegidos */}
                {item.modifiers.length > 0 && (
                  <div className="pl-11 flex flex-wrap gap-1">
                    {item.modifiers.map((mod) => (
                      <span
                        key={mod.modifierId}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {mod.name}
                        {mod.price > 0 && ` +${formatCurrency(mod.price)}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {item.notes && (
                  <p className="pl-11 text-[11px] text-muted-foreground italic truncate">
                    {item.notes}
                  </p>
                )}

                {/* Cantidad e importe de la línea */}
                <div className="flex items-center justify-between pl-11">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => onUpdateQty(item.lineId, item.quantity - 1)}
                      aria-label={`Quitar una unidad de ${item.name}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-7 text-center text-sm font-bold tabular-nums">
                      {item.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => onUpdateQty(item.lineId, item.quantity + 1)}
                      aria-label={`Añadir una unidad de ${item.name}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm font-bold">{formatCurrency(lineTotal)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Notes */}
      {cart.length > 0 && (
        <div className="mb-3">
          <Input
            placeholder="Notas de la orden…"
            value={orderNotes}
            onChange={(e) => onOrderNotesChange(e.target.value)}
            className="h-11 text-sm"
            aria-label="Notas de la orden"
          />
        </div>
      )}

      {/* Totales */}
      {cart.length > 0 && (
        <div className="mb-3 space-y-1 border-t pt-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IGV ({formatTaxRate(taxRate)}%)</span>
            <span>{formatCurrency(tax)}</span>
          </div>
          {deliveryFeeCents > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Delivery</span>
              <span>{formatCurrency(deliveryFeeCents)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg pt-1.5 border-t">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/*
        La acción que cierra este momento, y debajo la que no.

        Sin nada cantado y sin nada que cobrar no hay botón: un "Crear Orden"
        apagado ocupaba el mismo sitio sin decir qué falta para encenderlo.
      */}
      {accion ? (
        <div className="space-y-2">
          <Button
            className="h-14 w-full rounded-2xl text-base font-bold"
            disabled={bloqueado}
            onClick={accion.clave === "cobrar" ? onCobrar : onCreateOrder}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {accion.clave === "cobrar" ? "Cobrando…" : "Mandando…"}
              </>
            ) : (
              <span className="flex min-w-0 flex-col items-center leading-tight">
                <span className="flex items-center gap-2">
                  {accion.clave === "cobrar" ? (
                    <Wallet className="h-5 w-5" />
                  ) : (
                    <ChefHat className="h-5 w-5" />
                  )}
                  {accion.etiqueta}
                </span>
                {accion.detalle && (
                  <span className="text-[11px] font-medium opacity-80">{accion.detalle}</span>
                )}
              </span>
            )}
          </Button>

          {secundaria && (
            <Button
              variant="outline"
              className="h-11 w-full rounded-2xl text-sm font-semibold"
              disabled={bloqueado}
              onClick={secundaria.clave === "cobrar" ? onCobrar : onCreateOrder}
            >
              {secundaria.etiqueta}
            </Button>
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed py-4 text-center text-xs text-muted-foreground">
          {cuenta
            ? "Esta cuenta no debe nada. Canta un plato para ampliarla."
            : "Toca un plato para empezar la cuenta"}
        </p>
      )}
    </div>
  );
}
