"use client";

import { Minus, Plus } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { describeVariant, variantsInCart } from "@/lib/menu-options";

/**
 * Lo que este plato ya tiene en el pedido, ajustable aquí mismo.
 *
 * Antes esto era una línea muerta —"Ya pediste 2 · Ver en mi pedido"— que
 * mandaba al comensal a otra pantalla para hacer lo que casi siempre quiere
 * hacer: una más, o una menos. Y no decía CUÁLES: con dos configuraciones
 * distintas del mismo plato, el número solo servía para dudar.
 *
 * Repetir es un gesto: "otra igual" copia los mismos modificadores, así que cae
 * en la misma línea del carrito y suma una unidad en vez de crear una gemela.
 */
export function AlreadyOrdered({
  menuItemId,
  currency,
}: {
  menuItemId: string;
  currency?: string;
}) {
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateLineQuantity = useCartStore((s) => s.updateLineQuantity);

  const variants = variantsInCart(items, menuItemId);
  if (variants.length === 0) return null;

  const total = variants.reduce((n, v) => n + v.quantity, 0);

  return (
    <section className="mt-5 rounded-2xl border border-border bg-muted/40 p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Ya en tu pedido
      </p>

      <div className="mt-3 flex flex-col gap-2.5">
        {variants.map((v) => {
          const unitario = v.unitPrice + v.modifiers.reduce((n, m) => n + m.price, 0);
          return (
            <div key={v.lineId} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium capitalize">
                  {describeVariant(v)}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                  {formatCurrency(unitario, currency)} c/u
                  {v.notes ? ` · ${v.notes}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-background p-1">
                <button
                  type="button"
                  onClick={() => updateLineQuantity(v.lineId, v.quantity - 1)}
                  aria-label={`Quitar una unidad de ${describeVariant(v)}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="min-w-[1.25rem] text-center text-[14px] font-semibold tabular-nums">
                  {v.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => updateLineQuantity(v.lineId, v.quantity + 1)}
                  aria-label={`Añadir una unidad de ${describeVariant(v)}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Con una sola forma pedida, repetirla es un atajo real; con varias, el
          botón sería ambiguo (¿cuál de ellas?) y la lista de arriba ya sirve. */}
      {variants.length === 1 && (
        <button
          type="button"
          onClick={() =>
            addItem({
              menuItemId: variants[0]!.menuItemId,
              name: variants[0]!.name,
              unitPrice: variants[0]!.unitPrice,
              quantity: 1,
              modifiers: variants[0]!.modifiers,
            })
          }
          className={cn(
            "mt-3 flex h-11 w-full items-center justify-center rounded-full",
            "border border-border bg-background text-[14px] font-medium transition-colors hover:bg-muted",
          )}
        >
          Otra igual
        </button>
      )}

      <p className="mt-3 text-[12px] text-muted-foreground">
        {total === 1 ? "1 unidad en total" : `${total} unidades en total`}
      </p>
    </section>
  );
}
