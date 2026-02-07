"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import { AlertTriangle, RefreshCw, Package, ArrowUpDown, ChefHat } from "lucide-react";
import {
  useInventoryItems,
  useInventoryMovements,
  useInventoryAlerts,
} from "@/hooks/use-inventory";
import { useBranchSettings } from "@/hooks/use-settings";
import { PageHeader } from "@/components/page-header";
import { ItemsTab } from "./_components/items-tab";
import { CreateItemDialog } from "./_components/item-dialog";
import { MovementsTab } from "./_components/movements-tab";
import { CreateMovementDialog } from "./_components/movement-dialog";
import { RecipesTab } from "./_components/recipes-tab";
import { CreateRecipeDialog } from "./_components/recipe-dialog";

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newMovementOpen, setNewMovementOpen] = useState(false);
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);

  const { data: branchData } = useBranchSettings();
  const inventoryEnabled = branchData?.settings?.inventory_enabled ?? false;

  const {
    data: itemsData,
    isLoading,
    error,
    refetch,
  } = useInventoryItems();
  const { data: movementsData } = useInventoryMovements();
  const { data: alertsData } = useInventoryAlerts();

  const items: any[] = itemsData ?? [];
  const movements: any[] = movementsData ?? [];
  const alerts: any[] = alertsData ?? [];

  if (!inventoryEnabled && branchData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
          <p className="text-muted-foreground">
            Control de stock y recetas
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">Inventario desactivado</p>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              El control de inventario no esta activado para esta sede. Puedes activarlo desde la configuracion de la sede.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/settings"}>
              Ir a Configuracion
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar inventario: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {alerts.length > 0 && (
        <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              {alerts.length}{" "}
              {alerts.length === 1 ? "item" : "items"} bajo stock minimo
            </p>
            <p className="text-xs text-destructive/80">
              {alerts.map((a: any) => a.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      <PageHeader
        title="Inventario"
        description={
          isLoading
            ? "Cargando..."
            : `${items.length} items en total`
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="stock">
            <Package className="h-4 w-4 mr-1" />
            Items
          </TabsTrigger>
          <TabsTrigger value="movements">
            <ArrowUpDown className="h-4 w-4 mr-1" />
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="recipes">
            <ChefHat className="h-4 w-4 mr-1" />
            Recetas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <ItemsTab
            items={items}
            isLoading={isLoading}
            search={search}
            setSearch={setSearch}
            onNewItem={() => setNewItemOpen(true)}
          />
        </TabsContent>

        <TabsContent value="movements">
          <MovementsTab
            movements={movements}
            onNewMovement={() => setNewMovementOpen(true)}
          />
        </TabsContent>

        <TabsContent value="recipes">
          <RecipesTab
            items={items}
            onNewRecipe={() => setRecipeDialogOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <CreateItemDialog
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
      />
      <CreateMovementDialog
        open={newMovementOpen}
        onOpenChange={setNewMovementOpen}
        items={items}
      />
      <CreateRecipeDialog
        open={recipeDialogOpen}
        onOpenChange={setRecipeDialogOpen}
        items={items}
      />
    </div>
  );
}
