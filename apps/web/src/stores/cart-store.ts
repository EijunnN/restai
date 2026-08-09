import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartItem, CartModifier } from "@restai/types";

/**
 * A cart line is identified by the product PLUS its exact set of modifiers.
 * Consequences:
 *  - the same product with different modifiers becomes two separate lines;
 *  - adding the same product+modifiers again merges quantities;
 *  - the plain (no-modifier) line has lineId === menuItemId, which the menu
 *    grid's quick-add and +/- operate on.
 * The signature is deterministic (sorted modifier ids) so it is stable across
 * renders and safe to use as a React key — no random id needed.
 */
function lineSignature(menuItemId: string, modifiers: CartModifier[]): string {
  if (!modifiers || modifiers.length === 0) return menuItemId;
  const ids = modifiers.map((m) => m.modifierId).sort();
  return `${menuItemId}::${ids.join(",")}`;
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "lineId">) => void;
  removeLine: (lineId: string) => void;
  updateLineQuantity: (lineId: string, quantity: number) => void;
  /**
   * Cambia la indicación para cocina de una línea ya añadida.
   *
   * Lo necesita el mesero por voz: "al ceviche ponle poca cebolla" llega DESPUÉS
   * de haber añadido el plato, y sin esto la única salida era quitar la línea y
   * volver a crearla, que en medio de una conversación es una forma cara de
   * perder el pedido.
   */
  updateLineNotes: (lineId: string, notes: string) => void;
  clearCart: () => void;
  /** Quantity of the plain (no-modifier) line for a product; used by the grid. */
  getItemQty: (menuItemId: string) => number;
  getSubtotal: () => number;
  getTax: (taxRate: number) => number;
  getTotal: (taxRate: number) => number;
  getItemCount: () => number;
  /**
   * Ata el carrito a una mesa concreta. Si la mesa cambia, el carrito guardado
   * se descarta: los platos que eligió el comensal anterior no deben aparecerle
   * al siguiente.
   */
  bindToTable: (tableKey: string) => void;
  tableKey: string | null;
}

/**
 * El carrito PERSISTE en sessionStorage.
 *
 * Antes vivía solo en memoria: bastaba un refresco, un giro de pantalla que
 * recargara, o que iOS descartara la pestaña en segundo plano, para que el
 * comensal perdiera un pedido ya armado. Es el punto del embudo donde más caro
 * sale perder a alguien, porque ya había decidido qué quería.
 *
 * sessionStorage y no localStorage a propósito: el carrito no debe sobrevivir al
 * cierre del navegador ni saltar de un comensal a otro en el mismo dispositivo.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
  items: [],
  tableKey: null,
  bindToTable: (tableKey) => {
    if (get().tableKey === tableKey) return;
    set({ tableKey, items: [] });
  },
  addItem: (item) => {
    const lineId = lineSignature(item.menuItemId, item.modifiers);
    const items = get().items;
    const existing = items.find((i) => i.lineId === lineId);
    if (existing) {
      set({
        items: items.map((i) =>
          i.lineId === lineId ? { ...i, quantity: i.quantity + item.quantity } : i
        ),
      });
    } else {
      set({ items: [...items, { ...item, lineId }] });
    }
  },
  removeLine: (lineId) => {
    set({ items: get().items.filter((i) => i.lineId !== lineId) });
  },
  updateLineQuantity: (lineId, quantity) => {
    if (quantity <= 0) {
      get().removeLine(lineId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.lineId === lineId ? { ...i, quantity } : i
      ),
    });
  },
  updateLineNotes: (lineId, notes) => {
    set({
      items: get().items.map((i) =>
        i.lineId === lineId ? { ...i, notes: notes.trim() || undefined } : i
      ),
    });
  },
  clearCart: () => set({ items: [] }),
  getItemQty: (menuItemId) => {
    const line = get().items.find((i) => i.lineId === menuItemId);
    return line?.quantity || 0;
  },
  getSubtotal: () => {
    return get().items.reduce((sum, item) => {
      const modifiersTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
      return sum + (item.unitPrice + modifiersTotal) * item.quantity;
    }, 0);
  },
  getTax: (taxRate) => {
    return Math.round((get().getSubtotal() * taxRate) / 10000);
  },
  getTotal: (taxRate) => {
    return get().getSubtotal() + get().getTax(taxRate);
  },
  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
    }),
    {
      name: "restai-cart",
      storage: createJSONStorage(() => sessionStorage),
      // Solo el contenido del carrito: las funciones no se serializan y
      // guardarlas rompería la hidratación.
      partialize: (state) => ({ items: state.items, tableKey: state.tableKey }),
    },
  ),
);
