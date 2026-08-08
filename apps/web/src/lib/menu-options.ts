/**
 * Reglas de las opciones de un plato (los "modificadores").
 *
 * Vive aparte de la pantalla porque es donde el comensal se queda atascado sin
 * saber por qué. Cubierto por `menu-options.test.ts`.
 *
 * La regla que manda es la del SERVIDOR (`order.service.ts:209-225`). El
 * cliente la replica exacta: si valida de menos, el comensal llega al carrito y
 * se le rechaza el pedido ENTERO con un 400 genérico, lejos de la pantalla
 * donde podía arreglarlo.
 */

import type { CartItem } from "@restai/types";

export interface ModifierOption {
  id: string;
  name: string;
  /** Precio de la opción, en céntimos. */
  price: number;
  is_available?: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  is_required?: boolean;
  min_selections?: number;
  max_selections?: number;
  modifiers: ModifierOption[];
}

/** Selección del comensal: por grupo, los ids elegidos. */
export type Selection = Record<string, string[]>;

/**
 * Cuántas opciones exige de verdad un grupo.
 *
 * Fórmula idéntica a la del servidor. El matiz que faltaba en el cliente: un
 * grupo NO marcado como obligatorio pero con `min_selections > 0` también
 * exige, y antes se saltaba con un `continue`.
 */
export function requiredMinimum(group: ModifierGroup): number {
  const min = group.min_selections ?? 0;
  return group.is_required ? Math.max(min, 1) : min;
}

/** ¿Es de una sola opción? `max_selections === 1` significa radio. */
export function isSingleChoice(group: ModifierGroup): boolean {
  return (group.max_selections ?? 1) === 1;
}

/** Tope de opciones. `0` significa sin tope, igual que en el servidor. */
export function maximumAllowed(group: ModifierGroup): number | null {
  const max = group.max_selections ?? 1;
  return max > 0 ? max : null;
}

/**
 * ¿Este grupo es imposible de satisfacer?
 *
 * Ocurre cuando exige opciones pero se han agotado todas: la API pública las
 * filtra, así que el grupo llega vacío. Antes, el botón de añadir se quedaba
 * bloqueado para siempre sin explicar nada. Detectarlo permite decirlo.
 */
export function isUnsatisfiable(group: ModifierGroup): boolean {
  return requiredMinimum(group) > 0 && group.modifiers.length === 0;
}

export interface GroupIssue {
  groupId: string;
  groupName: string;
  message: string;
  /** El grupo no se puede completar aunque el comensal quiera. */
  blocked: boolean;
}

/** Grupos que impiden añadir el plato, con el motivo ya redactado. */
export function validateSelection(
  groups: ModifierGroup[],
  selection: Selection,
): GroupIssue[] {
  const issues: GroupIssue[] = [];
  for (const group of groups) {
    const min = requiredMinimum(group);
    if (min <= 0) continue;

    if (isUnsatisfiable(group)) {
      issues.push({
        groupId: group.id,
        groupName: group.name,
        message: `No queda ninguna opción de "${group.name}" hoy. Avisa al mozo.`,
        blocked: true,
      });
      continue;
    }

    const chosen = selection[group.id]?.length ?? 0;
    if (chosen < min) {
      issues.push({
        groupId: group.id,
        groupName: group.name,
        message:
          min === 1
            ? `Elige ${group.name.toLowerCase()}`
            : `Elige al menos ${min} opciones de ${group.name.toLowerCase()}`,
        blocked: false,
      });
    }
  }
  return issues;
}

/**
 * Aplica un toque sobre una opción y devuelve la selección resultante.
 *
 * Tres reglas que antes no se cumplían:
 *  - Un grupo obligatorio de una sola opción NO puede quedarse vacío: volver a
 *    tocar la marcada no la quita, porque un radio real no se vacía.
 *  - Al llegar al tope no se ignora el toque en silencio; se devuelve `atLimit`
 *    para que la pantalla pueda decir "quita uno para añadir otro".
 *  - En grupo de una sola opción, elegir otra sustituye, no acumula.
 */
export function toggleOption(
  group: ModifierGroup,
  selection: Selection,
  optionId: string,
): { selection: Selection; atLimit: boolean } {
  const current = selection[group.id] ?? [];
  const isSelected = current.includes(optionId);

  if (isSingleChoice(group)) {
    // Quitar la única opción de un grupo obligatorio lo dejaría inválido.
    if (isSelected && requiredMinimum(group) > 0) {
      return { selection, atLimit: false };
    }
    return {
      selection: { ...selection, [group.id]: isSelected ? [] : [optionId] },
      atLimit: false,
    };
  }

  if (isSelected) {
    return {
      selection: { ...selection, [group.id]: current.filter((id) => id !== optionId) },
      atLimit: false,
    };
  }

  const max = maximumAllowed(group);
  if (max !== null && current.length >= max) {
    return { selection, atLimit: true };
  }

  return { selection: { ...selection, [group.id]: [...current, optionId] }, atLimit: false };
}

/** Suma de las opciones elegidas, en céntimos. */
export function optionsTotal(groups: ModifierGroup[], selection: Selection): number {
  let total = 0;
  for (const group of groups) {
    for (const id of selection[group.id] ?? []) {
      const option = group.modifiers.find((m) => m.id === id);
      if (option) total += option.price;
    }
  }
  return total;
}

/** Aplana la selección al formato que guarda el carrito. */
export function selectionToCartModifiers(
  groups: ModifierGroup[],
  selection: Selection,
): { modifierId: string; name: string; price: number }[] {
  const out: { modifierId: string; name: string; price: number }[] = [];
  for (const group of groups) {
    for (const id of selection[group.id] ?? []) {
      const option = group.modifiers.find((m) => m.id === id);
      if (option) out.push({ modifierId: option.id, name: option.name, price: option.price });
    }
  }
  return out;
}

// ── Lo que ya hay en el pedido ──────────────────────────────────────────────

/**
 * Unidades de un plato en el carrito, SUMANDO todas sus variantes.
 *
 * El punto ciego que arreglaba a medias la pantalla anterior: `getItemQty` del
 * carrito solo ve la línea sin opciones, así que un plato pedido con extras
 * figuraba con cero en su tarjeta. Aquí se cuentan todas.
 */
export function unitsInCart(items: CartItem[], menuItemId: string): number {
  return items
    .filter((i) => i.menuItemId === menuItemId)
    .reduce((n, i) => n + i.quantity, 0);
}

/** Las líneas de un plato, cada una con su configuración. */
export function variantsInCart(items: CartItem[], menuItemId: string): CartItem[] {
  return items.filter((i) => i.menuItemId === menuItemId);
}

/**
 * Cómo se describe una variante en una línea: "clásica", "con palta extra".
 *
 * Sin opciones se dice "clásica" en vez de dejarlo en blanco: el comensal tiene
 * que poder distinguir esa línea de las demás de un vistazo.
 */
export function describeVariant(item: CartItem): string {
  if (!item.modifiers?.length) return "clásica";
  return item.modifiers.map((m) => m.name).join(" · ");
}

/** Resumen de todas las variantes: "1 clásica · 2 con palta extra". */
export function summarizeVariants(items: CartItem[], menuItemId: string): string {
  return variantsInCart(items, menuItemId)
    .map((i) => `${i.quantity} ${describeVariant(i)}`)
    .join(" · ");
}
