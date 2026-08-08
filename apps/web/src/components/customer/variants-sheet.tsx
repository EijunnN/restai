"use client";

import { Minus, Plus, SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@restai/ui/components/sheet";
import { cn, formatCurrency } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { describeVariant, variantsInCart } from "@/lib/menu-options";

/**
 * El mismo plato, pedido de varias formas.
 *
 * El carrito distingue las líneas por plato + opciones, así que dos causas —una
 * clásica y otra con palta extra— ya conviven sin problema. Lo que faltaba era
 * poder verlas: la tarjeta de la carta enseñaba un contador que solo miraba la
 * línea sin opciones, de modo que un plato pedido con extras figuraba con cero
 * y su botón "+" creaba una tercera línea distinta sin avisar.
 *
 * Aquí se ven todas, se ajusta la cantidad de cada una, y repetir es un gesto:
 * "otra igual a la última" evita volver a recorrer todas las opciones para
 * pedir lo mismo dos veces.
 */
export function VariantsSheet({
  open,
  onOpenChange,
  menuItemId,
  itemName,
  currency,
  onConfigureNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuItemId: string;
  itemName: string;
  currency?: string;
  /** Abre el detalle para elegir una configuración distinta. */
  onConfigureNew: () => void;
}) {
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateLineQuantity = useCartStore((s) => s.updateLineQuantity);

  const variants = variantsInCart(items, menuItemId);
  const last = variants[variants.length - 1];

  const repeatLast = () => {
    if (!last) return;
    // Añadir con los MISMOS modificadores cae en la misma firma de línea, así
    // que el carrito suma una unidad en vez de crear una línea gemela.
    addItem({
      menuItemId: last.menuItemId,
      name: last.name,
      unitPrice: last.unitPrice,
      quantity: 1,
      modifiers: last.modifiers,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-5 pb-8 pt-4"
      >
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-[22px] font-medium">{itemName}</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            {variants.length === 1
              ? "1 en tu pedido"
              : `${variants.length} formas distintas en tu pedido`}
          </p>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2">
          {variants.map((v) => (
            <div
              key={v.lineId}
              className="flex items-center gap-3 rounded-2xl border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium capitalize">{describeVariant(v)}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {formatCurrency(
                    v.unitPrice + v.modifiers.reduce((n, m) => n + m.price, 0),
                    currency,
                  )}
                  {v.notes ? ` · ${v.notes}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1 rounded-full border border-border p-1">
                <Stepper
                  label={`Quitar una unidad de ${describeVariant(v)}`}
                  onClick={() => updateLineQuantity(v.lineId, v.quantity - 1)}
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Stepper>
                <span className="min-w-[1.5rem] text-center text-[14px] font-semibold tabular-nums">
                  {v.quantity}
                </span>
                <Stepper
                  label={`Añadir una unidad de ${describeVariant(v)}`}
                  onClick={() => updateLineQuantity(v.lineId, v.quantity + 1)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Stepper>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          {last && (
            <button
              type="button"
              onClick={repeatLast}
              className="flex h-14 items-center justify-between rounded-full bg-primary px-5 text-primary-foreground"
            >
              <span className="text-[15px] font-medium">Otra igual a la última</span>
              <span className="truncate pl-3 text-[13px] opacity-75">
                {describeVariant(last)}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfigureNew();
            }}
            className="flex h-14 items-center justify-center gap-2.5 rounded-full border border-border"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="text-[15px] font-medium">Otra con opciones distintas</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stepper({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full text-foreground",
        "transition-colors hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
