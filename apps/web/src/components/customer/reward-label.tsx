"use client";

import { formatCurrency } from "@/lib/utils";

/**
 * Descripción legible de una recompensa de fidelización.
 *
 * Una recompensa de PRODUCTO GRATIS tiene `discount_value = 0`, así que pintarla
 * siempre como descuento producía la línea "S/ 0.00 de descuento": la recompensa
 * más atractiva del programa parecía no valer nada y nadie la canjeaba. Con
 * `reward_type` (y el plato asociado) se puede decir lo que realmente es:
 * "Postre Tres Leches gratis".
 */

export interface RewardLike {
  reward_type?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  menu_item_id?: string | null;
  /** Presente en /my-loyalty. En /my-redemptions se resuelve con `menuItemNames`. */
  menu_item_name?: string | null;
}

/** Nombre del plato asociado, venga del endpoint o de la carta ya cargada. */
function resolveItemName(
  reward: RewardLike,
  menuItemNames?: Record<string, string>,
): string | null {
  if (reward.menu_item_name) return reward.menu_item_name;
  if (reward.menu_item_id && menuItemNames?.[reward.menu_item_id]) {
    return menuItemNames[reward.menu_item_id];
  }
  return null;
}

export function describeReward(
  reward: RewardLike,
  menuItemNames?: Record<string, string>,
): string {
  const itemName = resolveItemName(reward, menuItemNames);

  if (reward.reward_type === "free_item") {
    return itemName ? `${itemName} gratis` : "Un producto gratis";
  }

  const value = reward.discount_value ?? 0;

  if (reward.discount_type === "percentage" && value > 0) {
    return `${value}% de descuento`;
  }

  if (reward.discount_type === "fixed" && value > 0) {
    return `${formatCurrency(value)} de descuento`;
  }

  // Sin tipo declarado pero con plato asociado: es un producto gratis antiguo.
  if (itemName) return `${itemName} gratis`;

  return "Recompensa del programa";
}

/** Etiqueta corta para insignias y listados compactos. */
export function rewardKindLabel(reward: RewardLike): string {
  return reward.reward_type === "free_item" ? "Producto gratis" : "Descuento";
}
