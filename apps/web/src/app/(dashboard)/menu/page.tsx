"use client";

import { Button } from "@restai/ui/components/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import { RefreshCw } from "lucide-react";
import {
  useCategories,
  useMenuItems,
  useModifierGroups,
} from "@/hooks/use-menu";
import { PageHeader } from "@/components/page-header";
import { ProductsPanel } from "./_components/products-panel";
import { ModifierGroupsPanel } from "./_components/modifier-groups-panel";

export default function MenuPage() {
  const {
    data: categories,
    isLoading: categoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();
  const {
    data: menuItems,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useMenuItems();
  const { data: modifierGroups } = useModifierGroups();

  const isLoading = categoriesLoading || itemsLoading;
  const error = categoriesError || itemsError;

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Menu</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar el menu: {(error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchCategories();
              refetchItems();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu"
        description="Gestiona categorias, productos y modificadores"
      />

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="modifiers">Modificadores</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsPanel
            categories={categories ?? []}
            menuItems={menuItems ?? []}
            allModifierGroups={modifierGroups ?? []}
            isLoading={isLoading}
          />
        </TabsContent>
        <TabsContent value="modifiers">
          <ModifierGroupsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
