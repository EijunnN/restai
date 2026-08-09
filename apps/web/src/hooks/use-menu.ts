"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

// --- Categories ---

export function useCategories() {
  return useQuery({
    queryKey: ["menu", "categories"],
    queryFn: () => apiFetch("/api/menu/categories"),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/menu/categories", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/menu/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/menu/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

// --- Menu Items ---

export function useMenuItems(categoryId?: string) {
  return useQuery({
    queryKey: ["menu", "items", categoryId],
    queryFn: () =>
      apiFetch(`/api/menu/items${categoryId ? `?categoryId=${categoryId}` : ""}`),
  });
}

export function useCreateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/menu/items", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/menu/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useDeleteMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/menu/items/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/**
 * Devuelve a la carta un producto borrado.
 *
 * Borrar un producto es un borrado SUAVE: la fila sigue ahí con su `deleted_at`
 * puesto, porque los pedidos históricos la referencian. El servidor ya ofrecía
 * esta ruta desde el principio y nadie la llamaba, así que el "¿seguro? no se
 * puede deshacer" del diálogo mentía: sí se podía, solo que no había botón.
 */
export function useRestoreMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/menu/items/${id}/restore`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/**
 * Cambia varios productos de una vez.
 *
 * Devuelve `{updated, before, items}`: el `before` es lo que hace posible el
 * "Deshacer" del aviso, porque sin el estado previo solo se podría adivinar
 * (y adivinar mal es reponer en la carta un plato que llevaba días agotado).
 */
export function useBulkUpdateMenuItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: Record<string, unknown> }) =>
      apiFetch("/api/menu/items/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids, patch }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/** Vincula un grupo de modificadores a varios productos en una transacción. */
export function useBulkLinkModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, groupId }: { ids: string[]; groupId: string }) =>
      apiFetch("/api/menu/items/bulk/modifier-groups", {
        method: "POST",
        body: JSON.stringify({ ids, groupId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/** Archiva varios productos, o los devuelve con `restore: true`. */
export function useBulkDeleteMenuItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, restore }: { ids: string[]; restore?: boolean }) =>
      apiFetch("/api/menu/items/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ ids, restore }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

/**
 * Reordenar. Las tres comparten contrato: se envía la lista COMPLETA del ámbito
 * en su orden final y el servidor escribe 0,1,2… en una transacción.
 */
export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch("/api/menu/categories/reorder", {
        method: "PATCH",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useReorderMenuItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      apiFetch("/api/menu/items/reorder", {
        method: "PATCH",
        body: JSON.stringify({ categoryId, ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useReorderModifiers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, ids }: { groupId: string; ids: string[] }) =>
      apiFetch(`/api/menu/modifier-groups/${groupId}/modifiers/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

// --- Modifier Groups ---

export function useModifierGroups() {
  return useQuery({
    queryKey: ["menu", "modifier-groups"],
    queryFn: () => apiFetch("/api/menu/modifier-groups"),
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/menu/modifier-groups", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/menu/modifier-groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/menu/modifier-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

// --- Modifiers ---

export function useAddModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/menu/modifiers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUpdateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/menu/modifiers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/menu/modifiers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

// --- Item ↔ Modifier Group Links ---

export function useItemModifierGroups(itemId: string) {
  return useQuery({
    queryKey: ["menu", "items", itemId, "modifier-groups"],
    queryFn: () => apiFetch(`/api/menu/items/${itemId}/modifier-groups`),
    enabled: !!itemId,
  });
}

/**
 * El sentido inverso: qué productos usan este grupo.
 *
 * Sin esto, el diálogo de borrado prometía la consecuencia en prosa —"los
 * productos vinculados perderán este grupo"— sin poder nombrar ni uno.
 */
export function useModifierGroupItems(groupId: string) {
  return useQuery({
    queryKey: ["menu", "modifier-groups", groupId, "items"],
    queryFn: () => apiFetch(`/api/menu/modifier-groups/${groupId}/items`),
    enabled: !!groupId,
  });
}

export function useLinkModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, groupId }: { itemId: string; groupId: string }) =>
      apiFetch(`/api/menu/items/${itemId}/modifier-groups`, {
        method: "POST",
        body: JSON.stringify({ groupId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}

export function useUnlinkModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, groupId }: { itemId: string; groupId: string }) =>
      apiFetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });
}
