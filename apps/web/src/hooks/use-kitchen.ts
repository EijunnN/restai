"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";

/**
 * Plato de la carta tal y como lo necesita la cocina: solo identidad y si queda.
 * (GET /api/menu/items devuelve la fila completa; aquí se tipa lo que se usa.)
 */
export interface KitchenMenuItem {
  id: string;
  name: string;
  is_available: boolean;
  category_id: string | null;
  sort_order?: number | null;
}

/** Categoría de la carta (GET /api/menu/categories devuelve la fila completa). */
export interface KitchenMenuCategory {
  id: string;
  name: string;
  is_active?: boolean;
  sort_order?: number | null;
}

export function useKitchenOrders() {
  return useQuery({
    queryKey: ["kitchen", "orders"],
    queryFn: () => apiFetch("/api/kitchen/orders"),
    refetchInterval: 30000,
  });
}

/** Ambiente de la sede (salón, terraza, segundo piso). */
export interface KitchenZone {
  id: string;
  name: string;
  floor_number: number;
}

/**
 * Ambientes de la sede, para elegir a qué zona sirve esta pantalla.
 *
 * Cambian con muy poca frecuencia (se configuran al montar el local), así que se
 * cachean largo: no tiene sentido volver a pedirlos en cada refresco del tablero.
 */
export function useKitchenZones() {
  return useQuery<KitchenZone[]>({
    queryKey: ["kitchen", "zones"],
    queryFn: () => apiFetch("/api/kitchen/zones"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateKitchenItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/kitchen/items/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}

// ---------------------------------------------------------------------------
// Anular una línea de comanda ("86")
// ---------------------------------------------------------------------------

export interface CancelKitchenItemResult {
  item: {
    id: string;
    name: string;
    quantity: number;
    status: string;
    cancel_reason: string | null;
  };
  order: {
    id: string;
    order_number: string;
    status: string;
    subtotal: number;
    discount: number;
    tax: number;
    delivery_fee: number;
    total: number;
  };
  /** true cuando no quedaba ninguna línea viva y el pedido entero se anuló. */
  order_cancelled: boolean;
}

/**
 * Anula un plato de una comanda ("86": se acabó).
 *
 * El backend garantiza que cualquier respuesta que no sea 2xx significa que NO
 * se tocó nada (ni la línea, ni los totales del pedido), así que quien llame
 * puede tratar el error como "no pasó nada" y limitarse a explicarlo.
 *
 * Al anular cambian los totales del pedido: por eso se invalidan también
 * `orders`, `tables` y `payments`, que muestran esos importes.
 */
export function useCancelKitchenItem() {
  const qc = useQueryClient();
  return useMutation<
    CancelKitchenItemResult,
    Error,
    { orderId: string; itemId: string; reason: string }
  >({
    mutationFn: ({ orderId, itemId, reason }) =>
      apiFetch(`/api/kitchen/orders/${orderId}/items/${itemId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Disponibilidad de la carta desde cocina (plato agotado)
// ---------------------------------------------------------------------------

/**
 * Estado de la carta de la sede, para saber qué platos figuran ya como agotados.
 *
 * La comanda no trae esa información (guarda una foto del plato en el momento
 * del pedido), así que sin esta consulta la cocina no podría distinguir entre
 * "marcar agotado" y "reponer" y acabaría marcando dos veces lo mismo.
 *
 * Se pide una sola vez y se refresca por evento realtime (`menu:availability`),
 * no por sondeo: la carta cambia pocas veces por servicio.
 */
export function useKitchenMenuAvailability(enabled = true) {
  return useQuery<KitchenMenuItem[]>({
    queryKey: ["kitchen", "menu-availability"],
    queryFn: () => apiFetch<KitchenMenuItem[]>("/api/menu/items"),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Categorías de la carta, para agrupar el panel de disponibilidad.
 *
 * Sin agrupar, una carta de cien platos es una lista plana imposible de recorrer
 * con guantes en mitad del servicio.
 */
export function useKitchenMenuCategories(enabled = true) {
  return useQuery<KitchenMenuCategory[]>({
    queryKey: ["kitchen", "menu-categories"],
    queryFn: () => apiFetch<KitchenMenuCategory[]>("/api/menu/categories"),
    enabled,
    staleTime: 300_000,
  });
}

export interface MenuAvailabilityResult {
  id: string;
  name: string;
  is_available: boolean;
  /** false = ya estaba así; el servidor no auditó ni avisó a nadie. */
  changed: boolean;
}

/** Marca un plato como agotado (o lo repone) sin salir de la pantalla de cocina. */
export function useSetMenuItemAvailability() {
  const qc = useQueryClient();
  return useMutation<
    MenuAvailabilityResult,
    Error,
    { id: string; available: boolean; name?: string }
  >({
    mutationFn: ({ id, available }) =>
      apiFetch<MenuAvailabilityResult>(
        `/api/kitchen/menu-items/${id}/${available ? "available" : "unavailable"}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen", "menu-availability"] });
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
  });
}

/**
 * Alternar la disponibilidad de un plato con aviso, "Deshacer" y bloqueo POR
 * PLATO (no global: marcar uno no puede congelar los botones de los demás).
 *
 * Vive aquí y no en la tarjeta porque lo usan dos pantallas: la línea de comanda
 * y el panel de carta del KDS. Tener dos copias significaba dos textos distintos
 * y dos sitios donde olvidar el `onError`.
 */
export function useToggleMenuAvailability() {
  const mutation = useSetMenuItemAvailability();
  const [enCambio, setEnCambio] = useState<Set<string>>(new Set());

  const marcar = (menuItemId: string, activo: boolean) =>
    setEnCambio((prev) => {
      const next = new Set(prev);
      if (activo) next.add(menuItemId);
      else next.delete(menuItemId);
      return next;
    });

  /**
   * @param estaAgotado estado ACTUAL del plato; el destino es el contrario.
   * @param opciones.silencioSiIgual no avisa cuando el servidor responde
   *        `changed:false` (el plato ya estaba así). Se usa al encadenar la
   *        retirada de carta después de un "86", donde ese aviso sería ruido.
   */
  function alternar(
    menuItemId: string,
    nombre: string,
    estaAgotado: boolean,
    opciones?: { silencioSiIgual?: boolean },
  ) {
    const disponibleDestino = estaAgotado;

    marcar(menuItemId, true);
    mutation.mutate(
      { id: menuItemId, available: disponibleDestino },
      {
        onSuccess: (data) => {
          if (!data.changed) {
            if (!opciones?.silencioSiIgual) {
              toast.info(
                disponibleDestino
                  ? `«${nombre}» ya figuraba disponible en la carta`
                  : `«${nombre}» ya figuraba como agotado`,
              );
            }
            return;
          }

          toast.success(
            disponibleDestino ? `«${nombre}» vuelve a la carta` : `«${nombre}» marcado como agotado`,
            {
              description: disponibleDestino
                ? "Los comensales ya pueden volver a pedirlo."
                : "Los comensales y el POS dejan de verlo disponible.",
              action: {
                label: "Deshacer",
                onClick: () => alternar(menuItemId, nombre, !estaAgotado),
              },
            },
          );
        },
        onError: (err: any) => {
          toast.error(
            disponibleDestino
              ? "No se pudo reponer el plato en la carta"
              : "No se pudo marcar el plato como agotado",
            {
              description:
                err?.status === 404
                  ? "Ese plato ya no está en la carta de esta sede."
                  : err?.message || "Revisa la conexión e inténtalo de nuevo.",
            },
          );
        },
        onSettled: () => marcar(menuItemId, false),
      },
    );
  }

  return { alternar, enCambio };
}

// ---------------------------------------------------------------------------
// Eco de los eventos realtime propios
// ---------------------------------------------------------------------------

/**
 * Anulaciones hechas desde ESTA pantalla en los últimos segundos.
 *
 * El servidor difunde `order:item_cancelled` a toda la sede, incluida la tablet
 * que acaba de pulsar. Sin este registro, el cocinero vería su propio "86"
 * anunciado como si lo hubiera hecho otro, que es justo el aviso que importa
 * cuando lo anula el mozo desde la sala.
 */
const anulacionesLocales = new Set<string>();

export function registrarAnulacionLocal(itemId: string) {
  anulacionesLocales.add(itemId);
  setTimeout(() => anulacionesLocales.delete(itemId), 10000);
}

export function esAnulacionLocal(itemId: string): boolean {
  return anulacionesLocales.has(itemId);
}
