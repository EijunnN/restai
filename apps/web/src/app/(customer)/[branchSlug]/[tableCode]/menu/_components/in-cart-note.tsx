"use client";

import { formatCurrency } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { describeVariant, variantsInCart } from "@/lib/menu-options";

/**
 * Una línea: cuánto llevas ya de este plato.
 *
 * Aquí hubo antes un bloque con su propio contador y un botón "Otra igual", y
 * confundía por tres motivos que se reforzaban entre sí:
 *
 *  - **"Pedido" promete lo que no es.** En el Perú "ya lo pedí" significa que
 *    está en la cocina. Esto es el carrito: no ha salido nada todavía. El
 *    rótulo mentía y, encima, dejaba tocar un menos, como si se pudiera
 *    cancelar un plato que ya se está cocinando.
 *  - **Dos contadores iguales, leyes opuestas.** El de aquí escribía en el
 *    carrito al instante y sin vuelta atrás; el del pie solo compone lo que se
 *    va a añadir. Tocar el de arriba y luego "Agregar" dejaba cuatro unidades a
 *    quien creía estar pidiendo tres.
 *  - **Editar aquí no hacía falta.** El carrito está a un toque y es donde se
 *    ve la cuenta entera, que es la cabeza con la que se corrigen cantidades.
 *
 * Así que informa y no toca nada: al no tener controles, es imposible
 * confundirla con la cantidad a añadir. La pantalla vuelve a prometer una sola
 * cosa —elegir y añadir— y el dinero ya comprometido, que antes no aparecía por
 * ningún lado, por fin se ve.
 */
export function InCartNote({
  menuItemId,
  currency,
  onOpenCart,
}: {
  menuItemId: string;
  currency?: string;
  onOpenCart: () => void;
}) {
  const items = useCartStore((s) => s.items);
  const variants = variantsInCart(items, menuItemId);
  if (variants.length === 0) return null;

  const units = variants.reduce((n, v) => n + v.quantity, 0);
  const amount = variants.reduce(
    (n, v) => n + (v.unitPrice + v.modifiers.reduce((m, x) => m + x.price, 0)) * v.quantity,
    0,
  );

  // Las variantes solo se nombran cuando hay más de una: con una sola, decir
  // "clásica" en un plato sin opciones sugiere una versión que no existe.
  const detalle =
    variants.length > 1
      ? variants.map((v) => `${v.quantity} ${describeVariant(v)}`).join(", ")
      : null;

  return (
    <div className="mt-3 text-[13px] leading-relaxed">
      <p>
        Ya llevas <span className="font-semibold">{units}</span> en tu carrito ·{" "}
        <span className="font-semibold tabular-nums">{formatCurrency(amount, currency)}</span>
        {" · "}
        <button
          type="button"
          onClick={onOpenCart}
          className="text-primary underline-offset-2 hover:underline"
        >
          Ver carrito
        </button>
      </p>
      {detalle && <p className="mt-0.5 text-muted-foreground">{detalle}</p>}
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Todavía no se envía a la cocina.
      </p>
    </div>
  );
}
