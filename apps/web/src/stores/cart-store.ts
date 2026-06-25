import { create } from "zustand";
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
  clearCart: () => void;
  /** Quantity of the plain (no-modifier) line for a product; used by the grid. */
  getItemQty: (menuItemId: string) => number;
  getSubtotal: () => number;
  getTax: (taxRate: number) => number;
  getTotal: (taxRate: number) => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
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
}));
