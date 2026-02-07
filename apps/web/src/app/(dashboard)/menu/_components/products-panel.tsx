"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Plus,
  Edit,
  Trash2,
  ToggleLeft,
  ToggleRight,
  UtensilsCrossed,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  useUpdateMenuItem,
  useDeleteMenuItem,
  useDeleteCategory,
} from "@/hooks/use-menu";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SearchInput } from "@/components/search-input";
import { CategoryDialog } from "./category-dialog";
import { ProductDialog } from "./product-dialog";
import { ImageUploadButton } from "./image-upload-button";

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

export function ProductsPanel({
  categories,
  menuItems,
  allModifierGroups,
  isLoading,
}: {
  categories: any[];
  menuItems: any[];
  allModifierGroups: any[];
  isLoading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const deleteCat = useDeleteCategory();

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [prodDialogOpen, setProdDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: "category" | "product";
    id: string;
    name: string;
  } | null>(null);

  const categoryList: any[] = categories ?? [];
  const allItems: any[] = menuItems ?? [];

  // Map items to categories for counts
  const itemCountByCategory: Record<string, number> = {};
  for (const item of allItems) {
    const catId = item.categoryId || item.category_id;
    itemCountByCategory[catId] = (itemCountByCategory[catId] || 0) + 1;
  }

  // Filter items by selected category and search
  const visibleItems = allItems.filter((item: any) => {
    const catId = item.categoryId || item.category_id;
    if (selectedCategoryId !== "all" && catId !== selectedCategoryId) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !item.name.toLowerCase().includes(q) &&
        !(item.description || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const activeCategoryName =
    selectedCategoryId === "all"
      ? "Todos los productos"
      : categoryList.find((c: any) => c.id === selectedCategoryId)?.name ?? "Productos";

  const handleToggleAvailability = (item: any) => {
    updateItem.mutate(
      {
        id: item.id,
        isAvailable: !(item.isAvailable ?? item.is_available),
      },
      {
        onSuccess: () =>
          toast.success(
            `${item.name} ${!(item.isAvailable ?? item.is_available) ? "disponible" : "no disponible"}`
          ),
      }
    );
  };

  const handleImageUploaded = (item: any, url: string) => {
    updateItem.mutate({ id: item.id, imageUrl: url });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === "category") {
        await deleteCat.mutateAsync(confirmDelete.id);
        toast.success("Categoria eliminada");
        if (selectedCategoryId === confirmDelete.id) {
          setSelectedCategoryId("all");
        }
      } else {
        await deleteItem.mutateAsync(confirmDelete.id);
        toast.success("Producto eliminado");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar");
    }
    setConfirmDelete(null);
  };

  if (isLoading) {
    return (
      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
        <div className="flex-1 space-y-4">
          <Skeleton className="h-10" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (categoryList.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-lg">
        <UtensilsCrossed className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground mb-4">
          No hay categorias en el menu
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setEditingCategory(null);
            setCatDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Crear primera categoria
        </Button>
        {catDialogOpen && (
          <CategoryDialog
            open={catDialogOpen}
            onOpenChange={(v) => {
              setCatDialogOpen(v);
              if (!v) setEditingCategory(null);
            }}
            initial={editingCategory}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Left sidebar: categories */}
      <div className="w-56 shrink-0">
        <div className="sticky top-4 space-y-1">
          {/* "Todos" option */}
          <button
            onClick={() => setSelectedCategoryId("all")}
            className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors text-left ${
              selectedCategoryId === "all"
                ? "bg-primary text-primary-foreground font-medium"
                : "hover:bg-muted text-foreground"
            }`}
          >
            <span className="truncate">Todos</span>
            <span
              className={`text-xs tabular-nums ${
                selectedCategoryId === "all"
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              }`}
            >
              {allItems.length}
            </span>
          </button>

          {/* Category list */}
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto space-y-1">
            {categoryList.map((cat: any) => {
              const isActive = selectedCategoryId === cat.id;
              const count = itemCountByCategory[cat.id] || 0;
              return (
                <div key={cat.id} className="group relative">
                  <button
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors text-left ${
                      isActive
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <span className="truncate pr-1">{cat.name}</span>
                    <span
                      className={`text-xs tabular-nums shrink-0 ${
                        isActive
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                  {/* Edit/delete buttons on hover */}
                  <div
                    className={`absolute right-8 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                      isActive ? "right-10" : ""
                    }`}
                  >
                    <button
                      className={`p-1 rounded transition-colors ${
                        isActive
                          ? "hover:bg-primary-foreground/20 text-primary-foreground/70 hover:text-primary-foreground"
                          : "hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCategory(cat);
                        setCatDialogOpen(true);
                      }}
                    >
                      <Edit className="h-3 w-3" />
                    </button>
                    <button
                      className={`p-1 rounded transition-colors ${
                        isActive
                          ? "hover:bg-primary-foreground/20 text-primary-foreground/70 hover:text-primary-foreground"
                          : "hover:bg-muted-foreground/10 text-muted-foreground hover:text-destructive"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({
                          type: "category",
                          id: cat.id,
                          name: cat.name,
                        });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Create category button */}
          <button
            onClick={() => {
              setEditingCategory(null);
              setCatDialogOpen(true);
            }}
            className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva categoria
          </button>
        </div>
      </div>

      {/* Main area: products */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{activeCategoryName}</h2>
            <p className="text-sm text-muted-foreground">
              {visibleItems.length} producto{visibleItems.length !== 1 ? "s" : ""}
              {search ? ` encontrado${visibleItems.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingProduct(null);
              setProdDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Producto
          </Button>
        </div>

        {/* Search */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar en esta categoria..."
        />

        {/* Products grid */}
        {visibleItems.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <UtensilsCrossed className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              {search ? "No se encontraron productos" : "Sin productos en esta categoria"}
            </p>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingProduct(null);
                  setProdDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Agregar producto
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleItems.map((item: any) => {
              const available = item.isAvailable ?? item.is_available ?? true;
              const imageUrl = item.imageUrl || item.image_url;
              return (
                <div
                  key={item.id}
                  className={`group relative rounded-lg border border-border bg-card overflow-hidden transition-colors hover:border-primary/30 ${
                    !available ? "opacity-60" : ""
                  }`}
                >
                  {/* Product image */}
                  <div className="relative w-full h-36 bg-muted">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" />
                      </div>
                    )}
                    {!available && (
                      <Badge
                        variant="secondary"
                        className="absolute top-2 left-2 text-[9px]"
                      >
                        No disp.
                      </Badge>
                    )}
                    {/* Actions overlay */}
                    <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                        onClick={() => handleToggleAvailability(item)}
                        title={
                          available
                            ? "Marcar no disponible"
                            : "Marcar disponible"
                        }
                      >
                        {available ? (
                          <ToggleRight className="h-4 w-4 text-primary" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                        onClick={() => {
                          setEditingProduct(item);
                          setProdDialogOpen(true);
                        }}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                        onClick={() =>
                          setConfirmDelete({
                            type: "product",
                            id: item.id,
                            name: item.name,
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                    {/* Image upload overlay */}
                    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-background/80 rounded-md px-2 py-1">
                        <ImageUploadButton
                          currentUrl={imageUrl}
                          onUploaded={(url) =>
                            handleImageUploaded(item, url)
                          }
                        />
                      </div>
                    </div>
                  </div>
                  {/* Product info */}
                  <div className="p-3">
                    <h4 className="font-medium text-sm leading-tight truncate">
                      {item.name}
                    </h4>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {item.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-sm font-semibold">
                        {formatCurrency(item.price)}
                      </p>
                      {selectedCategoryId === "all" && (
                        <span className="text-[10px] text-muted-foreground truncate ml-2">
                          {categoryList.find(
                            (c: any) =>
                              c.id === (item.categoryId || item.category_id)
                          )?.name ?? ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {catDialogOpen && (
        <CategoryDialog
          open={catDialogOpen}
          onOpenChange={(v) => {
            setCatDialogOpen(v);
            if (!v) setEditingCategory(null);
          }}
          initial={editingCategory}
        />
      )}
      {prodDialogOpen && (
        <ProductDialog
          open={prodDialogOpen}
          onOpenChange={(v) => {
            setProdDialogOpen(v);
            if (!v) setEditingProduct(null);
          }}
          categories={categoryList}
          allModifierGroups={allModifierGroups}
          initial={editingProduct}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(v) => {
            if (!v) setConfirmDelete(null);
          }}
          title={`Eliminar ${confirmDelete.type === "category" ? "categoria" : "producto"}`}
          description={`Estas seguro que deseas eliminar "${confirmDelete.name}"? Esta accion no se puede deshacer.`}
          onConfirm={handleConfirmDelete}
          loading={deleteCat.isPending || deleteItem.isPending}
        />
      )}
    </div>
  );
}
