"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import { AlertTriangle, RefreshCw, Package, ArrowUpDown, ChefHat, HelpCircle } from "lucide-react";
import {
  useInventoryItems,
  useInventoryMovements,
  useInventoryAlerts,
} from "@/hooks/use-inventory";
import { useBranchSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
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

  /**
   * El interruptor del módulo vive en la configuración de la sede, y leerla
   * exige `settings:read`. Antes se escribía `?? false`, así que "no pude
   * leerlo" y "está apagado" acababan siendo el mismo valor y la guarda
   * `!inventoryEnabled && branchData` no entraba nunca: la pantalla se pintaba
   * como si el inventario estuviera activo. Aquí se distinguen los TRES estados
   * reales: comprobando, no se pudo comprobar, y desactivado.
   */
  const {
    data: branchData,
    isLoading: branchLoading,
    error: branchError,
    refetch: refetchBranch,
  } = useBranchSettings();
  const inventoryEnabled = branchData?.settings?.inventory_enabled === true;
  // "No lo sé" incluye el error Y el caso de quedarse sin datos sin error
  // (consulta en pausa por falta de red, por ejemplo): sin esto volvíamos a
  // colapsar "no pude leerlo" en "está apagado", que es justo el defecto.
  const estadoDesconocido = !!branchError || (!branchLoading && !branchData);

  const user = useAuthStore((s) => s.user);
  // Activar el módulo se hace con PATCH /api/settings/branch, que exige
  // `branch:update`. A quien no lo tenga no se le ofrece un enlace que solo le
  // llevaría a otra puerta cerrada.
  const puedeConfigurarSede = hasPermission(user?.role, "branch:update");

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

  // Estado 1: todavía no sabemos si el módulo está activo. No se pinta ni el
  // inventario ni el cartel de "desactivado": ninguna de las dos cosas es cierta
  // aún.
  if (branchLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
          <p className="text-muted-foreground">Comprobando la configuración de la sede...</p>
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // Estado 2: el módulo está apagado en esta sede.
  if (!inventoryEnabled && !estadoDesconocido) {
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
              El control de inventario no está activado para esta sede.
              {puedeConfigurarSede
                ? " Puedes activarlo desde la configuración de la sede."
                : " Pídele al administrador o al gerente de la sede que lo active."}
            </p>
            {/* Navegación interna: `window.location.href` recargaba la aplicación
                entera y tiraba la caché de consultas sin necesidad. */}
            {puedeConfigurarSede && (
              <Link
                href="/settings"
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ir a Configuración
              </Link>
            )}
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

  // Estado 3: no se pudo leer la configuración (403 del rol, red caída...). Se
  // dice EXPLÍCITAMENTE, en vez de dar por hecho que el módulo está encendido.
  const sinPermisoParaLaConfig =
    (branchError as any)?.code === "FORBIDDEN" || (branchError as any)?.status === 403;

  return (
    <div className="space-y-6">
      {estadoDesconocido && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium">
                No pudimos comprobar si el inventario está activo en esta sede
              </p>
              <p className="text-xs text-muted-foreground">
                {sinPermisoParaLaConfig
                  ? "Tu rol no puede leer la configuración de la sede. Lo que ves abajo puede pertenecer a un módulo que el local tiene desactivado."
                  : branchError
                    ? `Se muestran los datos tal cual llegan. Detalle: ${(branchError as Error).message}`
                    : "La configuración de la sede no llegó a cargarse. Se muestran los datos tal cual llegan."}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchBranch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      )}

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
